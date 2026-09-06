// Local end-to-end exercise against `wrangler dev` on 127.0.0.1:8787.
// Covers: login (TOTP), protected APIs, quick-link flow, security headers,
// SSRF rejection, login rate limit, warning/trigger state machine via the
// local scheduled handler. Channel sends target an unresolvable host on
// purpose (.invalid) so the failure/audit path is exercised deterministically
// without touching the network.
// Run: node scripts/e2e.mjs   (requires .dev.vars + local seed + dev server up)
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = "http://127.0.0.1:8787";
const secret = readFileSync(".e2e-totp.env", "utf8").match(/=(.+)/)[1].trim();

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
}

/* ---------- TOTP（与 src/totp.ts 同算法） ---------- */
function base32Decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/[^A-Z2-7]/gi, "").toUpperCase()) {
    const i = A.indexOf(c);
    if (i !== -1) bits += i.toString(2).padStart(5, "0");
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}
async function totp(secret, counter) {
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const buf = new ArrayBuffer(8); const v = new DataView(buf);
  v.setUint32(0, Math.floor(counter / 0x100000000)); v.setUint32(4, counter & 0xffffffff);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, new Uint8Array(buf)));
  const o = h[h.length - 1] & 0xf;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) >>> 0;
  return String(code % 1000000).padStart(6, "0");
}
const totpNow = () => totp(secret, Math.floor(Date.now() / 1000 / 30));

async function api(path, opts = {}, token) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch { /* html */ }
  return { status: res.status, body, res };
}

// 本地 D1 查询 / 写入（wrangler dev 与 CLI 共享 .wrangler/state 下的 SQLite）
const db = (sql) =>
  JSON.parse(
    execSync(`npx wrangler d1 execute d1-db --local --json --command "${sql}"`, {
      stdio: ["pipe", "pipe", "pipe"],
    }).toString()
  )[0].results;

async function scheduled() {
  let r = await fetch(`${BASE}/cdn-cgi/handler/scheduled`, { method: "POST" }).catch(() => null);
  if (!r || r.status === 404) {
    r = await fetch(`${BASE}/cdn-cgi/local/scheduled`, { method: "POST" }).catch(() => null);
  }
  return r;
}

console.log("== 1. 公开接口 ==");
{
  const { status, body } = await api("/api/status");
  check("GET /api/status 200", status === 200 && body?.state === "normal");
  const do404 = await fetch(`${BASE}/c/${"a".repeat(43)}/do`, { method: "POST" });
  check("POST /c/<无效令牌>/do → 404", do404.status === 404);
  const getGone = await fetch(`${BASE}/c/${"a".repeat(43)}/do`, { method: "GET" });
  check("GET /c/<令牌>/do 已移除 → 404", getGone.status === 404);
}

console.log("== 2. 安全响应头 ==");
{
  const res = await fetch(`${BASE}/admin`);
  const h = res.headers;
  check("CSP 存在", !!h.get("content-security-policy"));
  check("CSP 含 frame-ancestors 'none'", (h.get("content-security-policy") || "").includes("frame-ancestors 'none'"));
  check("X-Content-Type-Options: nosniff", h.get("x-content-type-options") === "nosniff");
  check("Referrer-Policy: no-referrer", h.get("referrer-policy") === "no-referrer");
  check("X-Frame-Options: DENY", h.get("x-frame-options") === "DENY");
  const apiRes = await api("/api/status");
  check("API 响应同样带安全头", !!apiRes.res.headers.get("content-security-policy"));
}

console.log("== 3. 登录 ==");
let token;
{
  const bad = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "wrong", totpCode: "000000" }) });
  check("错误凭据 → 401", bad.status === 401);
  const ok = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "e2e-pass-123", totpCode: await totpNow() }) });
  check("正确凭据 → 200 + token", ok.status === 200 && !!ok.body?.token);
  token = ok.body?.token;
  // 已知取舍：TOTP ±30s 内可重放 → 会成功并推进 epoch，吊销上一个 token，
  // 所以重放后必须重新登录拿最新会话。
  const replay = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "e2e-pass-123", totpCode: await totpNow() }) });
  check("再次登录成功（单会话推进 epoch）", replay.status === 200);
  token = replay.body?.token;
  const old = await api("/api/settings", {}, ok.body?.token);
  check("旧 token 被新会话吊销 → 401", old.status === 401);
}

console.log("== 4. 受保护接口 ==");
{
  const noAuth = await api("/api/settings");
  check("无 token → 401", noAuth.status === 401);
  const badAuth = await api("/api/settings", {}, "bogus.token.here");
  check("伪造 token → 401", badAuth.status === 401);
  const put = await api("/api/settings", { method: "PUT", body: JSON.stringify({ timezone: "Asia/Shanghai", expiry_hours: 18, warning_hours: 10 }) }, token);
  check("PUT /api/settings 200", put.status === 200, JSON.stringify(put.body));
  const badTz = await api("/api/settings", { method: "PUT", body: JSON.stringify({ timezone: "Nope/Nope", expiry_hours: 18, warning_hours: 10 }) }, token);
  check("非法时区 → 400", badTz.status === 400);
  const badNum = await api("/api/settings", { method: "PUT", body: JSON.stringify({ timezone: "UTC", expiry_hours: [24], warning_hours: 10 }) }, token);
  check("数组类型的 expiry_hours → 400", badNum.status === 400);
  const list = await api("/api/checkin/list", {}, token);
  check("GET /api/checkin/list 返回所有者时区的 today", list.status === 200 && list.body?.today?.d > 0);
}

