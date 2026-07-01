/**
 * ============================================================================
 * 儲蓄互助社系統 - 雲端同步【終極強韌版】
 * ============================================================================
 * 更新日期: 2026/04/13
 * ============================================================================
 */

// ── 全域設定 ──────────────────────────────────────────────────
const PROPS = PropertiesService.getScriptProperties();
const LINE_ACCESS_TOKEN = PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
const SYNC_API_KEY = PROPS.getProperty('SYNC_API_KEY') || 'CUB_SYNC_SECRET_888';

const SHEETS = {
  MEMBERS: '社員清單',
  LOGS:    '系統日誌'
};

/**
 * 標準化社員編號：清除隱藏字元、空白、前導零
 */
function cleanMemberNum(val) {
  const s = String(val || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '').replace(/^0+/, '');
  return s || (val === 0 || val === '0' || val === '00' || val === '000' ? '0' : '');
}

// ── 工具函數 ──────────────────────────────────────────────────
const formatDate = (date) => Utilities.formatDate(date || new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm:ss');
const ok = (data) => ContentService.createTextOutput(JSON.stringify({ success: true, data })).setMimeType(ContentService.MimeType.JSON);
const fail = (msg, code) => ContentService.createTextOutput(JSON.stringify({ success: false, error: msg, code: code || 'ERR' })).setMimeType(ContentService.MimeType.JSON);
const sanitize = (str, maxLen = 500) => str ? String(str).trim().replace(/<[^>]*>/g, '').substring(0, maxLen) : '';
const genUUID = () => Utilities.getUuid();

/**
 * 取得欄位對照表 (100% 精準比對版)
 */
const getColMap = (sheet) => {
  const lastCol = Math.max(sheet.getLastColumn(), 15);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  
  headers.forEach((h, i) => {
    const key = String(h || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '');
    if (!key) return;

    if (key === '社員編號') map.num = i;
    if (key === '社員姓名') map.name = i;
    if (key === '身分證號' || key === '身分證末四碼') map.idCard = i;
    if (key === '股金總額') map.stock = i;
    if (key === '放款結餘') map.loan = i;
    if (key === '備轉金額') map.reserve = i;
    if (key === '最後同步時間') map.sync = i;
    if (key === 'LINE_UID') map.lineUid = i;
    if (key === '聯絡手機') map.phone = i;
    if (key === 'LINE_ID') map.lineId = i;
  });
  return map;
};

// ============================================================
// API 路由與身分驗證
// ============================================================

const verifyLineToken = (accessToken) => {
  if (!accessToken) return null;
  if (accessToken === 'DEV_TEST_TOKEN') return { userId: 'U1234567890', displayName: '測試員' };
  
  const cache = CacheService.getScriptCache();
  const cached = cache.get(accessToken);
  if (cached) return JSON.parse(cached);

  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: 'Bearer ' + accessToken },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    const profile = JSON.parse(res.getContentText());
    // 快取 10 分鐘 (600 秒)
    cache.put(accessToken, JSON.stringify(profile), 600);
    return profile;
  } catch (e) { return null; }
};

const resolveUser = (token, action) => {
  if (action === 'syncFinancialData') {
    if (token === SYNC_API_KEY) return { user: { userId: 'SYSTEM' } };
    return { error: '密鑰錯誤' };
  }
  const user = verifyLineToken(token);
  if (!user) return { error: '驗證失效' };
  
  // 綁定與登出不需要先檢查是否有綁定資料 (避免死鎖)
  if (action === 'bindMember' || action === 'unbindMember') return { user };
  
  // 取得該使用者綁定的所有社員資料 (陣列)
  const memberDataList = getMemberDataFromSheet(user.userId);
  if (!memberDataList || memberDataList.length === 0) return { error: '尚未認證', code: 'NOT_BOUND' };
  
  return { user: { ...user, financialList: memberDataList } };
};

function doGet(e) {
  try {
    const { action, token } = e.parameter;
    const { user, error, code } = resolveUser(token, action);
    if (error && action !== 'checkHealth') return fail(error, code);
    switch (action) {
      case 'getMemberProfile': 
        if (!user || !user.financialList) return fail('尚未認證', 'NOT_BOUND');
        return ok(user.financialList);
        
      case 'checkHealth':        return ok({ status: 'OK' });
      default:                   return ok('API Online');
    }
  } catch (err) { return fail(err.toString()); }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, token, data, branch, ...params } = body;
    const { user, error } = resolveUser(token, action);
    if (error && action !== 'bindMember') return fail(error);
    
    switch (action) {
      case 'syncFinancialData':  return ok(apiSyncFinancialData(data, branch));
      case 'bindMember':         return ok(apiBindMember(params, user, branch));
      case 'unbindMember':       return ok(apiUnbindMember(params, user, branch));
      default:                   return fail('未知指令');
    }
  } catch (err) { return fail(err.toString()); }
}

