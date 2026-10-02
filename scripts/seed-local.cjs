#!/usr/bin/env node
"use strict";
// 本地捏数据：重置本地 D1 → 建表 → 按场景写 owner / 接收人 / 令牌，并生成 .dev.vars。
//   node scripts/seed-local.cjs --scenario=healthy
//   场景：healthy | miss1 | miss2 | locked | locked-pending | locked-silent | sendfail | fresh
const fs = require("node:fs");
const path = require("node:path");

const L = require("./_local.cjs");

const args = process.argv.slice(2);
const get = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};

const scenario = get("scenario", "today");
const username = get("username", "admin");
const password = get("password", "preview");
const SCENARIOS = ["today", "healthy", "miss1", "miss2", "locked", "locked-pending", "locked-silent", "sendfail", "fresh"];
if (!SCENARIOS.includes(scenario)) {
  console.error(`未知场景 ${scenario}，可选：${SCENARIOS.join(" | ")}`);
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const now = Date.now();
const today = L.parts(new Date(now));
const bj = (dayOffset, hh, mm = 0) => {
  const p = L.shiftDay(new Date(now), dayOffset);
  return L.beijing(p.year, p.month, p.day, hh, mm);
};

console.log(`\n[1/4] 重建本地库 schema（${L.DB_NAME} · local）`);
L.runSql(
  `DROP TABLE IF EXISTS rate_limits; DROP TABLE IF EXISTS recipients;
   DROP TABLE IF EXISTS checkin_tokens; DROP TABLE IF EXISTS owner;`,
);
L.runMigrations();

// ---- 场景化 owner ----
console.log(`[2/4] 写入 owner（场景 ${scenario}）`);
const secret = L.randomBase32(32);

const base = {
  state: "normal",
  streak: 12,
  missed_streak: 0,
  last_checkin_at: bj(0, 12, 4),
  locked_at: null,
  final_sent_at: null,
  final_second_at: null,
  last_send_at: bj(0, 12, 0),
  last_judge_at: bj(0, 12, 0),
  last_cron_at: bj(0, 12, 0),
  last_cron_status: "ok",
  last_cron_error: null,
};

const scenes = {
  today: { ...base, last_checkin_at: bj(-1, 12, 6) },
  healthy: base,
  miss1: { ...base, streak: 0, missed_streak: 1, last_checkin_at: bj(-1, 12, 6) },
  miss2: { ...base, streak: 0, missed_streak: 2, last_checkin_at: bj(-2, 12, 6) },
  // 锁死发生在缺席第 3 天后的那个 12:00，第一条最终消息由同一次运行立刻投出（两者同刻）；
  // 上次确认因此落在 4 天前
  locked: {
    ...base,
    state: "locked",
    streak: 0,
    missed_streak: 3,
    last_checkin_at: bj(-4, 12, 6),
    locked_at: bj(0, 12, 0),
    final_sent_at: bj(0, 12, 0),
  },
  // 锁死与投递同刻，所以「锁死了但一条都没送达」只可能是那次投递全通道失败
  "locked-pending": {
    ...base,
    state: "locked",
    streak: 0,
    missed_streak: 3,
    last_checkin_at: bj(-4, 12, 6),
    locked_at: bj(0, 12, 0),
    final_sent_at: null,
  },
  "locked-silent": {
    ...base,
    state: "locked",
    streak: 0,
    missed_streak: 3,
    last_checkin_at: bj(-5, 12, 6),
    locked_at: bj(-1, 12, 0),
    final_sent_at: bj(-1, 12, 0),
    final_second_at: bj(0, 12, 0),
  },
  sendfail: {
    ...base,
    streak: 3,
    last_checkin_at: bj(-1, 12, 6),
    last_send_at: bj(-1, 12, 0),
    last_cron_at: bj(0, 12, 0),
    last_cron_status: "error",
    last_cron_error:
      "[send] 2/3 个通道失败：HTTP 500 {\"error\":\"rate limited\"} | HTTP 502 upstream refused",
  },
  fresh: {
    ...base,
    streak: 0,
    missed_streak: 0,
    last_checkin_at: null,
    last_send_at: null,
    last_judge_at: now,
    last_cron_at: null,
    last_cron_status: null,
    last_cron_error: null,
  },
};

const o = scenes[scenario];
L.runSql(
  `INSERT INTO owner (id, totp_secret, session_epoch, timezone, state, streak, missed_streak,
     last_checkin_at, locked_at, final_sent_at, final_second_at, last_send_at, last_judge_at,
     last_cron_at, last_cron_status, last_cron_error)
   VALUES (1, ${L.sqlStr(secret)}, 1, 'Asia/Shanghai', ${L.sqlStr(o.state)}, ${o.streak}, ${o.missed_streak},
     ${L.sqlNum(o.last_checkin_at)}, ${L.sqlNum(o.locked_at)}, ${L.sqlNum(o.final_sent_at)}, ${L.sqlNum(o.final_second_at)},
     ${L.sqlNum(o.last_send_at)}, ${L.sqlNum(o.last_judge_at)}, ${L.sqlNum(o.last_cron_at)},
     ${L.sqlStr(o.last_cron_status)}, ${L.sqlStr(o.last_cron_error)});`,
);

// ---- 捏造的接收人：覆盖 6 种通道 + 两类事件 ----
console.log("[3/4] 写入 6 个假接收人");
const rec = (label, type, config, onPrompt, onFinal, pc, rc, fc) =>
  `(${L.sqlStr(label)}, ${L.sqlStr(type)}, ${L.sqlStr(JSON.stringify(config))}, ${onPrompt}, ${onFinal}, ${L.sqlStr(pc)}, ${L.sqlStr(rc)}, ${L.sqlStr(fc)}, ${now})`;

L.runSql(`INSERT INTO recipients (label, channel_type, config_json, on_prompt, on_final, prompt_content, reminder_content, final_content, created_at) VALUES
  ${rec("我自己的邮箱", "email", { to: "me@example.com" }, 1, 0, "", "", "")},
  ${rec("我自己的 Telegram", "telegram", { botToken: "1234567890:AAExampleTokenForLocalPreview9", chatId: "555123456" }, 1, 0, "", "", "")},
  ${rec("iPhone 提醒（Bark）", "bark", { url: "https://api.day.app", key: "LocalPreviewBarkKey9F3K" }, 1, 0,
      "今天的确认链接\n{checkin_url}", "", "")},
  ${rec("家人 · ntfy", "ntfy", { url: "https://ntfy.sh", topic: "silema-family-demo-topic", token: "" }, 0, 1, "", "", "")},
  ${rec("老友 · Server酱³", "serverchan3", { sendKey: "sctp99999TExampleFakeSendKeyAbCdEf" }, 0, 1, "", "",
      "【重要】长时间未确认\n如果你看到这条消息，请设法联系我。\n我仍可凭此链接撤销锁定：\n{checkin_url}")},
  ${rec("运维 Webhook", "webhook", { url: "https://example.com/silema-hook", token: "" }, 0, 0, "", "", "")};`);

// ---- 签到令牌：三态各一条（令牌名用可读 ASCII，方便直接点链接）----
console.log("[4/4] 写入签到链接（覆盖确认页三态）");
const liveExpire = L.endOfDay(new Date(now));
/** @type {Array<{label:string, token:string, purpose:string, created:number, expires:number, used:number|null}>} */
const tokenRows = [];
const push = (label, token, purpose, created, expires, used) =>
  tokenRows.push({ label, token, purpose, created, expires, used });

if (scenario !== "fresh" && !scenario.startsWith("locked")) {
  push("待确认（今日链接）", "preview-live", "prompt", bj(0, 12, 0), liveExpire, null);
  push("今日已签到（已消费）", "preview-used", "prompt", bj(0, 12, 0), liveExpire, bj(0, 12, 4));
}
if (scenario.startsWith("locked")) {
  push("恢复链接（7 天）", "preview-recovery", "final", bj(0, 0, 0), bj(0, 0, 0) + 7 * 86400000, null);
}
push("测试链接（点它不会签到）", "preview-test", "test", now - 60000, now + 5 * 60000, null);

L.runSql(
  `INSERT INTO checkin_tokens (token, purpose, created_at, expires_at, used_at) VALUES ` +
    tokenRows
      .map(
        (r) =>
          `(${L.sqlStr(r.token)}, ${L.sqlStr(r.purpose)}, ${r.created}, ${r.expires}, ${L.sqlNum(r.used)})`,
      )
      .join(",\n  ") +
    ";",
);

// ---- .dev.vars ----
(async () => {
  const hash = await L.hashPassword(password);
  const sessionSecret = L.randomBase32(40);
  const cronSecret = "local-cron-secret";
  fs.writeFileSync(
    path.join(root, ".dev.vars"),
    [
      "# 由 scripts/seed-local.cjs 生成，只用于本地预览，已被 .gitignore 忽略。",
      `ADMIN_USERNAME=${username}`,
      `ADMIN_PASSWORD=${password}`,
      `ADMIN_PASSWORD_HASH=${hash}`,
      `SESSION_SECRET=${sessionSecret}`,
      `CRON_SECRET=${cronSecret}`,
      "HEARTBEAT_SEND_URL=",
      "HEARTBEAT_JUDGE_URL=",
      "# 本地 MOCK_SEND=1，邮件通道不会真的调用 Resend；要真发就填这两行",
      "EMAIL_API_KEY=",
      "EMAIL_FROM=",
      "SITE_URL=http://localhost:5173",
      "MOCK_SEND=1",
      "DEV_HELPER=1",
      "",
    ].join("\n"),
    "utf8",
  );

  const pad = (s) => s + " ".repeat(Math.max(0, 26 - [...s].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
  console.log(`
============================================================
本地预览数据已就绪 · 场景 = ${scenario}
============================================================
后台登录  http://localhost:5173/admin/login
  用户名  ${username}    口令  ${password}
  TOTP    ${L.totpAt(secret)}（30 秒刷新；直接开 http://localhost:5173/dev/totp 看当前码）
  加进验证器 app：otpauth://totp/silema?secret=${secret}&issuer=%E6%AD%BB%E4%BA%86%E5%90%97&algorithm=SHA1&digits=6&period=30

签到页三态
${tokenRows.map((r) => `  ${pad(r.label)}http://localhost:5173/c/${r.token}`).join("\n")}
  ${pad("链接已失效（不存在的令牌）")}http://localhost:5173/c/deadbeefnotatoken

假投递收件箱  http://localhost:5173/dev/outbox   （MOCK_SEND=1，所有发送只记不发）
手动触发 cron curl -X POST "http://localhost:5173/__cron?job=daily&force=1" -H "X-Cron-Secret: ${cronSecret}"
              job=daily 是线上那次完整运行（判定 → 发送）；也可单跑 job=send / job=judge
换场景        node scripts/seed-local.cjs --scenario=locked   （可选：${SCENARIOS.join(" | ")}）
============================================================
从手机访问：npm run dev -- --host，再用日志里的 Network 地址，并把 .dev.vars 的 SITE_URL 改成同一地址。
`);
})();