console.log("== 5. 签到 ==");
{
  const first = await api("/api/checkin", { method: "POST" }, token);
  check("首次签到 200", first.status === 200);
  const second = await api("/api/checkin", { method: "POST" }, token);
  check("冷却期内 → 429 + Retry-After", second.status === 429 && second.res.headers.get("retry-after") === String(second.body?.retryAfterSec));
}

console.log("== 6. SSRF 校验 ==");
{
  const cases = [
    ["http://127.0.0.1/hook", "仅 HTTPS"],
    ["https://127.0.0.1/hook", "环回地址"],
    ["https://2130706433/hook", "十进制环回"],
    ["https://[::ffff:127.0.0.1]/hook", "mapped IPv6 环回"],
    ["https://169.254.169.254/hook", "云元数据"],
    ["https://foo.internal/hook", ".internal 后缀"],
  ];
  for (const [url, label] of cases) {
    const r = await api("/api/recipients", { method: "POST", body: JSON.stringify({ label: "x", channelType: "webhook", config: { url }, onTrigger: true, triggerContent: "t" }) }, token);
    check(`${label} 被拒 → 400`, r.status === 400, `got ${r.status}`);
  }
}

console.log("== 7. 快速签到链接 ==");
{
  const t = "e2e" + crypto.randomUUID().replace(/-/g, "");
  const now = Math.floor(Date.now() / 1000);
  db(`INSERT INTO checkin_tokens (token, purpose, cycle, created_at, expires_at, use_count) VALUES ('${t}', 'warning', 999, ${now}, ${now + 3600}, 0)`);
  // 让签到通过冷却（cooldown = 9h，签到时间拨到 10h 前）
  db("UPDATE owner SET state='normal', last_checkin_at=strftime('%s','now')-10*3600, warning_sent_at=NULL, triggered_at=NULL WHERE id=1");

  const page = await (await fetch(`${BASE}/c/${t}`)).text();
  check("GET /c/<token> 返回签到中页面", page.includes("正在签到"));
  check("noscript 兜底为 POST 表单（不再有 GET 链接）", page.includes('method="post"') && !page.includes('href="/c/'));
  const doJson = await fetch(`${BASE}/c/${t}/do?format=json`, { method: "POST" });
  const doBody = await doJson.json();
  check("POST /do?format=json 签到成功", doJson.status === 200 && doBody?.ok === true, JSON.stringify(doBody));
  const again = await fetch(`${BASE}/c/${t}/do?format=json`, { method: "POST" });
  check("二次使用 → 410 已使用", again.status === 410);
  const used = await (await fetch(`${BASE}/c/${t}`)).text();
  check("再次打开显示已使用页", used.includes("已使用"));
  const html = await (await fetch(`${BASE}/c/${t}/do`, { method: "POST" })).text();
  check("非 JSON POST 兜底返回 HTML 结果页", html.includes("已使用"));
}

console.log("== 8. 登录限流 ==");
{
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const r = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "admin", password: "x", totpCode: "000000" }) });
    last = r.status;
    if (r.status === 429) break;
  }
  check("连续失败触发 429", last === 429, `got ${last}`);
}

console.log("== 9. 状态机：警告与触发（本地 scheduled handler，通道故意不可达）==");
{
  const rcpt = await api("/api/recipients", { method: "POST", body: JSON.stringify({
    label: "e2e-webhook", channelType: "webhook",
    config: { url: "https://e2e-nonexistent.invalid/hook", method: "POST" },
    onWarning: true, onTrigger: true,
    warningContent: "警告标题 {deadline}\n快签 {checkin_url}",
    triggerContent: "触发标题 {time}\n最后 {last_checkin} ({hours}h)",
  }) }, token);
  check("添加 webhook 接收人 200", rcpt.status === 200, JSON.stringify(rcpt.body));

  // —— 警告流程 ——
  db("DELETE FROM deliveries");
  db("UPDATE owner SET state='normal', last_checkin_at=strftime('%s','now')-19*3600, warning_sent_at=NULL, triggered_at=NULL WHERE id=1");
  await scheduled();
  const ownerRow = db("SELECT state, warning_sent_at FROM owner WHERE id=1")[0];
  check("超时 → 进入 warning", ownerRow.state === "warning", JSON.stringify(ownerRow));
  const dl = db("SELECT purpose, status, attempts, last_error FROM deliveries");
  check("警告投递已落库并定稿（发送失败→failed 留审计）",
    dl.length === 1 && dl[0].purpose === "warning" && dl[0].status === "failed" && dl[0].attempts === 1,
    JSON.stringify(dl));

  // —— 触发流程 ——
  db("UPDATE owner SET state='warning', warning_sent_at=strftime('%s','now')-11*3600 WHERE id=1");
  await scheduled();
  const ownerRow2 = db("SELECT state, triggered_at FROM owner WHERE id=1")[0];
  check("警告期满 → triggered", ownerRow2.state === "triggered", JSON.stringify(ownerRow2));
  const trig = db("SELECT purpose, status, attempts FROM deliveries WHERE purpose='trigger'");
  check("触发投递入队并完成首次尝试（失败→留待重试）",
    trig.length === 1 && trig[0].status === "pending" && trig[0].attempts === 1,
    JSON.stringify(trig));

  // —— 签到恢复 ——
  const back = await api("/api/checkin", { method: "POST" }, token);
  check("triggered 状态下签到恢复 normal（无冷却限制）", back.status === 200);
  const ownerRow3 = db("SELECT state FROM owner WHERE id=1")[0];
  check("状态已恢复 normal", ownerRow3.state === "normal");
  const after = db("SELECT status, COUNT(*) AS n FROM deliveries GROUP BY status");
  check("无 pending 残留（排队行被签到取消）", !after.some((r) => r.status === "pending"), JSON.stringify(after));
}

console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