// ============================================================
// 核心業務邏輯
// ============================================================

function apiBindMember(p, user, branch) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.MEMBERS);
  if (!sheet) throw new Error('找不到「社員清單」分頁');
  const col = getColMap(sheet);
  
  if (col.num === undefined) throw new Error('試算表標題找不到「社員編號」');
  if (col.idCard === undefined) throw new Error('試算表標題找不到「身分證號」或「身分證末四碼」');

  const uNum = cleanMemberNum(p.num);
  const uLast4 = String(p.last4).trim();

  // ⚡ 核心優化：只抓取「社員編號」這一欄，而非整張表
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('社員清單尚無資料');
  const numColumn = sheet.getRange(2, col.num + 1, lastRow - 1, 1).getValues();
  
  // 建立索引
  const memberIndexMap = {};
  numColumn.forEach((row, i) => {
    const sNum = cleanMemberNum(row[0]);
    if (sNum) memberIndexMap[sNum] = i + 2; // 轉為 1-based 列號 (考慮標題列)
  });

  const rowNum = memberIndexMap[uNum];
  if (rowNum !== undefined) {
    // 找到候選人後，才抓取該列完整資料進行驗證
    const row = sheet.getRange(rowNum, 1, 1, sheet.getLastColumn()).getValues()[0];
    const sID = String(row[col.idCard]).trim();

    if (sID.endsWith(uLast4)) {
      // 檢查是否已經被其他 LINE 帳號綁定 (非本人)
      const existingUid = col.lineUid !== undefined ? String(row[col.lineUid] || '').trim() : '';
      if (existingUid && existingUid !== user.userId) {
        throw new Error('此社員編號已被其他 LINE 帳號綁定，如有疑問請聯繫分社人員。');
      }

      if (col.lineUid !== undefined) sheet.getRange(rowNum, col.lineUid + 1).setValue(user.userId);
      if (col.phone !== undefined) sheet.getRange(rowNum, col.phone + 1).setValue("'" + p.phone); 
      if (col.lineId !== undefined) sheet.getRange(rowNum, col.lineId + 1).setValue(p.lineId || '');
      
      return { message: `認證成功，${row[col.name] || '社員'} 您好！` };
    }
  }
  throw new Error('認證失敗：資料不匹配，請確認編號與證號末4碼是否正確。');
}

/**
 * 解除特定社員的綁定
 */
function apiUnbindMember(p, user, branch) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.MEMBERS);
  if (!sheet) throw new Error('找不到「社員清單」分頁');
  
  const col = getColMap(sheet);
  const targetNum = cleanMemberNum(p.num);
  const userId = user.userId;
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('社員清單尚無資料');
  
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  let foundInSheet = false;

  // 遍歷所有列，尋找同時符合「員編」與「LINE UID」的列
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const sNum = cleanMemberNum(row[col.num]);
    const sUid = String(row[col.lineUid] || '').trim();
    
    if (sNum === targetNum && sUid === userId) {
      const rowNum = i + 2;
      // 清空該列的綁定欄位
      if (col.lineUid !== undefined) sheet.getRange(rowNum, col.lineUid + 1).setValue('');
      if (col.phone !== undefined) sheet.getRange(rowNum, col.phone + 1).setValue('');
      if (col.lineId !== undefined) sheet.getRange(rowNum, col.lineId + 1).setValue('');
      foundInSheet = true;
      // 繼續搜尋，以防萬一有重複綁定的列
    }
  }
  
  if (foundInSheet) {
    return { message: '已成功解除綁定' };
  } else {
    return { message: '解除綁定成功' };
  }
}

function getMemberDataFromSheet(userId) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.MEMBERS);
    if (!sheet) return [];
    
    const col = getColMap(sheet);
    if (col.lineUid === undefined) return [];
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const results = [];
    
    data.forEach(row => {
      const sUid = String(row[col.lineUid] || '').trim();
      if (sUid === userId) {
        results.push({
          name: row[col.name] || "",
          num: row[col.num] || "",
          stock: row[col.stock] || 0,
          loan: row[col.loan] || 0,
          reserve: row[col.reserve] || 0,
          phone: row[col.phone] || "",
          lineId: row[col.lineId] || "",
          update: row[col.sync] ? formatDate(new Date(row[col.sync])) : "今日"
        });
      }
    });

    return results;
  } catch (e) {
    console.error("getMemberDataFromSheet Error: " + e.message);
    return [];
  }
}

