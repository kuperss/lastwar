#!/usr/bin/env node

const SOURCE_URL = "https://cpt-hedge.com/servers";
const MIN_SERVER = 1381;
const MAX_SERVER = 1444;
const DAY_MS = 24 * 60 * 60 * 1000;

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "lastwar-shiny-reader/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${response.statusText}: ${url}`);
  }

  return response.text();
}

function getScriptUrls(html, pageUrl) {
  return Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g), (match) => {
    return new URL(match[1], pageUrl).href;
  });
}

function parseJsonParsePayloads(js) {
  const payloads = [];
  const pattern = /JSON\.parse\('((?:\\.|[^'\\])*)'\)/g;

  for (const match of js.matchAll(pattern)) {
    const rawJson = match[1];
    try {
      payloads.push(JSON.parse(rawJson));
    } catch {
      const decoded = decodeJsSingleQuotedString(rawJson);
      payloads.push(JSON.parse(decoded));
    }
  }

  return payloads;
}

function decodeJsSingleQuotedString(value) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function looksLikeServerList(value) {
  if (!value || !Array.isArray(value.c)) return false;
  return value.c.some((server) => {
    return server && typeof server.id === "string" && typeof server.timestamp === "string";
  });
}

async function loadServers() {
  const html = await fetchText(SOURCE_URL);
  const scriptUrls = getScriptUrls(html, SOURCE_URL).filter((url) => {
    return new URL(url).pathname.startsWith("/_next/static/");
  });

  for (const scriptUrl of scriptUrls) {
    const js = await fetchText(scriptUrl);
    const payload = parseJsonParsePayloads(js).find(looksLikeServerList);
    if (payload) {
      return {
        servers: payload.c,
        scriptUrl,
      };
    }
  }

  throw new Error("Could not find embedded server data in the page scripts.");
}

function getServerDay(timestamp, now = new Date()) {
  const createdAt = new Date(Number(timestamp));
  const createdAtAdjusted = new Date(createdAt.getTime() - 2 * 60 * 60 * 1000);
  const nowAdjusted = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const startDayUtc = Date.UTC(
    createdAtAdjusted.getUTCFullYear(),
    createdAtAdjusted.getUTCMonth(),
    createdAtAdjusted.getUTCDate(),
  );
  const currentDayUtc = Date.UTC(
    nowAdjusted.getUTCFullYear(),
    nowAdjusted.getUTCMonth(),
    nowAdjusted.getUTCDate(),
  );

  return Math.floor((currentDayUtc - startDayUtc) / DAY_MS) + 1;
}

function getShinyTaskStatus(server, now = new Date()) {
  const cycleIndex = (getServerDay(server.timestamp, now) - 1) % 3;
  if (cycleIndex === 0) return "Today";
  if (cycleIndex === 1) return "In 2 days";
  return "Tomorrow";
}

function sortNumbers(values) {
  return [...values].sort((a, b) => a - b);
}

function collectShinyTasks(servers, now = new Date()) {
  const byId = new Map(servers.map((server) => [Number(server.id), server]));
  const groups = {
    Today: [],
    Tomorrow: [],
    "In 2 days": [],
  };
  const missing = [];

  for (let id = MIN_SERVER; id <= MAX_SERVER; id += 1) {
    const server = byId.get(id);
    if (!server) {
      missing.push(id);
      continue;
    }

    groups[getShinyTaskStatus(server, now)].push(id);
  }

  return {
    groups: {
      Today: sortNumbers(groups.Today),
      Tomorrow: sortNumbers(groups.Tomorrow),
      "In 2 days": sortNumbers(groups["In 2 days"]),
    },
    missing,
  };
}

function printResult(result) {
  const foundCount = Object.values(result.groups).reduce((sum, values) => sum + values.length, 0);

  console.log(`Source: ${SOURCE_URL}`);
  console.log(`Data script: ${result.scriptUrl}`);
  console.log(`Range: #${MIN_SERVER}-#${MAX_SERVER}`);
  console.log(`Found in range: ${foundCount}`);
  console.log(`Missing in source: ${result.missing.length ? result.missing.join(", ") : "none"}`);
  console.log("");

  for (const label of ["Today", "Tomorrow", "In 2 days"]) {
    const values = result.groups[label];
    console.log(`${label} (${values.length}):`);
    console.log(values.join(", "));
    console.log("");
  }
}

async function main() {
  const { servers, scriptUrl } = await loadServers();
  const result = {
    ...collectShinyTasks(servers),
    scriptUrl,
  };

  printResult(result);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
