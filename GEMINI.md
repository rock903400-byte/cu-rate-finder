# Project: 儲互社數位服務網 (CUB Digital Service)

## 📌 專案概覽 (Project Overview)
這是一個為儲蓄互助社 (CUB) 量身打造的**精品級數位轉型方案**。系統將本地 Microsoft Access 資料庫 (`CUB.MDB`) 的財務數據，透過自動化腳本安全地同步至 Google Sheets，並提供社員一個具備**私人銀行級質感**的 LINE LIFF 查詢入口。

### 🏗️ 系統架構 (Architecture)
- **核心資料庫**: Microsoft Access ➡️ Google Sheets (雲端唯一的 Single Source of Truth)。
- **同步引擎**: 32-bit PowerShell 腳本，具備智慧型比對與凍結保留機制。
- **後端邏輯**: Google Apps Script (GAS) Web App，負責 RESTful API 與 LINE 身分驗證。
- **旗艦前端**: Vue.js 3 響應式框架，採用 **Premium UI** 設計語彙（毛玻璃效果、多層次陰影、精緻排版）。

## 🛠️ 視覺與品牌識別 (Visual Identity)
- **正式名稱**: 儲互社數位服務網
- **品牌圖示**: 🏡 綠意建築 (優化版 SVG)。
    - **玻璃質感設計**: 採用半透明白色主體與高光輪廓線，解決大面積反白問題，視覺更輕盈精緻。
    - **寓意**: 房屋象徵家園安定，薄荷綠幼苗象徵資產成長。
- **排版規範**: 
    - **雙層標題結構**: 採用 17px 主標與 12px 薄荷綠副標，確保垂直對齊與階層美感。
    - **高級感色調**: 深邃森林綠 (#103121) 配搭香檳金 (#d4af37) 邊框。

## 📂 目錄結構 (Final Directory Structure)
- `index.html`: 旗艦版前端入口，含優化版 SVG Logo 與品牌文案。
- `style.css`: 精品級樣式定義檔，包含文字比例與毛玻璃特效。
- `程式碼.gs`: 純淨版後端腳本 (直連 Sheets)。
- `js/`:
    - `app.js`: 前端核心邏輯 (還原為簡潔參數抓取版)。
    - `api.js`: GAS API 通訊封裝。
    - `utils.js`: 通用工具函數。
- `config/`: 各分社專屬 JSON 設定檔。
- `cub/`: 本地同步腳本工具組。

## ⚙️ 核心流程 (Core Workflow)
1. **數據同步**: PowerShell 提取 Access 資料後推送到 GAS。
2. **身分識別**: 使用者透過 LINE LIFF 登入。
3. **安全查詢**: GAS 驗證 Token 後，從 Sheets 搜尋並回傳財務資料。

## 🚀 維護與安全性 (Maintenance & Security)
- **環境設定**: GAS 指令碼屬性需設定 `SYNC_API_KEY`。
- **上傳保護**: `.gitignore` 已配置，嚴禁上傳個資與金鑰。

## 💻 更新日誌 (Session Log)
- **2026/05/05**: 
    - **UI 深度優化**: 解決 Logo 反白問題，導入半透明玻璃質感 SVG。
    - **排版精進**: 重塑 Header 文字比例，放大分社名稱並優化垂直對齊。
    - **品牌重塑**: 完成「儲互社數位服務網」全套視覺化升級。
    - **架構轉換**: 成功從 Firebase 遷移至純 GAS + Sheets 架構。
