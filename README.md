# ♠ 德州撲克 GTO 練習助手

一個**純前端、免安裝**的德州撲克 GTO 學習工具：翻前範圍查詢、隨機練習、Equity 計算、翻後決策建議。開瀏覽器就能用，桌機與手機皆可。

> ⚠️ 本工具是**學習用起點**。翻前為固定範圍表、翻後決策為「基本原則」啟發式建議，皆非針對對手的精確剝削或 solver 精確解。

---

## ✨ 功能

| 模式 | 內容 |
|------|------|
| **範圍表** | RFI 開牌 / 面對加注 / 被 3-bet 三情境 × 6-max 與 9-max × 共 61 個對戰組。GTOwizard 風格分色網格、覆蓋率、條列清單、**加權編輯器**（可自訂混合頻率並存檔） |
| **隨機練習** | 依情境出題（加注／3-bet／4-bet／跟注／蓋牌），可**混合三情境**一起出題增加變化；**鍵盤快捷**（1/2/3 + 空白鍵）、**限時 60 秒挑戰**、**錯題本複習**、計分連對 |
| **Equity** | 範圍 vs 範圍勝率（蒙地卡羅）、**逐手熱圖**、可**指定公牌**算翻後 equity |
| **翻後決策** | 選角色/位置/人數 + 手牌 + 公牌（下拉選或打字）→ 牌面材質、成手/聽牌判斷、equity、啟發式下注/過牌建議（附「隨機情境練習」） |
| **錦標賽計時器** | 獨立頁面 [`timer.html`](timer.html)：盲注結構編輯器（模板/休息）、大字倒數＋升盲音效、玩家/重買/加碼計數、獎池與名次分配計算、平均籌碼、手機亮屏鎖定，狀態存 localStorage |

---

## 🕹️ 線上遊玩（GitHub Pages）

任何裝置的瀏覽器打開這個網址即可，**手機也行**：

### 👉 https://jason871022.github.io/gto-preflop/

## 💻 本機執行

無需安裝任何套件，任選一種：

```bash
# 方法一：Python 內建伺服器
cd gto-preflop
python3 -m http.server 8123
# 瀏覽器開 http://localhost:8123
```

或直接用瀏覽器打開 `index.html` 也可以（Equity/練習/範圍表都能用；翻後 Solver 因跨來源限制建議用伺服器方式或線上版）。

### 同一個 WiFi 下用手機玩本機版
1. 電腦執行上面的 `python3 -m http.server 8123`
2. 查電腦區網 IP（macOS：`ipconfig getifaddr en0`）
3. 手機瀏覽器開 `http://<電腦IP>:8123`

---

## 🚀 部署到 GitHub Pages（手機隨時能玩）

> 📄 **要把專案搬到另一個帳號、或看完整的部署/更新/疑難排解**，請看 **[DEPLOY.md](DEPLOY.md)**（含多帳號切換、自訂部署工作流程、部署失敗處理）。

只要做一次，之後每次 `git push` 都會自動更新。

```bash
cd gto-preflop
git init
git add .
git commit -m "GTO 翻前工具"
git branch -M main
git remote add origin https://github.com/<你的帳號>/gto-preflop.git
git push -u origin main
```

然後在 GitHub 網頁：**Settings → Pages → Build and deployment → Source 選 "Deploy from a branch" → 選 `main` / `/ (root)` → Save**。等一兩分鐘，就會給你上面那個網址。手機加到主畫面就像 App 一樣。

> GitHub Pages 免費方案需要 **public 儲存庫**。

---

## 📁 專案結構

```
gto-preflop/
├── index.html          # 版面與五個模式
├── timer.html          # 錦標賽計時器（獨立頁面）
├── css/style.css       # GTOwizard 風格深色主題 + 手機自適應
├── css/timer.css       # 計時器頁面樣式
└── js/
    ├── hands.js        # 手牌網格 + 範圍字串解析器（"22+, ATs+, KQo"）
    ├── eval.js         # 7 張牌力評估 + 蒙地卡羅 equity
    ├── postflop.js     # 啟發式翻後分析（牌面材質/成手/決策）
    ├── ranges.js       # 全部範圍資料（可編輯校正）
    ├── timer.js        # 錦標賽計時器邏輯（盲注時鐘/計分/獎池）
    └── app.js          # 介面邏輯
```

改了 `js`/`css` 後若瀏覽器沒更新，把 `index.html` 裡的 `?v=N` 版本號 +1 即可（快取破除）。

---

## 📚 資料來源與致謝

- **9-max 翻前範圍**：PokerCoaching（Jonathan Little）100bb 圖表，組合數已對齊。
- **6-max 與面對加注/被 3-bet**：以標準 solver 頻率為基準的重建，可用「編輯模式」逐格校正。
- **翻後決策**：本專案自製的啟發式引擎（牌力評估 + 牌面材質 + 位置/人數原則），非 solver 精確解。
- 畫面與配色參考 [GTOwizard](https://gtowizard.com/)。

## ⚖️ 免責

僅供撲克策略學習之用。範圍為固定起點，實戰請依對手調整。
