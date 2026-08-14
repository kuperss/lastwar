/**
 * 閃亮任務速查工具 — 到訪統計
 *
 * POST /hit    前台每次載入呼叫一次，記錄一名「當日不重複訪客」
 * GET  /stats  後台讀取，需要 Authorization: Bearer <ADMIN_KEY>
 *
 * 不放 cookie、不存 IP。去重的做法是把 salt + 日期 + IP + UA 做 SHA-256，
 * 只留雜湊值，而且雜湊只保留 RETENTION_DAYS 天，過期就刪掉。
 */

const RETENTION_DAYS = 7;
const DEFAULT_STATS_DAYS = 60;
const MAX_STATS_DAYS = 400;

// 台灣固定 UTC+8 且不實施日光節約，直接加 8 小時就是當地日期
function taipeiDay(date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDay(day, days) {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

async function visitorHash(request, day, salt) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const ua = request.headers.get("User-Agent") ?? "";
  const payload = new TextEncoder().encode(`${salt}|${day}|${ip}|${ua}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);

  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  if (origin && allowedOrigins(env).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(body, request, env, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env),
    },
  });
}

async function handleHit(request, env) {
  if (!env.VISITOR_SALT) {
    return json({ error: "VISITOR_SALT 尚未設定" }, request, env, 500);
  }

  // 只接受列在 ALLOWED_ORIGINS 的來源，避免別人拿這支 API 灌數字
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) {
    return json({ error: "來源不被允許" }, request, env, 403);
  }

  const day = taipeiDay(new Date());
  const hash = await visitorHash(request, day, env.VISITOR_SALT);

  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO visitor_seen (day, visitor_hash) VALUES (?, ?)",
  )
    .bind(day, hash)
    .run();

  const isNewVisitor = inserted.meta.changes > 0;

  if (isNewVisitor) {
    await env.DB.prepare(
      `INSERT INTO daily_visits (day, visitors) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET visitors = visitors + 1`,
    )
      .bind(day)
      .run();
  }

  return json({ ok: true, counted: isNewVisitor }, request, env);
}

async function handleStats(request, env) {
  if (!env.ADMIN_KEY) {
    return json({ error: "ADMIN_KEY 尚未設定" }, request, env, 500);
  }

  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_KEY}`) {
    return json({ error: "密碼錯誤" }, request, env, 401);
  }

  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get("days"));
  const days = Number.isInteger(requestedDays) && requestedDays > 0
    ? Math.min(requestedDays, MAX_STATS_DAYS)
    : DEFAULT_STATS_DAYS;

  const today = taipeiDay(new Date());
  const since = shiftDay(today, -(days - 1));

  const [recent, totals] = await env.DB.batch([
    env.DB.prepare(
      "SELECT day, visitors FROM daily_visits WHERE day >= ? ORDER BY day ASC",
    ).bind(since),
    env.DB.prepare(
      `SELECT COALESCE(SUM(visitors), 0) AS total,
              COUNT(*)                   AS activeDays,
              MIN(day)                   AS firstDay
       FROM daily_visits`,
    ),
  ]);

  const byDay = new Map(recent.results.map((row) => [row.day, row.visitors]));

  // 沒人來的日子資料庫裡沒有列，這裡補成 0，後台畫圖才不會斷掉
  const series = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = shiftDay(since, offset);
    series.push({ day, visitors: byDay.get(day) ?? 0 });
  }

  const summary = totals.results[0] ?? { total: 0, activeDays: 0, firstDay: null };

  return json(
    {
      today,
      todayVisitors: byDay.get(today) ?? 0,
      totalVisitors: summary.total,
      activeDays: summary.activeDays,
      firstDay: summary.firstDay,
      series,
    },
    request,
    env,
  );
}

async function pruneOldHashes(env) {
  const cutoff = shiftDay(taipeiDay(new Date()), -RETENTION_DAYS);
  const result = await env.DB.prepare("DELETE FROM visitor_seen WHERE day < ?")
    .bind(cutoff)
    .run();

  console.log(`清掉 ${cutoff} 之前的去重雜湊 ${result.meta.changes} 筆`);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (pathname === "/hit" && request.method === "POST") {
      return handleHit(request, env);
    }

    if (pathname === "/stats" && request.method === "GET") {
      return handleStats(request, env);
    }

    return json({ error: "Not found" }, request, env, 404);
  },

  // wrangler.toml 的 cron 每天叫一次，把過期的去重雜湊清掉
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pruneOldHashes(env));
  },
};
