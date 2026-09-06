import test from "node:test";
import assert from "node:assert/strict";
import { zonedDayStartUtc, ymdInTz, isValidTimeZone } from "../.test-build/time.js";

test("ymdInTz converts across UTC offsets", () => {
  // 2026-09-06T09:15:27Z → 上海 17:15
  assert.deepEqual(ymdInTz(1788686127, "Asia/Shanghai"), { y: 2026, m: 9, d: 6, hh: "17", mm: "15" });
  // 同一时刻在 UTC 仍是 9 日？—— 不，仍是 6 日 09:15
  assert.deepEqual(ymdInTz(1788686127, "UTC"), { y: 2026, m: 9, d: 6, hh: "09", mm: "15" });
});

test("zonedDayStartUtc lands on local midnight for offset-only zones", () => {
  // 上海 = UTC+8 无夏令时：9 月 1 日 00:00 +08 → 8 月 31 日 16:00 UTC
  assert.equal(zonedDayStartUtc(2026, 9, 1, "Asia/Shanghai"), 1788192000);
  assert.equal(zonedDayStartUtc(2026, 9, 1, "UTC"), 1788220800);
});

// DST 边界自洽性：起点当天的 00:00 必须落在当天，且前一秒仍在昨天。
// 覆盖美国春令时（2026-03-08）、秋令时（2026-11-01）与半小时偏移时区。
const DAYS = [
  { tz: "America/New_York", y: 2026, m: 3, d: 8 },   // 春令时跳变日
  { tz: "America/New_York", y: 2026, m: 11, d: 1 },  // 秋令时跳变日
  { tz: "America/Los_Angeles", y: 2026, m: 3, d: 8 },
  { tz: "Asia/Kolkata", y: 2026, m: 6, d: 15 },      // UTC+5:30
  { tz: "Asia/Kathmandu", y: 2026, m: 1, d: 1 },     // UTC+5:45
  { tz: "Asia/Shanghai", y: 2026, m: 2, d: 28 },
  { tz: "UTC", y: 2026, m: 12, d: 31 },
];

test("zonedDayStartUtc is self-consistent across DST boundaries", () => {
  for (const { tz, y, m, d } of DAYS) {
    const start = zonedDayStartUtc(y, m, d, tz);
    const same = ymdInTz(start, tz);
    assert.equal(same.y, y, `${tz} ${y}-${m}-${d} year`);
    assert.equal(same.m, m, `${tz} ${y}-${m}-${d} month`);
    assert.equal(same.d, d, `${tz} ${y}-${m}-${d} day`);
    assert.equal(same.hh, "00", `${tz} ${y}-${m}-${d} hour`);
    assert.equal(same.mm, "00", `${tz} ${y}-${m}-${d} minute`);

    const prev = ymdInTz(start - 1, tz);
    assert.notEqual(prev.d, d, `${tz} start-1s belongs to previous day`);
  }
});

test("isValidTimeZone", () => {
  assert.equal(isValidTimeZone("Asia/Shanghai"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone(""), false);
});
