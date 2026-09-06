import test from "node:test";
import assert from "node:assert/strict";
import { verifyTOTP } from "../.test-build/totp.js";

// RFC 6238 附录 B 的 SHA-1 测试向量（8 位截断去掉前两位即 6 位码）。
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32("12345678901234567890")

const VECTORS = [
  { t: 59, code: "287082" },
  { t: 1111111109, code: "081804" },
  { t: 1234567890, code: "005924" },
  { t: 2000000000, code: "279037" },
  { t: 20000000000, code: "353130" },
];

test("verifyTOTP accepts RFC 6238 vectors", async () => {
  for (const { t, code } of VECTORS) {
    assert.equal(await verifyTOTP(SECRET, code, t * 1000), true, `T=${t} code=${code}`);
  }
});

test("verifyTOTP honours the ±30s window", async () => {
  const { t, code } = VECTORS[0]; // slice 1, valid 30s..60s
  assert.equal(await verifyTOTP(SECRET, code, 30000), true);   // 同片起点
  assert.equal(await verifyTOTP(SECRET, code, 59999), true);   // 同片终点
  assert.equal(await verifyTOTP(SECRET, code, 29999), true);   // 上一片（-30s）
  assert.equal(await verifyTOTP(SECRET, code, 89999), true);   // 下一片（+30s）
  assert.equal(await verifyTOTP(SECRET, code, 90001), false);  // 窗口之外
});

test("verifyTOTP rejects malformed input", async () => {
  assert.equal(await verifyTOTP(SECRET, "28708", 59000), false);   // 5 位
  assert.equal(await verifyTOTP(SECRET, "2870821", 59000), false); // 7 位
  assert.equal(await verifyTOTP(SECRET, "28708a", 59000), false);  // 非数字
  assert.equal(await verifyTOTP(SECRET, "", 59000), false);
});

test("verifyTOTP rejects wrong codes", async () => {
  assert.equal(await verifyTOTP(SECRET, "000000", 59000), false);
  assert.equal(await verifyTOTP("JBSWY3DPEHPK3PXP", "287082", 59000), false); // 换密钥
});
