"use strict";
// 本地预览辅助：把 SQL 打到 wrangler 的本地 D1，并提供北京墙钟 / PBKDF2 / TOTP 的最小实现。
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DB_NAME = process.env.SILEMA_DB || "silema";
// wrangler 的 exports 表不暴露 bin，直接按路径取。
const WRANGLER = path.join(__dirname, "..", "node_modules", "wrangler", "bin", "wrangler.js");

function wrangler(args) {
  return execFileSync(process.execPath, [WRANGLER, ...args], {
    encoding: "utf8",
    cwd: path.resolve(__dirname, ".."),
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

/** 一次性跑一段 SQL（多语句安全，wrangler 按分号切分）。 */
function runSql(sql, { local = true } = {}) {
  const file = path.join(os.tmpdir(), `silema-seed-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, sql, "utf8");
  try {
    return wrangler(["d1", "execute", DB_NAME, local ? "--local" : "--remote", "--file", file, "--json"]);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** 按文件名顺序执行 migrations/ 下全部 .sql（seed 与 `npm run db:init` 共用）。 */
function runMigrations({ local = true } = {}) {
  const dir = path.join(__dirname, "..", "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    runSql(fs.readFileSync(path.join(dir, file), "utf8"), { local });
  }
}

function query(sql, { local = true } = {}) {
  const out = wrangler([
    "d1",
    "execute",
    DB_NAME,
    local ? "--local" : "--remote",
    "--command",
    sql,
    "--json",
  ]);
  const body = firstJson(out);
  if (!body) throw new Error(`无法解析 wrangler 输出：${out}`);
  const parsed = JSON.parse(body);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return (first && first.results) || [];
}

/** wrangler 会往 stdout 里掺警告，取第一个配平的 JSON 片段而不是到结尾。 */
function firstJson(text) {
  const open = text.search(/[[{]/);
  if (open < 0) return null;
  const stack = [];
  let inStr = false;
  let esc = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      const want = ch === "}" ? "{" : "[";
      if (stack.pop() !== want) return null;
      if (stack.length === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

function sqlStr(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNum(value) {
  return value === null || value === undefined ? "NULL" : String(Math.floor(value));
}

// ---- 北京墙钟 ----
const TZ = "Asia/Shanghai";
const dtf = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function parts(at) {
  const o = {};
  for (const p of dtf.formatToParts(at)) if (p.type !== "literal") o[p.type] = Number(p.value);
  if (o.hour === 24) o.hour = 0;
  return o;
}

function offsetMs(at) {
  const p = parts(at);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at.getTime();
}

/** 北京墙钟 (y,m,d,hh:mm) 对应的 UTC 毫秒。 */
function beijing(y, m, d, hh = 0, mm = 0) {
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let ts = want - offsetMs(new Date(want));
  ts = want - offsetMs(new Date(ts));
  return ts;
}

/** `at` 所在北京日的 24:00。 */
function endOfDay(at) {
  const p = parts(at);
  return beijing(p.year, p.month, p.day, 24);
}

/** 北京日序号（用于按「几天前」推时间点）。 */
function shiftDay(at, days) {
  const p = parts(at);
  const ms = beijing(p.year, p.month, p.day) + days * 86400000;
  const q = parts(new Date(ms));
  return q;
}

// ---- 口令哈希（与 src/lib/password.ts 同格式、同轮数：workd 的 PBKDF2 上限是 100000 轮）----
const ITERATIONS = 100000;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  const b64u = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `pbkdf2$${ITERATIONS}$${b64u(salt)}$${b64u(hash)}`;
}

// ---- TOTP (RFC 6238, SHA1/6/30) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function randomBase32(n = 32) {
  const raw = crypto.randomBytes(n);
  return Array.from(raw, (b) => B32[b % 32]).join("");
}

function b32Decode(s) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s.toUpperCase().replace(/=+$/, "")) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpAt(secretB32, at = Date.now()) {
  const counter = Math.floor(at / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const hmac = crypto.createHmac("sha1", b32Decode(secretB32)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 |
    (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1000000;
  return String(code).padStart(6, "0");
}

module.exports = {
  DB_NAME,
  TZ,
  runSql,
  runMigrations,
  query,
  sqlStr,
  sqlNum,
  beijing,
  endOfDay,
  shiftDay,
  parts,
  hashPassword,
  randomBase32,
  totpAt,
  ITERATIONS,
};
