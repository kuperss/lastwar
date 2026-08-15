# 到訪統計後台

GitHub Pages 是純靜態空間，沒有辦法自己數人頭，所以計數放在一支 Cloudflare Worker，
資料存在 Cloudflare D1（就是一顆 SQLite）。前台每次載入打一次 `/hit`，
後台頁面 `admin.html` 讀 `/stats` 畫圖。

- 前台：https://kuperss.github.io/lastwar/
- 後台：https://kuperss.github.io/lastwar/admin.html

## 計數方式

記的是**每日不重複訪客**：同一個人同一天開十次只算 1。

判斷「同一個人」的做法是把 `salt + 日期 + IP + User-Agent` 做 SHA-256，只留雜湊值。

- 不放 cookie，不需要同意橫幅
- 資料庫裡沒有 IP，也還原不回 IP
- 雜湊只留 7 天，每天台灣時間 02:30 由 cron 自動清掉
- 每日人數彙總後永久保留（`daily_visits` 表）

同時記錄**國家與城市**（`daily_locations` 表）。這兩個值直接來自 `request.cf`，
是 Cloudflare 邊緣節點附在請求上的，不需要查任何資料庫，也不會因此存下 IP。
判定不出來時國家記成 `XX`、城市記成空字串。

> ⚠️ 城市層級在使用者很少的時候，「某城市 1 人」幾乎等於指認到個人。
> 這是刻意選擇的取捨；只想要國家的話，把 worker 裡寫入 `daily_locations` 的
> `city` 固定成空字串即可，其他都不用動。

## 版本

前台可以有多個版本（見專案根目錄的 `variants.json`），前台呼叫 `/hit?v=<id>` 帶上自己的
版本代號。代號只接受小寫英數與連字號，其餘一律歸到 `unknown`。

去重的方式是**每個版本各自去重**：`visitor_seen` 的主鍵是 `(day, variant, visitor_hash)`，
所以同一個人看了兩版會有兩列，`daily_variants` 兩版各加一。

但「當日總人數」不會因此重複計算 —— 寫入前會先數這個 hash 今天總共出現在幾個版本，
**剛好 1 才算新訪客**，才寫 `daily_visits` 與 `daily_locations`。

換句話說：`variants` 的總和 ≥ 當日總人數，差額就是同時看了多個版本的人。

## 部署步驟

需要一個 Cloudflare 免費帳號。以下指令都在 `analytics/` 資料夾裡跑。

**1. 安裝並登入**

```bash
npm install -g wrangler
```

```bash
wrangler login
```

**2. 建立 D1 資料庫**

```bash
wrangler d1 create lastwar-stats
```

它會印出一段 `database_id = "xxxxxxxx-..."`，把那串 id 貼進 `wrangler.toml` 取代原本的中文提示。

**3. 建表**

```bash
wrangler d1 execute lastwar-stats --remote --file=schema.sql
```

**4. 設定兩組密鑰**

`VISITOR_SALT` 是去重雜湊用的鹽，隨便一串長亂碼即可，設定後不要再改（改了當天會重複計數）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
wrangler secret put VISITOR_SALT
```

`ADMIN_KEY` 是你登入後台要打的密碼，自己想一個：

```bash
wrangler secret put ADMIN_KEY
```

**5. 部署**

```bash
wrangler deploy
```

成功後會印出網址，長得像 `https://lastwar-stats.你的帳號.workers.dev`。

**6. 把網址填回兩個頁面**

- `index.html` 裡的 `const ANALYTICS_ENDPOINT = '';`
- `admin.html` 裡的 `const ANALYTICS_ENDPOINT = '';`

兩邊都填同一個網址，**結尾不要加斜線**。填完 commit + push，GitHub Pages 更新後就開始計數。

第一次開後台會問密碼，輸入步驟 4 設的 `ADMIN_KEY`，之後存在瀏覽器的 localStorage 裡。

## 本機測試

```bash
wrangler d1 execute lastwar-stats --local --file=schema.sql
```

```bash
wrangler dev --local
```

`wrangler dev` 預設跑在 `http://127.0.0.1:8787`。本機測試時 `VISITOR_SALT` / `ADMIN_KEY`
不會自動帶入，在 `analytics/.dev.vars` 裡寫兩行就好（這個檔案不要 commit）：

```
VISITOR_SALT=local-test-salt
ADMIN_KEY=local-test-key
```

`wrangler.toml` 的 `ALLOWED_ORIGINS` 已經留了 `http://127.0.0.1:8791`，
所以在本機用 `python -m http.server 8791` 開前台就能一起測。

## API

| 路由 | 方法 | 說明 |
|---|---|---|
| `/hit` | POST | 記錄一次到訪。只接受 `ALLOWED_ORIGINS` 名單內的來源，避免被灌數字 |
| `/stats?days=N` | GET | 讀統計，需要 `Authorization: Bearer <ADMIN_KEY>`。`days` 預設 60、上限 400 |

`/stats` 回傳：

```json
{
  "today": "2026-08-15",
  "todayVisitors": 12,
  "totalVisitors": 1043,
  "activeDays": 96,
  "firstDay": "2026-05-11",
  "series": [{ "day": "2026-06-17", "visitors": 8 }],
  "countries": [
    {
      "country": "TW",
      "visitors": 28,
      "cities": [{ "city": "Taipei", "visitors": 14 }]
    }
  ]
}
```

`series` 會把沒人來的日子補成 0，後台畫圖才不會斷線。

`countries` **只涵蓋這次查詢的 `days` 區間**，所以它的總和跟 `totalVisitors`（全期間）
不會相等。後台的「來源地區」面板標了「最近 N 天」就是這個意思。

國家代碼在後台是用瀏覽器內建的 `Intl.DisplayNames` 轉成中文國名，沒有維護任何對照表。

## 改了 schema 之後

`schema.sql` 全部是 `CREATE TABLE IF NOT EXISTS`，**新增**資料表或索引時直接重跑就好：

```bash
npx wrangler d1 execute lastwar-stats --remote --file=schema.sql
```

新欄位只會從執行的那一刻開始有資料，**既有的舊資料補不回來**。

⚠️ 但 `IF NOT EXISTS` **不會修改已經存在的資料表**。像加版本統計時 `visitor_seen` 的主鍵
從 `(day, hash)` 變成 `(day, variant, hash)`，就必須先手動 DROP 再重跑：

```bash
npx wrangler d1 execute lastwar-stats --remote --command "DROP TABLE IF EXISTS visitor_seen;"
```

`visitor_seen` 可以安全地 DROP —— 它只是 7 天內的去重暫存，統計數字都在 `daily_visits`
和 `daily_locations` 裡，不受影響。唯一的副作用是當天的去重狀態歸零，同一個人如果當天
再訪一次會被多算一次。**其他資料表不要這樣處理，那會真的刪掉統計。**

## 費用

Cloudflare 免費方案：Workers 每天 10 萬次請求，D1 每天 10 萬列寫入、500 萬列讀取。
一個聯盟的用量大概是每天幾十到幾百次，離上限差好幾個數量級，不會產生費用。

## 換日時間

統計用的是**台灣時間 00:00 換日**，跟遊戲的 10:00 重置無關 —— 這裡數的是人，不是遊戲週期。
