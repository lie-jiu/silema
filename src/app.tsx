import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { Context } from "hono";

import { performCheckin, resolveView, viewOf, type CheckinView } from "./lib/checkin";
import { isChannelType, mergeConfig, unsafeWebhookUrl, validateConfig, type ChannelType } from "./lib/channels";
import { configsDiffer, notifyContactChange, targetBrief, type NoticeOutcome } from "./lib/contact-change";
import { runDaily, runJudge, runSend } from "./lib/cron";
import { checkedThisCycle, getOwner, writeWithRetry, type OwnerRow } from "./lib/db";
import { healthOf } from "./lib/health";
import { render } from "./lib/messages";
import { clearRateLimit, hitRateLimit } from "./lib/rate-limit";
import { configOf, countFinal, deleteRecipient, finalRecipients, getRecipient, insertRecipient, listRecipients, updateRecipient } from "./lib/recipients";
import { deliver, getOutbox, isMock, type Env } from "./lib/send";
import { fragStatus, missingSecrets, requireAuth, securityHeaders, wantsHtmx } from "./lib/security";
import { clearSessionCookie, issueSession, readSession, SESSION_COOKIE, sessionCookie } from "./lib/session";
import { verifyPassword } from "./lib/password";
import { backupCodeCount, generateBackupCodes, hashBackupCodes, matchBackupCode, removeCode } from "./lib/backup-codes";
import { fmtClock, fmtDate, isValidTimeZone } from "./lib/time";
import { mint } from "./lib/tokens";
import { currentTotp, verifyTotp } from "./lib/totp";
import { constantTimeEqual } from "./lib/util";

import { CheckinPage } from "./routes/checkin";
import { DashboardPage } from "./routes/dashboard";
import { HealthPage } from "./routes/health";
import { LoginPage } from "./routes/login";
import { RecipientEditPage, RecipientsPage, ChannelFields } from "./routes/recipients";
import { SecurityPage, SettingsPage } from "./routes/settings";
import { LockGuidePage, StatusPage } from "./routes/status";
import { Notice } from "./ui/kit";
import { Shell } from "./ui/shell";

import htmxMin from "htmx.org/dist/htmx.min.js?raw";
import holdButton from "./client/hold-button.js?raw";
import dialogJs from "./client/dialog.js?raw";
import chipsJs from "./client/chips.js?raw";

type Bindings = Env;
type Variables = { owner: OwnerRow };

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const clientIp = (c: { req: { header: (n: string) => string | undefined } }) =>
  c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

app.use("*", async (c, next) => {
  securityHeaders(c);
  // 开了 Workers Cache 之后，200 的 GET 响应**即使不带 Cache-Control 也会被边缘缓存 2 小时**，
  // 而绕过条件只认 Set-Cookie 响应头和 Authorization 请求头——Cookie 不算。也就是说 /admin 和
  // /c/:token 都会被缓存住再原样吐给任何请求同一 URL 的人。所以这里默认全站 no-store，
  // 唯一放行长缓存的是内容寻址过的 /assets/*（见下）。
  c.header("Cache-Control", "no-store");
  await next();
});