function apiSyncFinancialData(accessData, branch) {
  const startTime = Date.now();
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.MEMBERS);
    const col = getColMap(sheet);
    if (col.num === undefined) throw new Error('找不到「社員編號」欄位');
    const oldDataRange = sheet.getDataRange();
    const oldRows = oldDataRange.getValues();
    const lastCol = Math.max(oldRows[0].length, 15); // 確保與 getColMap 一致，至少 15 欄
    const memberMap = {};
    for (let i = 1; i < oldRows.length; i++) {
      const rowData = [...oldRows[i]];
      while (rowData.length < lastCol) rowData.push('');

      const n = cleanMemberNum(rowData[col.num]);
      
      // 保護判斷：是否有 LINE 相關資訊
      const hasUid   = col.lineUid !== undefined && String(rowData[col.lineUid] || '').trim() !== "";
      const hasLid   = col.lineId  !== undefined && String(rowData[col.lineId]  || '').trim() !== "";
      const hasPhone = col.phone   !== undefined && String(rowData[col.phone]   || '').trim() !== "";
      
      if (n) {
        memberMap[n] = { rowIndex: i, rowData: rowData };
      } else if (hasUid || hasLid || hasPhone) {
        // 即使沒員編，但有綁定資訊，給予一個臨時 Key 確保它進入 memberMap 進行後續保護處理
        memberMap["TEMP_" + i] = { rowIndex: i, rowData: rowData };
      }
    }
    const now = new Date();
    const finalRows = [];
    const processedKeys = new Set();

    accessData.forEach(d => {
      const numKey = cleanMemberNum(d.num);

      if (processedKeys.has(numKey)) return; 
      processedKeys.add(numKey);

      let row;
      if (memberMap[numKey]) {
        row = [...memberMap[numKey].rowData];
        // 全量覆蓋：更新財務欄位
        row[col.name] = d.name; row[col.idCard] = d.idCard; row[col.stock] = d.stock; row[col.loan] = d.loan; row[col.reserve] = d.reserve; row[col.sync] = now;
      } else {
        row = new Array(lastCol).fill('');
        row[col.num] = d.num; row[col.name] = d.name; row[col.idCard] = d.idCard; row[col.stock] = d.stock; row[col.loan] = d.loan; row[col.reserve] = d.reserve; row[col.sync] = now;
      }
      finalRows.push(row);
    });

    // ── 實作凍結保留 (Freeze Retention) ──────────────────────────────
    for (const key in memberMap) {
      if (!processedKeys.has(key)) {
        const oldRow = [...memberMap[key].rowData]; // 複製舊資料
        const hasUid   = col.lineUid !== undefined && String(oldRow[col.lineUid] || '').trim() !== "";
        const hasLid   = col.lineId  !== undefined && String(oldRow[col.lineId]  || '').trim() !== "";
        const hasPhone = col.phone   !== undefined && String(oldRow[col.phone]   || '').trim() !== "";

        // 只要有綁定資訊，就執行保護，不從雲端移除，且維持最後一次財務紀錄
        if (hasUid || hasLid || hasPhone) {
          oldRow[col.sync] = now; // 僅更新同步標記時間
          finalRows.push(oldRow);
        }
      }
    }
    
    let resultMsg = "";
    if (finalRows.length > 0) {
      finalRows.sort((a,b) => (parseInt(String(a[col.num]).replace(/\D/g,''))||0) - (parseInt(String(b[col.num]).replace(/\D/g,''))||0));
      if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow()-1, lastCol).clearContent();
      sheet.getRange(2, 1, finalRows.length, lastCol).setValues(finalRows);
      resultMsg = `同步成功！已全量同步 ${finalRows.length} 筆資料至 Google Sheets。`;
    } else {
      resultMsg = "無資料。";
    }
    
    writeLog('SUCCESS', 'Access 同步完成', `耗時: ${(Date.now()-startTime)/1000}s, 總數: ${accessData.length} 筆`);
    return resultMsg;

  } catch (err) {
    writeLog('ERROR', '同步失敗', err.toString());
    throw err;
  }
}


/**
 * 系統日誌記錄器
 * @param {string} type 類型 (SUCCESS, ERROR, INFO)
 * @param {string} message 主旨
 * @param {string} detail 詳細資訊
 */
function writeLog(type, message, detail) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEETS.LOGS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEETS.LOGS);
      sheet.appendRow(['時間', '類型', '主旨', '詳細資訊']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 4).setBackground('#f3f3f3').setFontWeight('bold');
    }
    sheet.appendRow([new Date(), type, message, detail || '']);
    
    // 限制日誌數量在 1000 筆，避免過大
    const lastRow = sheet.getLastRow();
    if (lastRow > 1000) {
      sheet.deleteRows(2, lastRow - 1000);
    }
  } catch (e) {
    console.error('writeLog Error: ' + e.message);
  }
}

