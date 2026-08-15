#!/usr/bin/env node

/**
 * 依 variants.json 產生各版本的網頁。
 *
 * 範本：templates/index.template.html
 * 產出：index.html（第一版，根目錄）、v2/index.html、v3/index.html…
 *
 * enabled: false 的版本不會產生，而且如果之前產生過，那個資料夾會被刪掉，等於下架。
 * 根目錄的 index.html 永遠不刪 —— 網站首頁不能消失。
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TEMPLATE_PATH = join(ROOT, "templates", "index.template.html");
const CONFIG_PATH = join(ROOT, "variants.json");

const REQUIRED_FIELDS = ["id", "path", "title", "subtitle", "signature", "copyPrefix"];

const GENERATED_BANNER = [
  "<!-- ⚠️ 這個檔案是產生出來的，不要手動編輯 ⚠️ -->",
  "<!-- 要改內容：templates/index.template.html（共用程式碼）或 variants.json（各版本的文字） -->",
  "<!-- 改完跑 build-variants.bat 重新產生 -->",
].join("\r\n");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}

// 放進 JS 字串常值裡的內容，反斜線、引號、換行都要處理掉
function escapeJsString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/\r?\n/g, " ");
}

function validate(config) {
  if (!Array.isArray(config.variants) || config.variants.length === 0) {
    throw new Error("variants.json 裡沒有任何版本");
  }

  const seenIds = new Set();
  const seenPaths = new Set();

  for (const variant of config.variants) {
    for (const field of REQUIRED_FIELDS) {
      if (typeof variant[field] !== "string") {
        throw new Error(`版本 ${variant.id ?? "(沒有 id)"} 缺少欄位 ${field}`);
      }
    }

    if (!/^[a-z0-9-]{1,16}$/.test(variant.id)) {
      throw new Error(`版本 id "${variant.id}" 只能用小寫英數與連字號，長度 1-16`);
    }
    if (variant.path !== "" && !/^[a-z0-9-]{1,32}$/.test(variant.path)) {
      throw new Error(`版本 ${variant.id} 的 path "${variant.path}" 只能用小寫英數與連字號`);
    }
    if (seenIds.has(variant.id)) throw new Error(`版本 id 重複：${variant.id}`);
    if (seenPaths.has(variant.path)) throw new Error(`版本 path 重複：${variant.path || "(根目錄)"}`);

    seenIds.add(variant.id);
    seenPaths.add(variant.path);
  }

  if (!seenPaths.has("")) {
    throw new Error("必須有一個版本的 path 是空字串（網站首頁不能沒有內容）");
  }
}

function render(template, variant) {
  const values = {
    TITLE: escapeHtml(variant.title),
    SUBTITLE: escapeHtml(variant.subtitle),
    SIGNATURE: escapeHtml(variant.signature),
    COPY_PREFIX: escapeJsString(variant.copyPrefix),
    VARIANT_ID: encodeURIComponent(variant.id),
    // 子資料夾裡的頁面要往上一層找資料檔
    DATA_PATH: variant.path === "" ? "./data/shiny-groups.json" : "../data/shiny-groups.json",
  };

  const rendered = template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`範本用到未知的欄位 ${match}`);
    return values[key];
  });

  const leftover = rendered.match(/\{\{[A-Z_]+\}\}/);
  if (leftover) throw new Error(`還有沒替換掉的欄位：${leftover[0]}`);

  return rendered.replace(/^<!--[^\n]*-->\r?\n/, `${GENERATED_BANNER}\r\n`);
}

// 找出之前產生過、但這次沒有啟用的版本資料夾
async function findStaleFolders(activePaths) {
  const entries = await readdir(ROOT, { withFileTypes: true });
  const stale = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^[a-z0-9-]{1,32}$/.test(entry.name)) continue;
    if (activePaths.has(entry.name)) continue;

    // 只動確實是我們產生出來的資料夾，不要誤刪 data/ scripts/ 之類
    try {
      const html = await readFile(join(ROOT, entry.name, "index.html"), "utf8");
      if (html.includes("這個檔案是產生出來的")) stale.push(entry.name);
    } catch {
      // 裡面沒有我們產生的 index.html，不是版本資料夾，跳過
    }
  }

  return stale;
}

async function main() {
  const [template, config] = await Promise.all([
    readFile(TEMPLATE_PATH, "utf8"),
    readFile(CONFIG_PATH, "utf8").then(JSON.parse),
  ]);

  validate(config);

  const enabled = config.variants.filter((variant) => variant.enabled !== false);
  const disabled = config.variants.filter((variant) => variant.enabled === false);

  if (!enabled.some((variant) => variant.path === "")) {
    throw new Error("根目錄那個版本不能停用，否則網站首頁會變空的");
  }

  for (const variant of enabled) {
    const outputDir = variant.path === "" ? ROOT : join(ROOT, variant.path);
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, "index.html"), render(template, variant), "utf8");
    console.log(`產生 ${variant.path === "" ? "index.html" : `${variant.path}/index.html`}  (${variant.id}, ${variant.signature})`);
  }

  const activePaths = new Set(enabled.map((variant) => variant.path).filter(Boolean));
  for (const folder of await findStaleFolders(activePaths)) {
    await rm(join(ROOT, folder), { recursive: true, force: true });
    console.log(`下架 ${folder}/（enabled 已設為 false）`);
  }

  if (disabled.length > 0) {
    console.log(`\n未啟用：${disabled.map((variant) => variant.id).join(", ")}`);
  }
  console.log(`\n完成，共 ${enabled.length} 個版本上線。`);
}

main().catch((error) => {
  console.error(`失敗：${error.message}`);
  process.exitCode = 1;
});
