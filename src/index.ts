import { Hono } from "hono";
import type { Context } from "hono";
import auth from "./auth";
import checkinRoutes, { checkinCooldownSec, performCheckin } from "./checkin";
import recipientsRoutes from "./recipients";
import { runCron, readCronHealth } from "./health";
import { requireAuth, type AuthEnv } from "./guard";
import { isValidTimeZone } from "./time";
import { publicPage } from "./pages/public";
import { adminPage } from "./pages/admin";
import { validateCheckinToken, consumeCheckinToken } from "./token";
import {
  checkinPendingPage,
  checkinResultPage,
  checkinInvalidPage,
  checkinUsedPage,
  isSafeToken,
} from "./pages/checkin";
import { rateLimit, clientIp } from "./ratelimit";
import type { Bindings } from "./types";

const app = new Hono<AuthEnv>();

// No CORS on purpose: the two pages are served by this same Worker, so every
// browser client is same-origin. Dropping the header restores the default
// same-origin policy instead of allowing any site to read the APIs.
app.onError((err, c) => {
  console.error("Worker error:", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

/* ---------------- Public ---------------- */

app.get("/", (c) => c.html(publicPage()));

app.get("/api/status", async (c) => {
  const owner = await c.env.DB.prepare(
    "SELECT last_checkin_at, state, expiry_hours, timezone FROM owner WHERE id = 1"
  ).first<{ last_checkin_at: number | null; state: string; expiry_hours: number; timezone: string }>();

  const cooldownSec = checkinCooldownSec(owner?.expiry_hours ?? 0);
  const timezone = owner?.timezone ?? "UTC";

  if (!owner || !owner.last_checkin_at) {
    return c.json({ hoursSinceCheckin: 0, state: "normal", level: "green", ratio: 0, cooldownSec, timezone });
  }

  const hoursSince = Math.max(0, (Date.now() / 1000 - owner.last_checkin_at) / 3600);
  const ratio = owner.expiry_hours > 0 ? hoursSince / owner.expiry_hours : 0;

  let level: string;
  if (owner.state === "triggered") level = "dark";
  else if (owner.state === "warning") level = "red";
  else if (ratio >= 0.9) level = "red";
  else if (ratio >= 0.5) level = "yellow";
  else level = "green";

  return c.json({
    hoursSinceCheckin: Math.round(hoursSince * 10) / 10,
    state: owner.state,
    level,
    ratio: Math.round(ratio * 100) / 100,
    cooldownSec,
    timezone,
  });
});

app.route("/api/auth", auth);

/* ---------------- 快速签到链接 ----------------
 * 邮件/消息里的 {checkin_url} 指向这里。见 pages/checkin.ts 顶部说明：
 * GET /c/<token> 只渲染页面，真正的状态变更在 /do，以免邮件网关的链接
 * 扫描替所有者签到、让死人开关失灵。
 */

app.get("/c/:token", async (c) => {
  const token = c.req.param("token") ?? "";
  if (!isSafeToken(token)) return c.html(checkinInvalidPage(), 404);

  // 令牌是 256 位随机串，暴力猜中无望，但仍限流：既挡住挨个试旧链接，
  // 也挡住拿过期令牌轰炸数据库。
  const ip = clientIp(c.req.raw.headers);
  if (!(await rateLimit(c.env, `clink:${ip}`, 60, 3600))) {
    return c.html(checkinResultPage({
      ok: false,
      title: "请求过于频繁",
      message: "请稍后再试，或直接登录后台完成签到。",
    }), 429);
  }

  const row = await validateCheckinToken(c.env, token);
  if (!row) return c.html(checkinInvalidPage(), 404);
  // 一次性：已签过的链接再次打开直接告知已使用，不再自动发起签到。
  if (row.used_at != null) return c.html(checkinUsedPage(), 200);

  return c.html(checkinPendingPage(token));
});

// 同时接受 GET（兜底按钮，无脚本环境）与 POST（页面脚本）。
async function doCheckin(c: Context<AuthEnv>): Promise<Response> {
  const token = c.req.param("token") ?? "";
  if (!isSafeToken(token)) {
    return c.req.query("format") === "json"
      ? c.json({ ok: false, error: "链接无效或已过期" }, 404)
      : c.html(checkinInvalidPage(), 404);
  }

  const ip = clientIp(c.req.raw.headers);
  if (!(await rateLimit(c.env, `cdo:${ip}`, 30, 3600))) {
    const msg = "请求过于频繁，请稍后再试。";
    return c.req.query("format") === "json" ? c.json({ ok: false, error: msg }, 429) : c.html(checkinResultPage({ ok: false, title: "请求过于频繁", message: msg }), 429);
  }

  // 先 peek 区分「已用过」与「完全无效」，给出不同的提示。
  const peek = await validateCheckinToken(c.env, token);
  if (!peek) {
    return c.req.query("format") === "json"
      ? c.json({ ok: false, error: "链接无效或已过期" }, 404)
      : c.html(checkinInvalidPage(), 404);
  }
  if (peek.used_at != null) {
    return c.req.query("format") === "json"
      ? c.json({ ok: false, error: "链接已使用" }, 410)
      : c.html(checkinUsedPage(), 200);
  }

  const row = await consumeCheckinToken(c.env, token);
  if (!row) {
    return c.req.query("format") === "json"
      ? c.json({ ok: false, error: "链接已使用" }, 410)
      : c.html(checkinUsedPage(), 200);
  }

  const res = await performCheckin(c.env);
  if (c.req.query("format") === "json") {
    return res.ok
      ? c.json({ ok: true, checkedAt: res.checkedAt, cooldownSec: res.cooldownSec })
      : c.json({ ok: false, error: res.error, retryAfterSec: res.retryAfterSec, cooldownSec: res.cooldownSec }, 429);
  }

  if (res.ok) {
    return c.html(checkinResultPage({
      ok: true,
      title: "已确认平安",
      message: "签到成功，警报已解除。",
      meta: `本次签到时间：${new Date(res.checkedAt * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
    }));
  }
  // 冷却期里点链接不算错误 —— 状态本来就是平安的，只是不用再签一次。
  if (res.retryAfterSec > 0) {
    return c.html(checkinResultPage({
      ok: true,
      cooldown: true,
      title: "刚刚已签到过",
      message: "当前处于签到冷却中，无需重复确认。",
      meta: `可在 ${Math.ceil(res.retryAfterSec / 3600)} 小时后再次签到`,
    }));
  }
  return c.html(checkinResultPage({ ok: false, title: "签到未完成", message: res.error }), 500);
};

app.get("/c/:token/do", doCheckin);
app.post("/c/:token/do", doCheckin);

// Manual cron trigger, guarded by a shared secret
app.post("/__cron", async (c) => {
  if (!c.env.CRON_SECRET || c.req.header("X-Cron-Secret") !== c.env.CRON_SECRET) {
    return c.json({ error: "Not found" }, 404);
  }
  await runCron(c.env);
  return c.json({ ok: true });
});

/* ---------------- Protected ---------------- */

// Hono's "/*" pattern also matches the bare path, so registering both forms
// ("/api/x" and "/api/x/*") runs the middleware twice per request — two JWT
// verifications and two D1 epoch lookups. Register the wildcard form only.
app.use("/api/checkin/*", requireAuth);
app.use("/api/recipients/*", requireAuth);
app.use("/api/settings/*", requireAuth);
app.use("/api/deliveries/*", requireAuth);

app.route("/api/checkin", checkinRoutes);
app.route("/api/recipients", recipientsRoutes);

app.get("/api/settings", async (c) => {
  const owner = await c.env.DB.prepare(
    "SELECT timezone, expiry_hours, warning_hours, last_checkin_at, state FROM owner WHERE id = 1"
  ).first();

  // 巡检健康度只给管理员看。刻意不放进公开的 /api/status —— 后者被公开页
  // 每 60 秒轮询一次，没必要为它多查一次库。仪表盘本就会请求本接口。
  const health = await readCronHealth(c.env);
  return c.json({
    ...(owner ?? {}),
    cronLastAt: health.lastAt,
    cronLastStatus: health.lastStatus,
    cronLastError: health.lastError,
    cronFailStreak: health.failStreak,
  });
});

app.put("/api/settings", async (c) => {
  const body = await c.req.json<{ timezone?: unknown; expiry_hours?: unknown; warning_hours?: unknown }>();
  const tz = typeof body.timezone === "string" ? body.timezone.trim() : "";
  if (!isValidTimeZone(tz)) return c.json({ error: "Invalid IANA timezone" }, 400);

  // Require actual numbers: Number(true) === 1 and Number([24]) === 24 would
  // both sail through a bare Number() coercion.
  const expiry = typeof body.expiry_hours === "number" ? body.expiry_hours : NaN;
  const warning = typeof body.warning_hours === "number" ? body.warning_hours : NaN;
  if (!Number.isInteger(expiry) || expiry < 1 || expiry > 8760) {
    return c.json({ error: "expiry_hours must be an integer between 1 and 8760" }, 400);
  }
  if (!Number.isInteger(warning) || warning < 1 || warning > 8760) {
    return c.json({ error: "warning_hours must be an integer between 1 and 8760" }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE owner SET timezone = ?, expiry_hours = ?, warning_hours = ? WHERE id = 1"
  ).bind(tz, expiry, warning).run();

  return c.json({ message: "Settings saved" });
});

// GET /api/deliveries?limit=50 — 投递审计日志（最近优先）
app.get("/api/deliveries", async (c) => {
  const parsed = parseInt(c.req.query("limit") || "50", 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;

  // LEFT JOIN：recipient_id 没有外键约束，接收人被删后历史仍要能查出来。
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.cycle, d.purpose, d.status, d.attempts, d.last_error,
            d.created_at, d.sent_at, d.recipient_id,
            r.label AS recipient_label, r.channel_type
     FROM deliveries d
     LEFT JOIN recipients r ON d.recipient_id = r.id
     ORDER BY d.created_at DESC, d.id DESC
     LIMIT ?`
  ).bind(limit).all<{
    id: number;
    cycle: number;
    purpose: string;
    status: string;
    attempts: number;
    last_error: string | null;
    created_at: number;
    sent_at: number | null;
    recipient_id: number;
    recipient_label: string | null;
    channel_type: string | null;
  }>();

  // 最新一轮群发的统计单独查，不依赖分页窗口，保证横幅判断准确。
  const latest = await c.env.DB.prepare(
    "SELECT MAX(cycle) AS cycle FROM deliveries WHERE purpose = 'trigger'"
  ).first<{ cycle: number | null }>();
  const cycle = latest?.cycle ?? null;

  let summary = { cycle, total: 0, sent: 0, failed: 0, pending: 0, cancelled: 0 };
  if (cycle !== null) {
    const { results: counts } = await c.env.DB.prepare(
      "SELECT status, COUNT(*) AS n FROM deliveries WHERE purpose = 'trigger' AND cycle = ? GROUP BY status"
    ).bind(cycle).all<{ status: string; n: number }>();
    const pick = (s: string) => counts.find((r) => r.status === s)?.n ?? 0;
    summary = {
      cycle,
      total: counts.reduce((acc, r) => acc + r.n, 0),
      sent: pick("sent"),
      failed: pick("failed"),
      pending: pick("pending"),
      cancelled: pick("cancelled"),
    };
  }

  return c.json({
    deliveries: results.map((r) => ({
      id: r.id,
      cycle: r.cycle,
      purpose: r.purpose,
      recipientId: r.recipient_id,
      recipientLabel: r.recipient_label,
      channelType: r.channel_type,
      status: r.status,
      attempts: r.attempts,
      lastError: r.last_error,
      createdAt: r.created_at,
      sentAt: r.sent_at,
    })),
    summary,
  });
});

/* ---------------- Pages ---------------- */

app.get("/admin", (c) => c.html(adminPage()));

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => {
    // scheduled handlers bypass the fetch onError path — log failures here so
    // cron errors show up in tail output instead of vanishing. runCron itself
    // records the outcome into system_state and fires the heartbeat; the catch
    // here only keeps the waitUntil promise from rejecting unhandled.
    ctx.waitUntil(runCron(env).catch((err) => console.error("[cron] scheduled run failed:", err)));
  },
};
