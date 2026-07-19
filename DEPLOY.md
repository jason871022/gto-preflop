# 部署與交接指南（搬到另一個帳號 / 日後維護）

這份文件說明如何把「德州撲克 GTO 練習助手」整個專案搬到**另一個 GitHub 帳號**、部署到 GitHub Pages、以及日後怎麼更新。內容自足，不需要原本的對話紀錄。

---

## 0. 這是什麼專案

- **純前端靜態網頁**（只有 HTML / CSS / JS，沒有後端、不用編譯、不用 npm install）。
- 開瀏覽器就能跑；丟上 GitHub Pages 就有公開網址，手機也能玩。
- 目前線上版：`https://jason871022.github.io/gto-preflop/`（搬帳號後會換成新帳號的網址）。

### 檔案結構
```
gto-preflop/
├── index.html                 # 主頁面（五個模式的版面）
├── timer.html                 # 錦標賽計時器（獨立頁面，網址 /timer.html）
├── css/style.css              # 深色主題 + 手機自適應
├── css/timer.css              # 計時器頁面樣式
├── js/
│   ├── hands.js               # 手牌網格 + 範圍字串解析器
│   ├── eval.js                # 7 張牌力評估 + 蒙地卡羅 equity
│   ├── postflop.js            # 啟發式翻後分析
│   ├── ranges.js              # 全部範圍資料
│   ├── timer.js               # 錦標賽計時器邏輯
│   └── app.js                 # 介面邏輯
├── .github/workflows/deploy.yml  # ★ GitHub Pages 自動部署工作流程
├── README.md
├── DEPLOY.md                  # 本文件
└── .gitignore
```

---

## 1. 把專案搬到另一個帳號（完整步驟）

假設新帳號叫 `<新帳號>`，新 repo 想叫 `gto-preflop`。

### 步驟 A：拿到程式碼
把整個 `gto-preflop/` 資料夾複製到新電腦（或同一台），**確定裡面有 `.github/workflows/deploy.yml`**（隱藏資料夾，別漏掉）。

### 步驟 B：讓 git / gh 指向新帳號

> ⚠️ **多帳號注意**：如果這台電腦的 `gh`（GitHub CLI）同時登入了多個帳號（例如公用帳號 + 個人帳號），推之前一定要先切到正確的帳號，否則會推錯地方。

```bash
# 看目前登入哪些帳號
gh auth status

# 若新帳號還沒登入，先登入（會開瀏覽器）
gh auth login          # 選 GitHub.com → HTTPS → Login with a web browser

# 切換到要用的帳號
gh auth switch --user <新帳號>

# 確認目前是哪個帳號
gh api user -q .login
```

### 步驟 C：建立 repo 並推上去

```bash
cd gto-preflop

# 如果這個資料夾還不是 git repo：
git init
git add .
git commit -m "初次提交"
git branch -M main

# 如果本來就有舊帳號的 remote，先移除：
git remote remove origin 2>/dev/null

# 建 public repo（免費方案的 Pages 需要 public）並推送
gh repo create <新帳號>/gto-preflop --public --source=. --remote=origin --push \
  --description "德州撲克 GTO 練習助手"
```

### 步驟 D：開啟 GitHub Pages（用本專案內建的自訂工作流程）

本專案用**自訂 Actions 工作流程**部署（不是預設的「Deploy from a branch」），所以要把 Pages 來源設成 **GitHub Actions**：

**用指令：**
```bash
gh api --method PUT /repos/<新帳號>/gto-preflop/pages -f build_type=workflow
# 若回應 404（Pages 尚未啟用），先用下面這行啟用一次再重跑上面那行：
echo '{"build_type":"workflow"}' | gh api --method POST /repos/<新帳號>/gto-preflop/pages --input -
```

**或用網頁：** repo → **Settings → Pages → Build and deployment → Source 選「GitHub Actions」**。

推上去後，`.github/workflows/deploy.yml` 會自動觸發部署。完成後網址是：
```
https://<新帳號>.github.io/gto-preflop/
```

---

## 2. 日常更新流程

改完程式後：

