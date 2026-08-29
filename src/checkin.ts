import { Hono } from "hono";
import { zonedDayStartUtc, ymdInTz, isValidTimeZone } from "./time";
import type { AuthEnv } from "./guard";

const checkin = new Hono<AuthEnv>();

// Upper bound on the check-in cooldown.
export const MAX_CHECKIN_COOLDOWN_SEC = 12 * 3600;

// The cooldown can never exceed half the check-in deadline. A fixed 12h window
// would otherwise lock the check-in button long after a short expiry_hours had
// already driven the owner into warning and triggered the broadcast.
export function checkinCooldownSec(expiryHours: number): number {
  if (!Number.isFinite(expiryHours) || expiryHours <= 0) return MAX_CHECKIN_COOLDOWN_SEC;
  return Math.floor(Math.min(MAX_CHECKIN_COOLDOWN_SEC, (expiryHours * 3600) / 2));
}

export type CheckinResult =
  | { ok: true; checkedAt: number; cooldownSec: number }
  | { ok: false; error: string; retryAfterSec: number; cooldownSec: number };

/**
 * 签到本体。后台按钮与邮件里的快速链接走的是同一段逻辑 —— 分开写迟早会
 * 漂移（比如冷却规则改了只改一处），而漂移的后果是两条路径对「我到底签到
 * 成功没有」给出相反的答案。
 */
export async function performCheckin(env: { DB: D1Database }): Promise<CheckinResult> {
  const now = Math.floor(Date.now() / 1000);

  const owner = await env.DB.prepare(
    "SELECT last_checkin_at, state, expiry_hours FROM owner WHERE id = 1"
  ).first<{ last_checkin_at: number | null; state: string; expiry_hours: number }>();
  if (!owner) return { ok: false, error: "系统尚未初始化", retryAfterSec: 0, cooldownSec: 0 };

  const cooldown = checkinCooldownSec(owner.expiry_hours);
  const last = owner.last_checkin_at;
  if (owner.state === "normal" && last != null && now - last < cooldown) {
    const remain = cooldown - (now - last);
    const h = Math.floor(remain / 3600);
    const m = Math.floor((remain % 3600) / 60);
    return {
      ok: false,
      error: `签到冷却中，还需等待 ${h} 小时 ${m} 分钟`,
      retryAfterSec: remain,
      cooldownSec: cooldown,
    };
  }

  // One batch runs as one transaction: the calendar entry and the owner's
  // state must never drift apart if a statement fails halfway.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO checkins (checked_at) VALUES (?)").bind(now),
    env.DB.prepare(
      "UPDATE owner SET last_checkin_at = ?, state = 'normal', warning_sent_at = NULL, triggered_at = NULL WHERE id = 1"
    ).bind(now),
    // Cancel any queued messages left over from an aborted cycle.
    // 用「取消」而不是删除：投递表同时充当审计日志，签到不该抹掉本轮的失败原因。
    // 只取消 pending（真正还在排队的），failed 的错误信息必须留着可查。
    env.DB.prepare("UPDATE deliveries SET status = 'cancelled' WHERE status = 'pending'"),
  ]);

  return { ok: true, checkedAt: now, cooldownSec: cooldown };
}

// POST /api/checkin — owner check-in (JWT only)
// Cooldown applies only in the normal state; signing in from warning/triggered
// is always allowed and immediately restores green.
checkin.post("/", async (c) => {
  const res = await performCheckin(c.env);
  if (!res.ok) {
    return c.json(
      {
        error: res.error,
        retryAfterSec: res.retryAfterSec,
        cooldownSec: res.cooldownSec,
      },
      429,
      { "Retry-After": String(res.retryAfterSec) }
    );
  }
  return c.json({ checkedAt: res.checkedAt, state: "normal", cooldownSec: res.cooldownSec });
});

// GET /api/checkin/list?y=2026&m=8 — monthly calendar in the owner's timezone
checkin.get("/list", async (c) => {
  const ownerRow = await c.env.DB.prepare("SELECT timezone FROM owner WHERE id = 1").first<{ timezone: string }>();
  const tz = ownerRow?.timezone && isValidTimeZone(ownerRow.timezone) ? ownerRow.timezone : "UTC";

  // Defaults resolve to the *owner's* current local month, not UTC's.
  const nowLocal = ymdInTz(Math.floor(Date.now() / 1000), tz);
  let year = parseInt(c.req.query("y") || String(nowLocal.y), 10);
  let month = parseInt(c.req.query("m") || String(nowLocal.m), 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2200) return c.json({ error: "Invalid year" }, 400);
  if (!Number.isInteger(month) || month < 1 || month > 12) return c.json({ error: "Invalid month" }, 400);

  const monthStartUtc = zonedDayStartUtc(year, month, 1, tz);
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextYear += 1;
    nextMonth = 1;
  }
  const monthEndUtc = zonedDayStartUtc(nextYear, nextMonth, 1, tz);

  const { results } = await c.env.DB.prepare(
    "SELECT checked_at FROM checkins WHERE checked_at >= ? AND checked_at < ? ORDER BY checked_at"
  ).bind(monthStartUtc, monthEndUtc).all<{ checked_at: number }>();

  // Bucket check-ins by local day, then format each day's first time in tz.
  const byDay = new Map<number, string>();
  for (const row of results) {
    const local = ymdInTz(row.checked_at, tz);
    const key = local.y === year && local.m === month ? local.d : null;
    if (key !== null && !byDay.has(key)) byDay.set(key, `${local.hh}:${local.mm}`);
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: { d: number; t: string | null }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ d, t: byDay.get(d) ?? null });
  }

  return c.json({ year, month, timezone: tz, days });
});

export default checkin;