// ---- 前端运行时：htmx + 三个小 module script，全部同源提供以守住 CSP script-src 'self' ----
const JS: Record<string, string> = {
  "htmx.min.js": htmxMin,
  "hold-button.js": holdButton,
  "dialog.js": dialogJs,
  "chips.js": chipsJs,
};
app.get("/assets/:name", (c) => {
  const body = JS[c.req.param("name") ?? ""];
  if (!body) return c.notFound();
  // URL 上带内容哈希（shell.tsx 的 versioned），内容一变 URL 就变，所以可以 immutable 一年：
  // 签到链接是每天才打开一次的，缓存期短于这个间隔等于每天重下一遍 52KB 的 htmx。
  return c.body(body, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
});

// ---- 公共：状态与签到 ----
function publicStatus(o: OwnerRow, now: number) {
  return {
    state: o.state,
    streak: o.streak,
    missedStreak: o.missed_streak,
    checkedToday: checkedThisCycle(o),
    lastCheckinDate: o.last_checkin_at == null ? null : fmtDate(o.timezone, o.last_checkin_at),
    timezone: o.timezone,
  };
}

app.get("/api/status", async (c) => {
  const o = await getOwner(c.env.DB);
  if (!o) return c.json({ error: "not_initialized" }, 503);
  return c.json(publicStatus(o, Date.now()));
});

app.get("/", async (c) => {
  return c.html(<StatusPage owner={await getOwner(c.env.DB)} />);
});

/** 锁死屏的下一级：静态指引，刻意不读 owner——它不需要任何状态，也就没有可泄露的东西。 */
app.get("/help", (c) => c.html(<LockGuidePage />));

app.get("/c/:token", async (c) => {
  const now = Date.now();
  const rl = await hitRateLimit(c.env.DB, `link:${clientIp(c)}`, 60, 3_600_000, now);
  if (!rl.allowed) {
    return c.html(
      <CheckinPage view={{ kind: "invalid", owner: await getOwnerOrBlank(c.env.DB) }} site={c.env.SITE_URL} error={`访问太频繁，请 ${rl.retryAfterMinutes} 分钟后再打开`} />,
      429,
    );
  }
  const view = await resolveView(c.env.DB, c.req.param("token") ?? "", now);
  return c.html(<CheckinPage view={view} site={c.env.SITE_URL} />);
});

/** 全站唯一的签到入口。GET 只渲染、POST 才消费——防邮件网关自动抓取替所有者续命。 */
app.post("/c/:token/do", async (c) => {
  const now = Date.now();
  const raw = c.req.param("token") ?? "";
  const rl = await hitRateLimit(c.env.DB, `linkdo:${clientIp(c)}`, 30, 3_600_000, now);
  if (!rl.allowed) {
    return respond(c, { error: `操作太频繁，请 ${rl.retryAfterMinutes} 分钟后再试` }, now, raw);
  }
  const res = await performCheckin(c.env.DB, raw, now);
  if (!res.ok) {
    const view = await resolveView(c.env.DB, raw, now);
    if (res.reason === "used") return respond(c, { view }, now, raw);
    // 锁定期既不发日常链接也不允许重发，所以「等明天的新链接」这句在 locked 态是假的
    return respond(
      c,
      {
        view,
        error:
          view.owner.state === "locked"
            ? "系统已锁死，锁定期不再发出任何链接，而这条恢复链接已经过期"
            : "这条链接只在当天有效，请等明天 12:00 的新链接，或去后台重发",
      },
      now,
      raw,
    );
  }
  // performCheckin 交回来的就是签到后的 owner 与已消费的令牌，渲染同一页不必再查一次库
  const view = viewOf(res.token, res.owner, now);
  if (res.kind === "test") return respond(c, { view, test: true }, now, raw);
  return respond(c, { view, done: { streak: res.streak, wasLocked: res.wasLocked } }, now, raw);
});

async function respond(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  extra: { done?: { streak: number; wasLocked: boolean }; error?: string; view?: CheckinView; test?: boolean },
  now: number,
  raw: string,
) {
  const view = extra.view ?? (await resolveView(c.env.DB, raw, now));
  const page = (
    <CheckinPage
      view={view}
      site={c.env.SITE_URL}
      done={extra.done}
      error={extra.error}
      test={extra.test}
      fragment={wantsHtmx(c)}
    />
  );
  return c.html(page, fragStatus(c, extra.error ? 400 : 200));
}

async function getOwnerOrBlank(db: D1Database): Promise<OwnerRow> {
  const o = await getOwner(db);
  if (o) return o;
  return {
    id: 1,
    totp_secret: "",
    totp_last_step: 0,
    backup_codes: null,
    session_epoch: 1,
    timezone: "Asia/Shanghai",
    state: "normal",
    streak: 0,
    missed_streak: 0,
    last_checkin_at: null,
    locked_at: null,
    final_sent_at: null,
    final_second_at: null,
    last_send_at: null,
    last_judge_at: Date.now(),
    last_cron_at: null,
    last_cron_status: null,
    last_cron_error: null,
  };
}

// ---- 手动触发 cron（生产环境的手动触发与失败重发；本地用 /cdn-cgi/local/scheduled）----
app.post("/__cron", async (c) => {
  if (!c.env.CRON_SECRET) return c.text("CRON_SECRET 未配置，拒绝执行", 403);
  const given = c.req.header("X-Cron-Secret") ?? "";
  if (!constantTimeEqual(given, c.env.CRON_SECRET)) return c.text("forbidden", 403);
  const rl = await hitRateLimit(c.env.DB, `cron:${clientIp(c)}`, 10, 900_000);
  if (!rl.allowed) return c.text(`too many requests，请 ${rl.retryAfterMinutes} 分钟后再试`, 429);

  // daily = 线上那条 cron 跑的完整流程（判定 → 发送）；send / judge 保留给单阶段排查与补跑
  const job = c.req.query("job") ?? "daily";
  const force = c.req.query("force") === "1";
  if (job !== "daily" && job !== "send" && job !== "judge") return c.text("job 必须是 daily / send / judge", 400);
  const res =
    job === "daily"
      ? await runDaily(c.env, { force })
      : job === "send"
        ? await runSend(c.env, { force })
        : await runJudge(c.env, { force });
  return c.json(res);
});

// ---- 认证 ----
app.get("/admin/login", (c) => {
  const missing = missingSecrets(c.env);
  if (missing.length > 0) return c.text(`服务未正确配置，缺少 ${missing.join(" / ")}`, 503);
  return c.html(
    <LoginPage
      reason={c.req.query("reason")}
      next={c.req.query("next") ?? "/admin"}
      error={c.req.query("reason") === "logout" ? "已注销所有设备，请重新登录。" : undefined}
    />,
    200,
    { "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" },
  );
});

app.post("/api/auth/login", async (c) => {
  const missing = missingSecrets(c.env);
  if (missing.length > 0) {
    return fail(c, "服务未正确配置，无法登录（缺少 " + missing.join(" / ") + "）");
  }
  const now = Date.now();
  const ip = clientIp(c);
  const rl = await hitRateLimit(c.env.DB, `login:${ip}`, 10, 900_000, now);
  if (!rl.allowed) return fail(c, `尝试次数过多，请 ${rl.retryAfterMinutes} 分钟后再试`);

  const body = await c.req.parseBody();
  const username = String(body.username ?? "");
  const password = String(body.password ?? "");
  const code = String(body.totpCode ?? "").trim();
  const next = safeNext(String(body.next ?? ""));
  const owner = await getOwner(c.env.DB);

  if (!owner) return fail(c, "服务未正确配置，无法登录（owner 未初始化）");

  // 失败响应不区分「用户名不存在」与「密码错误」
  const userOk = constantTimeEqual(username, c.env.ADMIN_USERNAME ?? "");
  const passOk = await verifyPassword(password, c.env.ADMIN_PASSWORD_HASH);
  if (!userOk || !passOk) {
    await verifyPassword(password, "$").catch(() => {});
    return fail(c, "用户名或密码不正确", { username });
  }

  // 验证码字段同时接受 6 位动态码与未使用的恢复码
  const used = await matchBackupCode(owner.backup_codes, code);
  if (used) {
    await writeWithRetry("消费恢复码", () =>
      c.env.DB.prepare("UPDATE owner SET backup_codes = ? WHERE id = 1").bind(removeCode(owner.backup_codes, used.hash)).run(),
    );
  } else {
    const res = await verifyTotp(owner.totp_secret, code, owner.totp_last_step, now);
    if (!res.ok) {
      return fail(
        c,
        res.reason === "replay"
          ? "这个验证码刚刚已经用过（同一步数不可重复使用），请用最新的 6 位"
          : "验证码不正确或已刷新，请用最新的 6 位",
      );
    }
    await writeWithRetry("记录 TOTP 步数", () =>
      c.env.DB.prepare("UPDATE owner SET totp_last_step = ? WHERE id = 1").bind(res.step).run(),
    );
  }

  await clearRateLimit(c.env.DB, `login:${ip}`);
  const session = await issueSession(c.env.SESSION_SECRET!, owner.session_epoch, now);
  c.header("Set-Cookie", sessionCookie(session.value, session.maxAge));
  c.header("Cache-Control", "no-store");
  if (wantsHtmx(c)) {
    // htmx 会按这个头做整页跳转
    c.header("HX-Redirect", next);
    return c.body(null, 204);
  }
  return c.redirect(next, 302);

  function fail(cc: typeof c, message: string, echo: { username?: string } = {}) {
    const page = <LoginPage error={message} username={echo.username} next={next} fragment={wantsHtmx(cc)} />;
    return cc.html(page, fragStatus(cc, 401), { "Cache-Control": "no-store" });
  }
});

function safeNext(target: string): string {
  return target.startsWith("/admin") || target === "/" ? target : "/admin";
}

/**
 * 需登录的接口。**必须在这些 handler 注册之前**挂中间件**：Hono 按注册顺序执行匹配链，
 * 先命中的 handler 一旦返回响应，后注册的 `app.use` 对该路径根本不会执行（已实测）。
 * `/api/auth/login` 与 `/api/auth/logout` 刻意保持公开，不在此列。
 */
for (const path of [
  "/api/recipients",
  "/api/recipients/*",
  "/api/settings",
  "/api/cron/resend",
  "/api/auth/logout-all",
  "/api/auth/backup-codes",
]) {
  app.use(path, requireAuth());
}

app.post("/api/auth/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookie());
  if (wantsHtmx(c)) {
    c.header("HX-Redirect", "/admin/login");
    return c.body(null, 204);
  }
  return c.redirect("/admin/login", 302);
});

