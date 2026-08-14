-- 每日不重複到訪人數（彙總後就永久保留）
CREATE TABLE IF NOT EXISTS daily_visits (
  day      TEXT PRIMARY KEY,          -- 台灣時間的日期 'YYYY-MM-DD'
  visitors INTEGER NOT NULL DEFAULT 0
);

-- 當天的去重用暫存表：只記雜湊，不記 IP，且只保留最近幾天
CREATE TABLE IF NOT EXISTS visitor_seen (
  day          TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  PRIMARY KEY (day, visitor_hash)
);

CREATE INDEX IF NOT EXISTS idx_visitor_seen_day ON visitor_seen (day);

-- 每日各地區的不重複到訪人數。國家與城市由 Cloudflare 邊緣節點判定（request.cf），
-- 不需要查任何資料庫，也不會因此存下 IP。
CREATE TABLE IF NOT EXISTS daily_locations (
  day      TEXT NOT NULL,
  country  TEXT NOT NULL,          -- ISO 兩碼，判定不出來時是 'XX'
  city     TEXT NOT NULL,          -- 判定不出來時是空字串
  visitors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, country, city)
);

CREATE INDEX IF NOT EXISTS idx_daily_locations_day ON daily_locations (day);
