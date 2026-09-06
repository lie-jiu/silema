import test from "node:test";
import assert from "node:assert/strict";
import { checkinCooldownSec, MAX_CHECKIN_COOLDOWN_SEC } from "../.test-build/checkin.js";

test("cooldown is half the expiry window, capped at 12h", () => {
  assert.equal(checkinCooldownSec(1), 1800);                            // 1h → 30min
  assert.equal(checkinCooldownSec(18), 9 * 3600);                       // 生产当前值
  assert.equal(checkinCooldownSec(24), 12 * 3600);                      // 恰好到上限
  assert.equal(checkinCooldownSec(48), MAX_CHECKIN_COOLDOWN_SEC);       // 封顶
  assert.equal(checkinCooldownSec(8760), MAX_CHECKIN_COOLDOWN_SEC);
});

test("cooldown falls back to the 12h cap for nonsensical expiry", () => {
  assert.equal(checkinCooldownSec(0), MAX_CHECKIN_COOLDOWN_SEC);
  assert.equal(checkinCooldownSec(-5), MAX_CHECKIN_COOLDOWN_SEC);
  assert.equal(checkinCooldownSec(NaN), MAX_CHECKIN_COOLDOWN_SEC);
});
