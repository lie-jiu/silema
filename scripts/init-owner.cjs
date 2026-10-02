#!/usr/bin/env node
"use strict";
// owner 行初始化 / TOTP 重置（docs/backend.md §4、§5）。
//   node scripts/init-owner.cjs [--local|--remote] [--reset-totp]
// 任何模式都不碰业务状态；--reset-totp 只覆盖 totp_secret / totp_last_step、清空 backup_codes 并 bump session_epoch。
const { runSql, query, sqlStr, sqlNum, randomBase32 } = require("./_local.cjs");

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const local = !remote;
const reset = args.includes("--reset-totp");
const label = args.find((a) => a.startsWith("--label="))?.split("=")[1] || "silema";
const issuer = process.env.ISSUER || "死了吗";

const existing = query("SELECT id, session_epoch FROM owner", { local })[0];
const secret = randomBase32(32);
const now = Date.now();
let written = false;

if (reset) {
  if (!existing) throw new Error("owner 行不存在，先用不带 --reset-totp 的模式初始化");
  runSql(
    `UPDATE owner SET totp_secret = ${sqlStr(secret)}, totp_last_step = 0, backup_codes = NULL,
       session_epoch = session_epoch + 1 WHERE id = 1;`,
    { local },
  );
  written = true;
  console.log("已重置 TOTP：backup_codes 已清空，session_epoch 已递增（所有设备需要重新登录）。");
} else if (existing) {
  console.log("owner 行已存在，未改动（要换 TOTP 用 --reset-totp）。");
} else {
  runSql(
    `INSERT INTO owner (id, totp_secret, last_judge_at) VALUES (1, ${sqlStr(secret)}, ${sqlNum(now)})
       ON CONFLICT(id) DO NOTHING;`,
    { local },
  );
  written = true;
  console.log(`已创建 owner 行，last_judge_at = ${new Date(now).toISOString()}`);
}

// 只有真的落库才打印密钥。重跑时上面那把 secret 从未写进 owner 行，
// 无条件打印等于给一个诱饵密钥——照它存档的人，验证器丢失时会用它自救并失败。
if (written) {
  const uri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  console.log(`\nTOTP secret: ${secret}\n provisioning: ${uri}`);
} else {
  console.log("（本次没有改动 totp_secret，所以不打印密钥——入库的仍是原来那把。）");
}
if (local) console.log("本地预览可直接看 /dev/totp 取当前验证码。");