```bash
cd gto-preflop
# ★ 重要：破除瀏覽器快取——把 index.html 裡的 ?v=N 全部 +1
#   （目前是 v=8，下次改成 v=9，再下次 v=10…）
#   可用這行一次全換（macOS）：
sed -i '' 's/?v=8/?v=9/g' index.html
# timer.html 的 css/js 有自己的 ?v=N（目前 v=4），改到計時器相關檔案時同樣 +1：
sed -i '' 's/?v=4/?v=5/g' timer.html

git add -A
git commit -m "說明這次改了什麼"
git push
```

推上去後，GitHub 會自動重新部署。等 Actions 出現綠勾 ✔，再把網站**強制重新整理**（手機：關分頁重開或用無痕）就是新版。

> **為什麼要改 `?v=N`？** 瀏覽器會快取 css/js，改了檔案但網址沒變時，瀏覽器可能還用舊的。把 `?v=7` 改成 `?v=8` 等於換了網址，強制抓新檔。`index.html` 裡 css 一處、js 五處，共 6 個地方，`sed` 那行會一次全部換掉。

---

## 3. ⚠️ 已知問題：GitHub Pages 部署有時會失敗（很重要）

**症狀**：Actions 的「Deploy to GitHub Pages」失敗，log 顯示部署卡在 `deployment_queued`，約 10 分鐘後 `Timeout reached, aborting!`。

**原因**：這**不是程式問題**。是 GitHub 的 Pages 後端**暫時性壅塞**——發布一次要超過 10 分鐘，而 GitHub 對這步有**硬性 10 分鐘上限**（`actions/deploy-pages` 的 timeout 設再大也會被打回 10 分鐘），剛好超過就失敗。

**怎麼辦**：
1. **換個時段再試**（最有效）。後端不塞時，同樣的部署會在 10 分鐘內跑完、成功。
2. 到 repo → **Actions** → 對最新那筆「Deploy to GitHub Pages」點 **「Re-run jobs」**；或用指令：
   ```bash
   gh workflow run deploy.yml --ref main      # 手動觸發一次
   # 或重跑最近失敗的：
   gh run rerun $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId') --failed
   ```
3. **程式碼不會因為部署失敗而消失**——它已經在 GitHub 上了，只是「發布」那步要等 GitHub 有空。多試幾次/換時段一定會成功（第一次部署就是這樣成功的）。

---

## 4. 本機執行（不靠 GitHub，隨時能玩最新版）

```bash
cd gto-preflop
python3 -m http.server 8123
```
- 電腦瀏覽器開 `http://localhost:8123`
- **同一個 WiFi 的手機**開 `http://<電腦區網IP>:8123`
  - 查電腦 IP（macOS）：`ipconfig getifaddr en0`

（直接雙擊 `index.html` 也能開，多數功能可用。）

---

## 5. 疑難排解速查

| 症狀 | 處理 |
|------|------|
| 推送推到錯的帳號 | `gh auth switch --user <正確帳號>`，再 `git remote set-url origin https://github.com/<正確帳號>/gto-preflop.git` 後重推 |
| Pages 顯示 404 / Site not found | 部署還沒好，等 Actions 綠勾；或確認 Settings→Pages 來源是「GitHub Actions」 |
| 網站沒更新成新版 | 沒改 `?v=N`（改一下 +1 再推），或瀏覽器快取（強制重新整理／無痕） |
| Deploy 失敗 timeout | 見上面第 3 節，換時段 Re-run |
| 免費帳號 private repo 不能用 Pages | Pages 免費方案需 public repo；把 repo 改成 public 或用付費方案 |
| 誤建 repo 想刪但 gh 沒權限 | 到該 repo 網頁 Settings → Danger Zone → Delete repository 手動刪 |

---

## 6. 資料與授權備註

- 9-max 翻前範圍來自 PokerCoaching 100bb 圖表；6-max 與面對加注/被 3-bet 為標準頻率重建，可用工具內「編輯模式」校正。
- 翻後決策是本專案自製的**啟發式**引擎（非 solver 精確解）。
- 純自製程式碼，無外部授權綁定（先前曾嵌入的第三方 solver iframe 已移除）。
