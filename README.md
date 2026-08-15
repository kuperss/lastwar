# Last War 閃亮隱祕任務速查工具

給 Last War 聯盟「KT」用的小工具，查今天輪到哪一組伺服器刷閃亮隱祕任務。

- **前台**：https://kuperss.github.io/lastwar/
- **後台（到訪統計）**：https://kuperss.github.io/lastwar/admin.html

## 規則

伺服器 #1381–#1444 依開服日分成三組，每天輪一組，**以台灣時間早上 10:00 為換日基準**。
分組由開服日決定，不會變動。

| 組別 | 錨點伺服器 |
|---|---|
| 第一組 | #1381 |
| 第二組 | #1382 |
| 第三組 | #1385 |

輪替順序固定是 1 → 2 → 3。2025-12-12 是第一組、12-13 是第二組。

## 三個組成部分

### 1. 前台（多版本）

前台可以同時上線好幾個版本，程式碼共用，只有幾行文字不一樣。

| 檔案 | 角色 |
|---|---|
| `templates/index.template.html` | **範本**，所有共用的 HTML／CSS／JS 都在這裡 |
| `variants.json` | 每個版本各自不同的文字 |
| `scripts/build-variants.mjs` | 產生器 |

產生出來的 `index.html`、`v2/index.html` 都標了「不要手動編輯」。**改東西一律改範本或
`variants.json`**，然後：

```bash
node scripts/build-variants.mjs
```

或雙擊 `build-variants.bat`。產出仍是單檔靜態頁，跟手寫的一樣快。

**新增一版**：在 `variants.json` 的 `variants` 陣列複製一組，改 `id`、`path` 和要換的文字。
**下架一版**：把該版的 `enabled` 改成 `false`，重跑產生器，那個資料夾會自動刪掉。
根目錄那一版不能下架（首頁不能是空的），產生器會擋。

`id` 會送給到訪統計用來分辨版本，**取好之後不要改**，改了統計會斷成兩截。

每個版本的功能完全相同：選日期查當天輪到的組別與伺服器清單、一鍵複製、反查某台伺服器
屬於哪一組還要幾天輪到。

選日期會顯示當天輪到的組別與完整伺服器清單，可一鍵複製丟群組；也能反查某台伺服器
屬於哪一組、還要幾天才輪到。

**分組資料完全來自 `data/shiny-groups.json`**，前端不寫死任何基準日：從資料檔的
`updatedAt` 與 `currentStatusByGroup` 反推錨點日和輪替順序。這樣週期萬一有變動，
重跑一次資料腳本前端就會跟上，不會靜默算錯。

> ⚠️ 日期運算一律使用 `Date.UTC` / `getUTC*`。混用本地時區 API 會讓台灣以外的使用者
> 算錯（實測倫敦差一天、美洲差兩天）。

### 2. `scripts/read-shiny-tasks.mjs` — 產生分組資料

從 https://cpt-hedge.com/servers 抓資料。它不是解析 HTML，而是去撈 Next.js 打包出來的
`_next/static/` chunk，從裡面內嵌的 `JSON.parse('...')` 取出伺服器清單，再依開服日分組。

```bash
node scripts/read-shiny-tasks.mjs
```

只印出結果不寫檔。要寫進 `data/shiny-groups.json` 加 `--write`。

雙擊 `update-shiny-groups.bat` 會一次做完「抓資料 → 寫檔 → commit → push」，內容沒變就不會 commit。

**什麼時候需要重跑？**
分組是常數，所以平常**不需要**。只有 #1444 之後開了新伺服器、要把腳本裡的 `MAX_SERVER`
調大時才需要。

### 3. `analytics/` — 到訪統計

GitHub Pages 是靜態空間沒辦法自己數人頭，所以計數放在 Cloudflare Worker + D1。
記錄每日不重複訪客，不放 cookie、不存 IP。

部署與設定方式見 [`analytics/README.md`](analytics/README.md)。

## 本機開發

```bash
python -m http.server 8791
```

然後開 http://127.0.0.1:8791/ 。`data/shiny-groups.json` 是用 `fetch` 讀的，
直接用 `file://` 開會被 CORS 擋掉，一定要起一個 server。

## 檔案

```
templates/index.template.html  前台範本 ← 改這裡
variants.json                  各版本的文字 ← 或改這裡
scripts/build-variants.mjs     產生器
build-variants.bat             一鍵產生

index.html                     ⚠️ 產生出來的，不要手動改
v2/index.html                  ⚠️ 產生出來的，不要手動改

admin.html                     後台到訪統計
data/shiny-groups.json         分組資料，唯一真相來源
scripts/read-shiny-tasks.mjs   產生上面那份資料
update-shiny-groups.bat        一鍵更新資料並推上 GitHub
analytics/                     Cloudflare Worker + D1 到訪統計
```