app.post("/api/auth/logout-all", async (c) => {
  const owner = c.get("owner");
  await writeWithRetry("bump session_epoch", () =>
    c.env.DB.prepare("UPDATE owner SET session_epoch = session_epoch + 1 WHERE id = 1").run(),
  );
  void owner;
  return c.body(null, 204, { "Set-Cookie": clearSessionCookie() });
});

/** 明文只显示这一次，库里只存哈希；结果片段就地渲染到 [data-backup-slot]。 */
app.post("/api/auth/backup-codes", async (c) => {
  const codes = generateBackupCodes();
  const hashed = await hashBackupCodes(codes);
  await writeWithRetry("写入恢复码", () =>
    c.env.DB.prepare("UPDATE owner SET backup_codes = ? WHERE id = 1").bind(hashed).run(),
  );
  return c.html(
    <div>
      <div class="mb-2">
        <Notice tone="danger" title="明文只显示这一次，现在就存好">
          关闭后就再也看不到；系统只保存哈希，且旧的 10 个已全部失效。
        </Notice>
      </div>
      <ul data-codes class="grid grid-cols-2 gap-2 font-mono text-body tabular-nums">
        {codes.map((x) => (
          <li class="px-2 py-1 rounded-field bg-ink/5 select-all">{x}</li>
        ))}
      </ul>
      <div class="mt-3">
        <button type="button" data-copy-into="[data-codes]" class="w-full h-11 rounded-field border border-primary/40 text-body font-semibold text-primary">
          复制全部
        </button>
      </div>
    </div>,
  );
});

