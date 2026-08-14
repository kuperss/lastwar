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
