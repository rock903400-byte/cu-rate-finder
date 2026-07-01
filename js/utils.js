/**
 * 工具模組 - 負責 UI 輔助與通用邏輯
 */

/**
 * 顯示 Toast 訊息
 * @param {Object} state Vue 響應式狀態
 * @param {string} msg 訊息內容
 */
function showToast(state, msg) {
  state.toast.message = msg;
  state.toast.show = true;
  setTimeout(() => state.toast.show = false, 3000);
}

/**
 * 簡單的手機格式驗證 (台灣手機格式)
 */
function isValidPhone(phone) {
  const phoneRegex = /^09\d{8}$/;
  return phoneRegex.test(phone);
}

/**
 * 簡單的身分證末四碼驗證 (4位數字)
 */
function isValidLast4(last4) {
  return /^\d{4}$/.test(last4);
}