// ---- 需登录的页面 ----
app.use("/admin/*", async (c, next) => {
  if (c.req.path === "/admin/login") return next();
  return requireAuth()(c, next);
});

async function renderDashboard(c: Context<{ Bindings: Bindings; Variables: Variables }>, flashKey?: string) {
  const now = Date.now();
  // requireAuth 已经读过 owner 并挂进 context，这里再查一次是白花一个往返
  const o = c.get("owner");
  const health = healthOf(o, now);
  const rows = await listRecipients(c.env.DB);
  return (
    <DashboardPage
      owner={o}
      health={health}
      recipientCounts={{ prompt: rows.filter((r) => r.on_prompt === 1).length, final: rows.filter((r) => r.on_final === 1).length }}
      flash={flashOf(c, flashKey)}
      now={now}
    />
  );
}

function flashOf(c: { req: { query: (k: string) => string | undefined } }, key?: string) {
  const f = key ?? c.req.query("flash");
  const map: Record<string, { tone: "ok" | "info" | "warn"; text: string }> = {
    resent: { tone: "ok", text: "今日链接已重发到所有「日常提醒」通道。" },
    deleted: { tone: "ok", text: "接收人已删除。" },
    saved: { tone: "ok", text: "已保存。" },
    created: { tone: "ok", text: "接收人已添加。" },
    rotated: { tone: "info", text: "已生成一批新恢复码，旧的全部失效。" },
    tz: { tone: "ok", text: "时区已更新。" },
    checked: { tone: "ok", text: "已确认。" },
  };
  const base = f ? (map[f] ?? null) : null;
  if (!base) return null;
  const notice = NOTICE_TEXT[c.req.query("notice") ?? ""];
  if (!notice) return base;
  return { tone: notice.tone, text: `${base.text}${notice.text}` };
}

