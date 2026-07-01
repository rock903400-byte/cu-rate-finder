const { createApp, ref, reactive, onMounted, computed } = Vue;

// 全域變數，由 startApp 初始化
let CURRENT_CONFIG, GAS_URL, CURRENT_ID;

async function startApp() {
  // ⚡ 究極強韌化參數抓取：掃描整個 URL 字串
  const getParam = (name) => {
    const results = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)').exec(window.location.href);
    return results ? decodeURIComponent(results[2] || '').replace(/\+/g, ' ') : null;
  };

  CURRENT_ID = getParam('id') || localStorage.getItem('current_club_id');

  if (!CURRENT_ID) {
    document.body.innerHTML = `<div style="padding:20px; text-align:center;"><h3>系統初始化失敗</h3><p>未指定分社代碼，請確認您的專屬網址是否正確。</p></div>`;
    return;
  }
  localStorage.setItem('current_club_id', CURRENT_ID);

  // 1. 動態載入分社設定檔
  try {
    const response = await fetch(`./config/${CURRENT_ID}.json`);
    if (!response.ok) throw new Error('Config not found');
    CURRENT_CONFIG = await response.json();
  } catch (e) {
    console.error(`無法載入分社設定 (${CURRENT_ID})`, e);
    document.body.innerHTML = `<div style="padding:20px; text-align:center;"><h3>系統初始化失敗</h3><p>找不到代碼為「${CURRENT_ID}」的分社設定。</p></div>`;
    localStorage.removeItem('current_club_id');
    return;
  }

  GAS_URL = CURRENT_CONFIG.gas;

  const app = createApp({
    setup() {
      const state = reactive({
        currentPage: 'home',
        token: '',
        lineProfile: { displayName: '載入中...', pictureUrl: '', userId: '' },
        memberProfile: null, // 當前選中的社員
        memberProfiles: [],  // 所有綁定的社員列表
        toast: { show: false, message: '' },
        clubName: CURRENT_CONFIG.name,
        isSubmitting: false,
        isLoading: false,
        showAccountMenu: false
      });

      // ── 使用原生 JS 監控焦點 ──────────────
      onMounted(() => {
        // 已移除隱藏導覽列邏輯，保留 iOS 原生滾動行為
      });

      const bindForm = reactive({ num: '', last4: '', phone: '', lineId: '' });

      // ── 立即載入快取 (Optimistic UI) ───────────────────────────────
      const cachedLine = localStorage.getItem('line_profile');
      if (cachedLine) state.lineProfile = JSON.parse(cachedLine);
      
      const cachedMembers = localStorage.getItem(`members_${CURRENT_ID}`);
      if (cachedMembers) {
        state.memberProfiles = JSON.parse(cachedMembers);
        state.memberProfile = state.memberProfiles[0];
      }

      // ── 封裝後的 API 呼叫 ──────────────────────────────────────────
      const apiProxy = async (action, params = {}) => {
        if (liff.isLoggedIn()) state.token = liff.getAccessToken();
        return await callAPI(action, params, { gasUrl: GAS_URL, token: state.token, state });
      };

      const navigate = (page) => {
        if (state.currentPage === page) return; 
        state.currentPage = page;
        if (page === 'home') loadHome(false);
      };

      const loadHome = async (showLoading = true) => {
        if (!state.lineProfile.userId) return;
        try {
          if (showLoading) state.isLoading = true;
          let data = await apiProxy('getMemberProfile', { id: CURRENT_ID });
          if (data) {
            if (!Array.isArray(data)) data = [data];
            state.memberProfiles = data;
            localStorage.setItem(`members_${CURRENT_ID}`, JSON.stringify(data));
            
            // 決定目前的選中社員
            if (!state.memberProfile || !data.find(m => m.num === state.memberProfile.num)) {
              state.memberProfile = data[0];
            } else {
              state.memberProfile = data.find(m => m.num === state.memberProfile.num);
            }
          }
        } finally { state.isLoading = false; }
      };

      const switchMember = (member) => {
        state.memberProfile = member;
        state.showAccountMenu = false;
        showToast(state, `已切換至 ${member.name}`);
      };

      const submitUnbind = async () => {
        if (!state.memberProfile) return;
        const targetNum = state.memberProfile.num;
        const targetName = state.memberProfile.name;
        
        if (!confirm(`確定解除「${targetName}」的綁定？`)) return;
        
        try {
          state.isLoading = '正在安全登出與清理資料...';
          state.isSubmitting = true;
          const res = await apiProxy('unbindMember', { num: targetNum });
          
          if (res) {
            showToast(state, res.message);
          } else {
            console.warn('後端登出失敗或超時，執行前端強制清理');
            showToast(state, '連線異常，已執行強制登出');
          }
          
          // ── 前端狀態清理 ────────────────────────────────────────
          state.memberProfiles = state.memberProfiles.filter(m => m.num !== targetNum);
          localStorage.setItem(`members_${CURRENT_ID}`, JSON.stringify(state.memberProfiles));
          
          if (state.memberProfiles.length > 0) {
            switchMember(state.memberProfiles[0]);
          } else {
            state.memberProfile = null;
            localStorage.removeItem(`members_${CURRENT_ID}`);
            location.reload(); 
          }
        } catch (err) {
          console.error('Logout Error:', err);
          alert('登出過程發生錯誤，已嘗試強制清理。');
          location.reload();
        } finally { 
          state.isSubmitting = false; 
          state.isLoading = false;
          state.showAccountMenu = false; 
        }
      };

      const submitBind = async () => {
        if (!bindForm.num || !bindForm.last4 || !bindForm.phone) return showToast(state, '請填寫必填欄位');
        if (!isValidLast4(bindForm.last4)) return showToast(state, '身分證末四碼格式錯誤 (需為4位數字)');
        if (!isValidPhone(bindForm.phone)) return showToast(state, '手機格式錯誤 (範例: 0912345678)');

        const msg = `確認要綁定社員編號: ${bindForm.num}\n手機: ${bindForm.phone} 嗎？`;
        if (!confirm(msg)) return;

        try {
          state.isSubmitting = true;
          const res = await apiProxy('bindMember', { ...bindForm });
          if (res) { 
            state.isLoading = '正在同步財務資料...';
            await loadHome(false);
            showToast(state, res.message);
            navigate('home');
            Object.assign(bindForm, { num: '', last4: '', phone: '', lineId: '' });
          }
        } finally { state.isSubmitting = false; state.isLoading = false; }
      };

      onMounted(async () => {
        try {
          await liff.init({ liffId: CURRENT_CONFIG.liffId });
          if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return; }
          const p = await liff.getProfile();
          if (p) { state.lineProfile = p; localStorage.setItem('line_profile', JSON.stringify(p)); }
          await loadHome(!state.memberProfiles.length);
        } catch (err) { console.error('Init Error:', err); state.isLoading = false; showToast(state, '連線中...'); }
      });

      return {
        state, bindForm, navigate, submitBind, loadHome, switchMember, submitUnbind
      };
    }
  });

  app.config.errorHandler = (err) => console.error("Vue Error:", err);
  app.mount('#app');
}

startApp();
