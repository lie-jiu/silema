/** 任务时刻的墙钟基准：cron 固定在 UTC 04，即北京 12:00；当日令牌另按墙钟 24:00 到期（README「它每天怎么运转」）。 */
export const SCHEDULE_TZ = "Asia/Shanghai";

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

function partsOf(tz: string, at: Date) {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(at)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

export function tzOffsetMs(tz: string, at: Date): number {
  const p = partsOf(tz, at);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
  return asUtc - at.getTime();
}

/** 把「某时区的墙钟」换算成 UTC 毫秒；两次修正处理 DST 边界。 */
export function wallClockMs(tz: string, year: number, month: number, day: number, hour = 0, minute = 0): number {
  const want = Date.UTC(year, month - 1, day, hour, minute);
  let ts = want - tzOffsetMs(tz, new Date(want));
  ts = want - tzOffsetMs(tz, new Date(ts));
  return ts;
}

/** `at` 所在「日」（按 tz）的 24:00，即次日 0:00 —— 当日令牌的固定墙钟到期时刻。 */
export function endOfDayMs(tz: string, at: Date): number {
  const p = partsOf(tz, at);
  return wallClockMs(tz, p.year!, p.month!, p.day!, 24);
}

export function hoursSince(ms: number | null | undefined, now: number): number | null {
  if (ms == null) return null;
  return (now - ms) / 3_600_000;
}

export function fmtDate(tz: string, ms: number): string {
  const p = partsOf(tz, new Date(ms));
  return `${p.year!}-${String(p.month!).padStart(2, "0")}-${String(p.day!).padStart(2, "0")}`;
}

export function fmtClock(tz: string, ms: number): string {
  const p = partsOf(tz, new Date(ms));
  return `${fmtDate(tz, ms)} ${String(p.hour! % 24).padStart(2, "0")}:${String(p.minute!).padStart(2, "0")}`;
}

export function fmtTimeOnly(tz: string, ms: number): string {
  const p = partsOf(tz, new Date(ms));
  return `${String(p.hour! % 24).padStart(2, "0")}:${String(p.minute!).padStart(2, "0")}`;
}

/** 到期时刻固定墙钟 24:00，显示成 00:00 会让人以为已经过期。 */
export function fmtExpiryTime(tz: string, ms: number): string {
  const t = fmtTimeOnly(tz, ms);
  return t === "00:00" ? "24:00" : t;
}

/** 「距今 X 小时」的口语化摘要，健康行与巡检详情共用。 */
export function fmtAgo(ms: number | null, now: number): string {
  if (ms == null) return "从未";
  const h = hoursSince(ms, now);
  if (h == null) return "未知";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} 分钟前`;
  if (h < 48) return `${Math.round(h)} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
