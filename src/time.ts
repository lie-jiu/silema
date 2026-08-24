function tzOffsetSeconds(tsMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(tsMs))) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - tsMs) / 1000;
}

export function zonedDayStartUtc(year: number, month: number, day: number, tz: string): number {
  const guess = Math.floor(Date.UTC(year, month - 1, day, 0, 0, 0) / 1000);
  let utc = guess - tzOffsetSeconds(guess * 1000, tz);
  const off2 = tzOffsetSeconds(utc * 1000, tz);
  utc = guess - off2;
  return Math.floor(utc);
}

export function ymdInTz(
  tsSec: number,
  tz: string
): { y: number; m: number; d: number; hh: string; mm: string } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(tsSec * 1000))) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hh: String(parts.hour),
    mm: String(parts.minute),
  };
}

export function formatInTz(tsSec: number, tz: string): string {
  const { hh, mm } = ymdInTz(tsSec, tz);
  return `${hh}:${mm}`;
}

// "2026-08-26 14:30" in the given timezone (used inside message templates).
export function formatFullInTz(tsSec: number, tz: string): string {
  const d = ymdInTz(tsSec, tz);
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")} ${d.hh}:${d.mm}`;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