/** 名单变更告知的结果由服务端写在跳转 query 上，只取这几个固定值，不回显任何用户输入。 */
const NOTICE_TEXT: Record<string, { tone: "ok" | "warn"; text: string }> = {
  ok: { tone: "ok", text: "已向变更前的紧急联系人（含被移除那位本人）发出变更告知。" },
  partial: { tone: "warn", text: "变更告知只送达一部分，请到接收人列表里核对通道。" },
  fail: { tone: "warn", text: "变更告知一条都没送达，请到接收人列表里核对通道。" },
};

app.get("/admin", async (c) => c.html(await renderDashboard(c, c.req.query("flash"))));

app.get("/admin/health", (c) => {
  const now = Date.now();
  const o = c.get("owner");
  return c.html(<HealthPage owner={o} health={healthOf(o, now)} flash={flashOf(c)} now={now} />);
});

app.get("/admin/settings", async (c) => {
  const o = c.get("owner");
  const now = Date.now();
  return c.html(
    <SettingsPage
      owner={o}
      health={healthOf(o, now)}
      flash={flashOf(c)}
      site={c.env.SITE_URL}
      now={now}
    />,
  );
});

app.get("/admin/security", async (c) => {
  const o = c.get("owner");
  const payload = await readSession(c.env.SESSION_SECRET!, getCookie(c, SESSION_COOKIE));
  return c.html(
    <SecurityPage
      owner={o}
      flash={flashOf(c)}
      remainingCodes={backupCodeCount(o.backup_codes)}
      sessionExpiresAt={payload?.exp ?? null}
      now={Date.now()}
    />,
  );
});

app.post("/api/settings", async (c) => {
  const body = await c.req.formData();
  const tz = String(body.get("timezone") ?? "");
  if (!isValidTimeZone(tz)) {
    return c.html(<span class="text-danger">时区名称无效，已保留原值</span>, fragStatus(c, 400));
  }
  await c.env.DB.prepare("UPDATE owner SET timezone = ? WHERE id = 1").bind(tz).run();
  return c.html(<span class="text-ok">已保存为 {tz}</span>);
});

app.post("/api/cron/resend", async (c) => {
  // 锁死后这个动作的语义不成立：locked 态的 runSend 发的是第二条最终消息，不是当日链接。
  if (c.get("owner").state === "locked") return c.text("已锁死，锁定期不重发日常链接", 409);
  const res = await runSend(c.env, { force: true });
  if (!res.ran) return c.text(res.skipped ?? "未执行", 409);
  if (res.error) return c.text(res.detail, 502);
  return c.body(null, 204);
});

// ---- 接收人 ----
type FormValues = {
  label: string;
  channelType: ChannelType;
  config: Record<string, string>;
  onPrompt: boolean;
  onFinal: boolean;
  promptContent: string;
  reminderContent: string;
  finalContent: string;
};

async function readRecipientForm(c: { req: { formData: () => Promise<FormData> } }): Promise<FormValues> {
  const f = await c.req.formData();
  const typeRaw = String(f.get("channelType") ?? "telegram");
  const channelType = isChannelType(typeRaw) ? typeRaw : "telegram";
  const config: Record<string, string> = {};
  for (const [k, v] of f.entries()) {
    const m = /^config\[(.+)\]$/.exec(k);
    if (m) config[m[1] as string] = String(v);
  }
  return {
    label: String(f.get("label") ?? "").slice(0, 40),
    channelType,
    config,
    onPrompt: f.get("onPrompt") === "1",
    onFinal: f.get("onFinal") === "1",
    promptContent: String(f.get("promptContent") ?? ""),
    reminderContent: String(f.get("reminderContent") ?? ""),
    finalContent: String(f.get("finalContent") ?? ""),
  };
}

