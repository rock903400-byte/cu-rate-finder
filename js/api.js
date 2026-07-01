/**
 * API 模組 - 負責與 GAS 後端通訊
 */

async function callAPI(action, params = {}, config = {}) {
  const { gasUrl, token, state } = config;
  const timeout = 10000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const isGet = ['getMemberProfile'].includes(action);
  const url = isGet ? `${gasUrl}?action=${action}&token=${token}&${new URLSearchParams(params)}` : gasUrl;
  const options = isGet ? 
    { method: 'GET', signal: controller.signal } : 
    { method: 'POST', signal: controller.signal, body: JSON.stringify({ action, token: token, ...params }) };
  
  try {
    const res = await fetch(url, options);
    clearTimeout(timeoutId);
    const text = await res.text();
    
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error("GAS 回傳非 JSON 內容:", text);
      throw new Error("後端回傳格式錯誤 (可能正在維護中)");
    }

    if (!json.success) throw new Error(json.error);
    return json.data;
  } catch(e) {
    clearTimeout(timeoutId);
    const msg = e.name === 'AbortError' ? '連線超時，請檢查網路或稍後再試' : e.message;
    if (msg !== '尚未認證' && state) {
      showToast(state, msg);
    }
    console.error("API Error:", e);
    return null;
  }
}
