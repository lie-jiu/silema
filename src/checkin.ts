import { Hono } from "hono";
import { zonedDayStartUtc, ymdInTz, isValidTimeZone } from "./time";
import type { AuthEnv } from "./guard";

const checkin = new Hono<AuthEnv>();

export const CHECKIN_COOLDOWN_SEC = 12 * 3600;

// POST /api/checkin — owner check-in (JWT only)
// Cooldown applies only in the normal state; signing in from warning/triggered
// is always allowed and immediately restores green.
checkin.post("/", async (c) => {
  const now = Math.floor(Date.now() / 1000);

  const owner = await c.env.DB.prepare("SELECT last_checkin_at, state FROM owner WHERE id = 1")
    .first<{ last_checkin_at: number | null; state: string }>();
  if (!owner) return c.json({ error: "No owner configured" }, 500);

  const last = owner.last_checkin_at;
  if (
    owner.state === "normal" &&
    last !== null && last !== undefined &&
    now - last < CHECKIN_COOLDOWN_SEC
  ) {
    const remain = CHECKIN_COOLDOWN_SEC - (now - last);
    const h = Math.floor(remain / 3600);
    const m = Math.floor((remain % 3600) / 60);
    return c.json(
      {
        error: `签到冷却中，还需等待 ${h} 小时 ${m} 分钟`,
        nextCheckinAt: last + CHECKIN_COOLDOWN_SEC,
        retryAfterSec: remain,
      },
      429,
      { "Retry-After": String(remain) }
    );
  }

  await c.env.DB.prepare("INSERT INTO checkins (checked_at) VALUES (?)").bind(now).run();
  await c.env.DB.prepare(
    "UPDATE owner SET last_checkin_at = ?, state = 'normal', warning_sent_at = NULL, triggered_at = NULL WHERE id = 1"
  ).bind(now).run();

  // Cancel any queued messages left over from an aborted cycle.
  await c.env.DB.prepare("DELETE FROM deliveries WHERE status != 'sent'").run();

  return c.json({ checkedAt: now, state: "normal" });
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
