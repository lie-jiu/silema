#!/usr/bin/env node
"use strict";
// 从 stdin 读口令 → 打印可直接粘贴的 ADMIN_PASSWORD_HASH。
// 交互（输入提示、隐藏回显）交给 scripts/hash-password.ps1，这里刻意不碰终端：
// Node 的 readline 遮罩补丁在 Windows 终端上连提示语都显示不出来。
//   node scripts/hash-password.cjs                       读两行（口令 + 确认），只打印哈希
//   node scripts/hash-password.cjs --apply --yes         写进 .secrets.json 并重新部署
//   node scripts/hash-password.cjs --key=EMAIL_FROM      改别的变量（按明文处理，只读一行）
// 口令绝不作为参数传入：argv 会进 shell 历史与系统进程列表。
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { hashPassword } = require("./_local.cjs");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);

const keyArg = argv.find((a) => a.startsWith("--key="));
const key = keyArg ? keyArg.slice(6) : "ADMIN_PASSWORD_HASH";
const hashed = key === "ADMIN_PASSWORD_HASH";
const applyArg = argv.includes("--apply");

let value;
let plain = "";
const rotate = argv.includes("--rotate");

if (rotate) {
  if (hashed) {
    console.error("--rotate 只用于机器生成的密钥（SESSION_SECRET / CRON_SECRET）；口令得由你自己定，去掉 --rotate 走输入流程。");
    process.exit(1);
  }
  run(Promise.resolve(require("node:crypto").randomBytes(32).toString("hex")));
} else {
  const fileArg = argv.find((a) => a.startsWith("--file="));
  const raw = fileArg ? fs.readFileSync(fileArg.slice(7), "utf8") : fs.readFileSync(0, "utf8");
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\r$/, ""));

  const first = lines[0] ?? "";
  if (!first) {
    console.error("stdin 第一行是空的，已放弃。");
    process.exit(1);
  }
  if (hashed) {
    if (lines[1] !== first) {
      console.error("stdin 第二行与第一行不一致，已放弃（没有改动任何东西）。");
      process.exit(1);
    }
    plain = first;
    run(hashPassword(first));
  } else {
    run(Promise.resolve(first));
  }
}

function run(pending) {
  pending.then((hash) => {
    value = hash;
    if (!applyArg) {
      console.log(`\n${key}=`);
      console.log(value);
      if (hashed) {
        console.log(`\n这串是「哈希」，只进 Cloudflare Secret —— 登录页密码框要填的是你刚才输入的明文口令，粘哈希进来一定报「密码错误」。`);
      }
      console.log(`用法：粘进 .secrets.json 的 ${key}，再 npm run deploy -- --secrets-file .secrets.json；或者直接加 --apply --yes 一步做完。`);
      console.log(`在 Cloudflare 控制台改的话，抽屉里必须按 Deploy 才生效 —— 只填不部署等于没改。`);
      return;
    }
    if (!process.argv.includes("--yes")) {
      console.error("--apply 会立刻重新部署线上 Worker，必须同时带 --yes。");
      process.exit(1);
    }
    apply();
  });
}

function apply() {
  const file = path.join(ROOT, ".secrets.json");
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    console.log("（.secrets.json 不存在，已新建；其余 Secret 由上一次部署保留）");
  }
  all[key] = value;
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
  console.log(`\n已写入 .secrets.json（${Object.keys(all).join(", ")}），开始部署…`);

  const child = spawn("npm", ["run", "deploy", "--", "--secrets-file", ".secrets.json"], { cwd: ROOT, stdio: "inherit", shell: true });
  child.on("close", (code) => {
    if (code !== 0) {
      console.error(`部署退出码 ${code}；.secrets.json 已改但线上未确认生效 —— 重跑 npm run deploy -- --secrets-file .secrets.json。`);
      process.exit(code ?? 1);
    }
    const tail =
      key === "SESSION_SECRET"
        ? "所有已登录的会话立即失效，需要重新登录（这正是吊销全部设备的手段）。"
        : key === "CRON_SECRET"
          ? "手动触发 /__cron 要用新值，本地 .dev.vars 里的 CRON_SECRET 只是本地用的。"
          : "";
    console.log(hashed ? "\n完成。新口令立即生效，旧口令作废；已登录的会话不会掉（cookie 由 SESSION_SECRET 签名）。" : `\n完成。${key} 已更新。${tail}`);
    if (hashed) selfCheck(plain);
  });
}

/**
 * 拿刚输入的明文口令去线上试一次，直接告诉你哪一层没过。
 *
 * 故意填一个假的验证码：登录是先校验用户名+口令、再校验验证码，所以返回「验证码不正确」就说明
 * 口令层已经过了 —— 既不用读 TOTP 密钥，也不会消耗 totp_last_step（用户随后自己登录仍能用当前码）。
 */
async function selfCheck(plain) {
  try {
    const cfg = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
    const site = (/"SITE_URL"\s*:\s*"([^"]+)"/.exec(cfg) ?? [])[1];
    const user = JSON.parse(fs.readFileSync(path.join(ROOT, ".secrets.json"), "utf8")).ADMIN_USERNAME || "admin";
    if (!site) throw new Error("读不到 SITE_URL");
    const res = await fetch(`${site.replace(/\/+$/, "")}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: site },
      body: new URLSearchParams({ username: user, password: plain, totpCode: "000000", next: "/admin" }).toString(),
      redirect: "manual",
    });
    const text = await res.text();
    if (text.includes("用户名或密码不正确")) {
      console.log(`\n自检：✗ 服务端不认这个口令 —— 说明刚才终端里收到的字符串和你以为输入的不一样（输入法全角、首尾空格、粘贴带进来的换行是最常见的三种）。`);
    } else if (text.includes("尝试次数过多")) {
      console.log(`\n自检：跳过（登录限流），15 分钟后再试。`);
    } else {
      console.log(`\n自检：✓ 口令层已通过（返回的是验证码那一层）。登录页用户名 ${user} + 你刚才输入的口令，验证码用验证器当前那 6 位。`);
    }
  } catch (err) {
    console.log(`\n自检：没跑成（${String(err && err.message ? err.message : err)}），可以直接去登录页试。`);
  }
}