function validateRecipient(v: FormValues, existing: Record<string, string>, siteUrl: string): string[] {
  const errors: string[] = [];
  if (!v.label.trim()) errors.push("名称不能为空");
  errors.push(...validateConfig(v.channelType, mergeConfig(v.channelType, existing, v.config)).map((e) => `field:${e}`));
  const merged = mergeConfig(v.channelType, existing, v.config);
  if (v.channelType === "webhook") {
    const bad = unsafeWebhookUrl(merged.url ?? "", siteUrl);
    if (bad) errors.push(`field:${bad}`);
  }
  if (!v.onPrompt && !v.onFinal) errors.push("至少要订阅一个事件（日常提醒或紧急联系人）");
  // 留空 = 用内置默认文案（默认文案里都有 {checkin_url}），所以这里只约束**填了内容**的模板。
  // 自定义文案少了 {checkin_url} 会静默发出一条「看着正常、点了没反应」的消息：缺席那天
  // 那条就是当天唯一的签到入口，而锁死后最终消息里的那条是唯一的自救链接。
  const needsLink: Array<[string, string]> = [
    ["日常签到链接", v.promptContent],
    ["未签到提醒", v.reminderContent],
    ["最终消息", v.finalContent],
  ];
  for (const [name, text] of needsLink) {
    if (text.trim() && !text.includes("{checkin_url}")) {
      errors.push(`「${name}」的自定义文案必须包含 {checkin_url}；想用内置默认文案就把它留空`);
    }
  }
  return errors;
}

app.get("/admin/recipients", async (c) => {
  const rows = await listRecipients(c.env.DB);
  return c.html(<RecipientsPage rows={rows} flash={flashOf(c)} now={Date.now()} />);
});

app.get("/admin/recipients/new", async (c) => {
  return c.html(
    <RecipientEditPage
      row={null}
      type="telegram"
      config={{}}
      masked={false}
      values={{ label: "", onPrompt: true, onFinal: false, promptContent: "", reminderContent: "", finalContent: "" }}
      errors={[]}
      fieldErrors={{}}
    />,
  );
});

app.get("/admin/recipients/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await getRecipient(c.env.DB, id);
  if (!row) return c.html(<RecipientsPage rows={await listRecipients(c.env.DB)} flash={{ tone: "danger", text: "找不到该接收人" }} now={Date.now()} />);
  return c.html(
    <RecipientEditPage
      row={row}
      type={row.channel_type}
      config={configOf(row)}
      masked
      values={{
        label: row.label,
        onPrompt: row.on_prompt === 1,
        onFinal: row.on_final === 1,
        promptContent: row.prompt_content,
        reminderContent: row.reminder_content,
        finalContent: row.final_content,
      }}
      errors={[]}
      fieldErrors={{}}
    />,
  );
});

/** 切换通道时由服务端渲染该通道的字段片段，7 套 schema 不下发到前端。 */
app.post("/api/recipients/fields", async (c) => {
  const v = await readRecipientForm(c);
  const f = await c.req.formData();
  const id = Number(f.get("editingId") ?? 0);
  const existing = id > 0 ? await getRecipient(c.env.DB, id) : null;
  return c.html(
    <ChannelFields
      type={v.channelType}
      config={existing ? configOf(existing) : v.config}
      masked={existing != null}
      errors={[]}
    />,
  );
});

app.post("/api/recipients", async (c) => {
  const v = await readRecipientForm(c);
  const errors = validateRecipient(v, {}, c.env.SITE_URL);
  // 新增不检查「至少一位紧急联系人」：还没有覆盖时无从「保留」覆盖，拦在这里只会让
  // 大家最先做的一步（给自己加日常提醒通道）做不动。丢掉已有覆盖由更新/删除两条路径拦。
  if (errors.length > 0) {
    return c.html(
      <RecipientEditPage row={null} type={v.channelType} config={v.config} masked={false} values={v} errors={errors} fieldErrors={{}} />,
      400,
    );
  }
  const now = Date.now();
  const row = {
    label: v.label,
    channel_type: v.channelType,
    config_json: JSON.stringify(v.config),
    on_prompt: v.onPrompt ? 1 : 0,
    on_final: v.onFinal ? 1 : 0,
    prompt_content: v.promptContent,
    reminder_content: v.reminderContent,
    final_content: v.finalContent,
    created_at: now,
  };
  // 变更前名单必须在写入之前取，取到的才是「当时被信任的那些人」
  const prevFinal = v.onFinal ? await finalRecipients(c.env.DB) : [];
  await insertRecipient(c.env.DB, row);
  const outcome: NoticeOutcome = v.onFinal
    ? await notifyContactChange(
        c.env,
        prevFinal,
        `新增了一位紧急联系人：「${v.label}」（${targetBrief(row)}）。此后 TA 会在锁死时收到最终消息。`,
        c.get("owner").timezone,
        now,
      )
    : "none";
  return c.redirect(`/admin/recipients?flash=created&notice=${outcome}`, 302);
});

