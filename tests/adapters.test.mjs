import test from "node:test";
import assert from "node:assert/strict";
import { safeUrl } from "../.test-build/adapters.js";

// SSRF 黑名单回归用例 —— 含历史审查中发现的全部绕过手法（IPv4 编码变体、
// IPv4-mapped IPv6、NAT64、zone id）。任何一条被放行即是回归。
const BLOCKED = [
  // loopback / 私网 / CGNAT / 链路本地 / 云元数据
  "https://127.0.0.1/x",
  "https://10.0.0.1/x",
  "https://172.16.0.1/x",
  "https://172.31.255.255/x",
  "https://192.168.1.1/x",
  "https://169.254.169.254/latest/meta-data/",
  "https://100.64.0.1/x",
  "https://0.0.0.0/x",
  // IPv4 编码变体
  "https://2130706433/x",          // 十进制整数
  "https://0x7f000001/x",          // 十六进制整数
  "https://0177.0.0.1/x",          // 八进制点分
  "https://0x7f.0.0.1/x",          // 混合十六进制点分
  "https://127.1/x",               // inet_aton 短格式
  "https://127.0.1/x",             // 三段短格式
  "https://0/x",                   // 单段 → 0.0.0.0
  // IPv6 侧
  "https://[::1]/x",
  "https://[::]/x",
  "https://[::ffff:127.0.0.1]/x",
  "https://[::ffff:169.254.169.254]/x",
  "https://[::127.0.0.1]/x",
  "https://[64:ff9b::127.0.0.1]/x",
  "https://[fc00::1]/x",
  "https://[fd12:3456::1]/x",
  "https://[fe80::1]/x",
  // 主机名黑名单 / 协议
  "https://localhost/x",
  "https://api.localhost/x",
  "https://box.internal/x",
  "https://nas.local/x",
  "http://example.com/x",
];

const ALLOWED = [
  "https://example.com/hook",
  "https://8.8.8.8/x",
  "https://[2606:4700::1111]/x",
  "https://100.128.0.1/x",   // CGNAT 之外
  "https://172.32.0.1/x",    // 172.16/12 之外
  "https://172.15.0.1/x",
  "https://example.com:8443/x",
];

test("safeUrl blocks SSRF targets", () => {
  for (const raw of BLOCKED) {
    assert.throws(() => safeUrl(raw), `${BLOCKED} should be rejected`);
  }
});

test("safeUrl allows public HTTPS targets", () => {
  for (const raw of ALLOWED) {
    assert.doesNotThrow(() => safeUrl(raw), `${raw} should be accepted`);
  }
});

test("safeUrl rejects malformed URLs", () => {
  assert.throws(() => safeUrl("not a url"));
});

test("safeUrl preserves URL parts for use", () => {
  const u = safeUrl("https://hooks.example.com/dms?a=1");
  assert.equal(u.pathname, "/dms");
  assert.equal(u.search, "?a=1");
});
