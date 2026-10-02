import type { ChannelType } from "./channels";

export type Env = {
  DB: D1Database;
  SITE_URL: string;
  MOCK_SEND?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  CRON_SECRET?: string;
  /** 外部心跳：按 job 两个独立 check，共用一个会让 send 每天喂狗、judge 静默不跑也不告警（README「自监控与运维」） */
  HEARTBEAT_SEND_URL?: string;
  HEARTBEAT_JUDGE_URL?: string;
  DEV_HELPER?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
};

export type SendResult = { ok: boolean; detail: string };
export type OutboxEntry = { at: number; to: string; title: string; body: string; ok: boolean; detail: string };

/** 本地预览的假投递收件箱：单 isolate 内存环形队列，只用于看得见「发出去了什么」。 */
const outbox: OutboxEntry[] = [];
const OUTBOX_MAX = 50;

export function getOutbox(): OutboxEntry[] {
  return outbox;
}

export function isMock(env: Env): boolean {
  return env.MOCK_SEND === "1";
}

const CHANNEL_TIMEOUT_MS = 5_000;
const RETRIES = 3;

/** 单通道调用内即时重试 ≤3 次（README「环境变量」的阈值表）；时间预算由调用方的 allSettled 控制。 */
export async function deliverWithRetry(
  env: Env,
  type: ChannelType,
  config: Record<string, string>,
  title: string,
  body: string,
): Promise<SendResult> {
  let last: SendResult = { ok: false, detail: "未执行" };
  for (let i = 0; i < RETRIES; i++) {
    last = await deliver(env, type, config, title, body);
    if (last.ok) return last;
    if (i < RETRIES - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return last;
}

export async function deliver(
  env: Env,
  type: ChannelType,
  config: Record<string, string>,
  title: string,
  body: string,
): Promise<SendResult> {
  const text = `${title}\n\n${body}`;
  const target = describeTarget(type, config);

  if (isMock(env)) {
    const entry: OutboxEntry = { at: Date.now(), to: target, title, body, ok: true, detail: "MOCK_SEND=1 本地假投递" };
    outbox.unshift(entry);
    outbox.length = Math.min(outbox.length, OUTBOX_MAX);
    console.log(`[mock-send] ${type} -> ${target} :: ${title}`);
    return { ok: true, detail: `[本地模拟] 已投递到 ${target}` };
  }

  try {
    switch (type) {
      case "telegram":
        return await post(env, `https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          chat_id: config.chatId,
          text,
        }, target);
      case "bark": {
        const base = (config.url || "https://api.day.app").replace(/\/+$/, "");
        return await post(env, `${base}/${config.key}`, { title, body, group: "silema" }, target);
      }
      case "ntfy": {
        const base = (config.url || "https://ntfy.sh").replace(/\/+$/, "");
        const headers: Record<string, string> = { Title: title, Priority: "high", Tags: "warning" };
        if (config.token) headers.Authorization = `Bearer ${config.token}`;
        return await rawPost(env, `${base}/${config.topic}`, text, headers, target);
      }
      case "serverchan":
        return await postForm(env, `https://sctapi.ftqq.com/${config.sendKey}.send`, { title, desp: body }, target);
      case "serverchan3":
        return await postForm(env, `https://push.ft07.com/send/${config.sendKey}.send`, { title, desp: body }, target);
      case "webhook": {
        const headers: Record<string, string> = {};
        if (config.token) headers.Authorization = `Bearer ${config.token}`;
        return await rawPost(env, config.url, JSON.stringify({ title, body }), {
          "Content-Type": "application/json",
          ...headers,
        }, target);
      }
      case "email": {
        if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
          return { ok: false, detail: "未配置 EMAIL_API_KEY / EMAIL_FROM，邮件通道不可用" };
        }
        return await rawPost(
          env,
          "https://api.resend.com/emails",
          JSON.stringify({
            from: env.EMAIL_FROM,
            to: [config.to],
            subject: title,
            text: body,
            html: htmlBody(body),
          }),
          { "Content-Type": "application/json", Authorization: `Bearer ${env.EMAIL_API_KEY}` },
          target,
        );
      }
      default:
        return { ok: false, detail: `未知通道类型 ${type}` };
    }
  } catch (err) {
    return { ok: false, detail: `${String(err)}` };
  }
}

async function post(env: Env, url: string, json: unknown, target: string): Promise<SendResult> {
  return rawPost(env, url, JSON.stringify(json), { "Content-Type": "application/json" }, target);
}

async function postForm(env: Env, url: string, fields: Record<string, string>, target: string): Promise<SendResult> {
  const form = new URLSearchParams(fields);
  return rawPost(env, url, form.toString(), { "Content-Type": "application/x-www-form-urlencoded" }, target);
}

async function rawPost(
  env: Env,
  url: string,
  payload: string,
  headers: Record<string, string>,
  target: string,
): Promise<SendResult> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: payload,
    signal: AbortSignal.timeout(CHANNEL_TIMEOUT_MS),
  });
  const text = (await res.text()).slice(0, 400);
  const ok = res.ok && !/"errcode"\s*:\s*[1-9]/.test(text) && !/"ok"\s*:\s*false/.test(text);
  return { ok, detail: ok ? `HTTP ${res.status} · ${target}` : `HTTP ${res.status} ${text}` };
}

/**
 * `text` 正文才是权威版本；HTML 只为让签到链接在手机上可直接点。
 * 先整体转义再链接化，所以 href 里的 `&` 以 `&amp;` 形式出现，是合法 HTML。
 */
function htmlBody(body: string): string {
  const esc = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const linked = esc.replace(/https:\/\/[^\s<]+/g, (m) => {
    const tail = /[,.;:!?，。；：！？、）)]+$/.exec(m)?.[0] ?? "";
    const u = tail ? m.slice(0, -tail.length) : m;
    return `<a href="${u}" style="color:#0b6bcb;word-break:break-all">${u}</a>${tail}`;
  });
  return `<div style="font:14px/1.75 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap">${linked}</div>`;
}

export function describeTarget(type: ChannelType, config: Record<string, string>): string {
  switch (type) {
    case "telegram":
      return `chat ${config.chatId ?? "?"}`;
    case "email":
      return config.to ?? "?";
    case "bark":
      return `bark ****${(config.key ?? "").slice(-4)}`;
    case "ntfy":
      return `ntfy/${config.topic}`;
    case "serverchan":
    case "serverchan3":
      return "Server酱";
    case "webhook":
      try {
        return new URL(config.url).hostname;
      } catch {
        return "webhook";
      }
  }
}