/** 更新与删除各有两个入口：HTML 表单只能 POST（§1.1「状态变更一律 POST」），REST 面保留 PUT/DELETE。 */
async function deleteRecipientHandler(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const id = Number(c.req.param("id"));
  const existing = await getRecipient(c.env.DB, id);
  if (!existing) return c.text("找不到该接收人", 404);
  if (existing.on_final === 1 && (await countFinal(c.env.DB)) <= 1) {
    return c.text("至少需要保留一位紧急联系人。要删除这一位，请先指定另一位接收「最终消息」。", 409);
  }
  // 快照必须在 DELETE 之前：被移除那位自己正是最需要知道的人
  const prevFinal = existing.on_final === 1 ? await finalRecipients(c.env.DB) : [];
  if (!(await deleteRecipient(c.env.DB, id))) {
    // 事前 countFinal 与 DELETE 之间被并发请求抢先移走最后一位时，条件写入不会落。
    return c.text("至少需要保留一位紧急联系人。要删除这一位，请先指定另一位接收「最终消息」。", 409);
  }
  const outcome: NoticeOutcome = prevFinal.length
    ? await notifyContactChange(
        c.env,
        prevFinal,
        `「${existing.label}」（${targetBrief(existing)}）已被移出紧急联系人名单，此后不会再收到最终消息。`,
        c.get("owner").timezone,
        Date.now(),
      )
    : "none";
  return c.body(null, 204, outcome === "none" ? {} : { "X-Notice": outcome });
}

async function updateRecipientHandler(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const id = Number(c.req.param("id"));
  const existing = await getRecipient(c.env.DB, id);
  if (!existing) return c.text("找不到该接收人", 404);

  const v = await readRecipientForm(c);
  const merged = mergeConfig(v.channelType, configOf(existing), v.config);
  const nextJson = JSON.stringify(merged);
  const errors = validateRecipient(v, configOf(existing), c.env.SITE_URL);
  if (!v.onFinal && existing.on_final === 1 && (await countFinal(c.env.DB)) <= 1) {
    errors.push("至少需要保留一位紧急联系人");
  }
  if (errors.length > 0) {
    return c.html(
      <RecipientEditPage row={existing} type={v.channelType} config={merged} masked values={v} errors={errors} fieldErrors={{}} />,
      400,
    );
  }

  const wasFinal = existing.on_final === 1;
  const isFinal = v.onFinal;
  // 只有「进出紧急联系人名单」和「把已信任的人换到别的接收方式」才需要告知；改名与改文案不惊动任何人。
  const retargeted =
    wasFinal && isFinal && (existing.channel_type !== v.channelType || configsDiffer(existing.config_json, nextJson));
  const change = !wasFinal && isFinal
    ? `「${v.label}」被设为紧急联系人（${targetBrief({ channel_type: v.channelType, config_json: nextJson })}），将接收最终消息。`
    : wasFinal && !isFinal
      ? `「${existing.label}」已不再接收最终消息。`
      : retargeted
        ? `紧急联系人「${v.label}」的接收方式从 ${targetBrief(existing)} 变更为 ${targetBrief({ channel_type: v.channelType, config_json: nextJson })}。`
        : "";
  const prevFinal = change ? await finalRecipients(c.env.DB) : [];

  const saved = await updateRecipient(c.env.DB, {
    ...existing,
    label: v.label,
    channel_type: v.channelType,
    config_json: nextJson,
    on_prompt: v.onPrompt ? 1 : 0,
    on_final: v.onFinal ? 1 : 0,
    prompt_content: v.promptContent,
    reminder_content: v.reminderContent,
    final_content: v.finalContent,
  });
  if (!saved) {
    // 条件写入没落 = 并发里最后一位紧急联系人已被退订；库里没改动，所以也不通知任何人。
    errors.push("至少需要保留一位紧急联系人");
    return c.html(
      <RecipientEditPage row={existing} type={v.channelType} config={merged} masked values={v} errors={errors} fieldErrors={{}} />,
      400,
    );
  }

  const now = Date.now();
  const outcome: NoticeOutcome = change
    ? await notifyContactChange(c.env, prevFinal, change, c.get("owner").timezone, now)
    : "none";
  return c.redirect(`/admin/recipients?flash=saved&notice=${outcome}`, 302);
}

app.post("/api/recipients/:id/save", updateRecipientHandler);
app.put("/api/recipients/:id", updateRecipientHandler);
app.post("/api/recipients/:id/delete", deleteRecipientHandler);
app.delete("/api/recipients/:id", deleteRecipientHandler);

/** 测试发送：`[测试]` 前缀 + 一条 TTL 5 分钟、点击不执行签到的链接。 */
app.post("/api/recipients/:id/test", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await getRecipient(c.env.DB, id);
  if (!row) return c.html(<Notice tone="danger">找不到该接收人</Notice>, 404);
  const token = await mint(c.env.DB, "test", Date.now() + 300_000);
  const vars = {
    site: c.env.SITE_URL,
    label: row.label,
    checkin_url: `${c.env.SITE_URL.replace(/\/+$/, "")}/c/${token}`,
  };
  const base = render(row.prompt_content || row.reminder_content || row.final_content, "prompt", vars) ?? {
    title: "死了吗测试",
    body: "",
  };
  const res = await deliver(c.env, row.channel_type, configOf(row), `[测试] ${base.title}`, base.body);
  return c.html(
    res.ok ? (
      <Notice tone="ok" title="已发送">
        <div class="mt-1 break-all">目标：{res.detail}</div>
        <div class="mt-1">测试链接 5 分钟内有效，点开不会记为签到。</div>
      </Notice>
    ) : (
      <Notice tone="danger" title="发送失败">
        <pre class="mt-1 font-mono text-label whitespace-pre-wrap break-all select-all">{res.detail}</pre>
      </Notice>
    ),
    fragStatus(c, res.ok ? 200 : 502),
  );
});

// ---- 本地预览辅助（DEV_HELPER=1 才存在，生产一律 404）----
app.get("/dev/totp", async (c) => {
  if (c.env.DEV_HELPER !== "1") return c.notFound();
  const o = await getOwner(c.env.DB);
  if (!o) return c.text("owner 未初始化", 503);
  const code = currentTotp(o.totp_secret);
  const left = 30_000 - (Date.now() % 30_000);
  return c.html(
    <Shell title="本地 TOTP" shell="public">
      <div class="p-6 text-center">
        <div class="text-num font-semibold tabular-nums tracking-[0.3em]">{code}</div>
        <div class="mt-2 text-label opacity-60 tabular-nums">{Math.ceil(left / 1000)} 秒后刷新（本页 5 秒自动重载）</div>
        <div class="mt-6 text-label opacity-60 break-all">otpauth:// URI 见 npm run db:seed 的输出</div>
        <meta http-equiv="refresh" content="5" />
      </div>
    </Shell>,
  );
});

app.get("/dev/outbox", async (c) => {
  if (c.env.DEV_HELPER !== "1") return c.notFound();
  const rows = getOutbox();
  return c.html(
    <Shell title="本地假投递" shell="public">
      <div class="p-4 flex flex-col gap-3">
        <Notice tone={isMock(c.env) ? "info" : "warn"}>
          {isMock(c.env) ? "MOCK_SEND=1：所有发送只记录、不触网。" : "MOCK_SEND 未开启，这里是本 isolate 的投递日志（内存、重启即失）"}
        </Notice>
        {rows.length === 0 ? <div class="text-label opacity-60 p-2">还没有任何投递记录。试试后台的「测试发送」或重发链接。</div> : null}
        {rows.map((r, i) => (
          <div class="panel p-3">
            <div class="flex items-center justify-between gap-2">
              <span class={`text-label font-semibold ${r.ok ? "text-ok" : "text-danger"}`}>{r.ok ? "已投递" : "失败"}</span>
              <span class="text-label opacity-60 tabular-nums">{fmtClock("Asia/Shanghai", r.at)}</span>
            </div>
            <div class="mt-1 text-body font-semibold">{r.title} → {r.to}</div>
            <pre class="mt-2 text-label font-mono whitespace-pre-wrap break-all opacity-80">{r.body}</pre>
          </div>
        ))}
      </div>
    </Shell>,
  );
});

app.notFound((c) => c.text("not found", 404));
app.onError((err, c) => {
  console.error("[error]", err);
  return c.text(`服务出错：${err.message}`, 500);
});

export { app };
