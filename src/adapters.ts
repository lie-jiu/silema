import type { Bindings, ChannelType, Message } from "./types";

export interface ChannelAdapter {
  readonly type: ChannelType;
  validateConfig(config: unknown): Record<string, string>;
  send(env: Bindings, config: Record<string, string>, msg: Message): Promise<void>;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal"];
const METADATA_HOSTS = ["169.254.169.254", "metadata.google.internal", "metadata.goog"];

// Loopback, private, CGNAT and link-local ranges for a canonical dotted-quad.
function isPrivateIpv4(host: string): boolean {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  const o = host.split(".").map(Number);
  return (
    o[0] === 0 ||                                     // 0.0.0.0/8
    o[0] === 10 ||                                    // 10.0.0.0/8
    o[0] === 127 ||                                   // 127.0.0.0/8
    (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) ||   // 172.16.0.0/12
    (o[0] === 192 && o[1] === 168) ||                 // 192.168.0.0/16
    (o[0] === 169 && o[1] === 254) ||                 // 169.254.0.0/16
    (o[0] === 100 && o[1]! >= 64 && o[1]! <= 127) ||  // 100.64.0.0/10 CGNAT
    METADATA_HOSTS.includes(host)
  );
}

// Expand an IPv6 literal into its eight 16-bit groups. Returns null when the
// host is not a plain IPv6 address (hostname, zone id, malformed literal).
function expandIpv6(host: string): number[] | null {
  if (!host.includes(":") || !/^[0-9a-f:.]+$/i.test(host)) return null;
  const halves = host.split("::");
  if (halves.length > 2) return null;

  const toGroups = (s: string): number[] | null => {
    if (!s) return [];
    const out: number[] = [];
    for (const part of s.split(":")) {
      // A trailing dotted-quad (::ffff:1.2.3.4) fills the last two groups.
      if (part.includes(".")) {
        const q = part.split(".").map(Number);
        if (q.length !== 4 || q.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        out.push((q[0]! << 8) | q[1]!, (q[2]! << 8) | q[3]!);
        continue;
      }
      const n = parseInt(part, 16);
      if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null;
      out.push(n);
    }
    return out;
  };

  const head = toGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (head === null || tail === null) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array.from({ length: fill }, () => 0), ...tail];
}

function groupsToIpv4(g: number[]): string {
  return [(g[6]! >> 8) & 255, g[6]! & 255, (g[7]! >> 8) & 255, g[7]! & 255].join(".");
}

// IPv6 has several ways to smuggle an IPv4 target inside the address —
// ::ffff:127.0.0.1, ::127.0.0.1 and the NAT64 prefix 64:ff9b::/96 — all of
// which bypass a naive prefix check. Unwrap them so the IPv4 rules apply, then
// reject loopback, unspecified, ULA and link-local directly.
function isPrivateIpv6(host: string): boolean {
  // Strip a zone id (fe80::1%eth0) before parsing; link-local must not slip
  // through just because the interface suffix confuses the matcher.
  const g = expandIpv6(host.split("%")[0] ?? "");
  if (!g) return false;

  if (g.every((x) => x === 0)) return true;                                        // ::
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateIpv4(groupsToIpv4(g));     // NAT64
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 &&
      (g[5] === 0 || g[5] === 0xffff)) {
    return isPrivateIpv4(groupsToIpv4(g));   // ::x.y.z.w / ::ffff:x.y.z.w (covers ::1)
  }
  if ((g[0]! & 0xfe00) === 0xfc00) return true;                                    // fc00::/7 ULA
  if ((g[0]! & 0xffc0) === 0xfe80) return true;                                    // fe80::/10 link-local
  return false;
}

// Resolve non-dotted IPv4 literals (decimal "2130706433", hex "0x7f000001",
// padded/octal dotted forms like "0177.0.0.1") to canonical dotted-quad so the
// private-range check below cannot be bypassed with exotic encodings.
// Unparseable hosts are returned unchanged — they simply won't resolve later.
function normalizeIpHost(host: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;

  const quad = (n: number) =>
    [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

  // Single integer forms: decimal ("2130706433") or hex ("0x7f000001").
  if (/^(0[xX][0-9a-fA-F]+|\d+)$/.test(host)) {
    const n = Number(host);
    return Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? quad(n) : host;
  }

  // Dotted forms with hex/octal/padded components (e.g. "0x7f.0.0.1", "0177.0.0.1").
  const parts = host.split(".");
  if (parts.length >= 2 && parts.length <= 4 && parts.every((p) => /^(0[xX][0-9a-fA-F]+|0\d*|\d+)$/.test(p))) {
    const vals: number[] = [];
    for (const p of parts) {
      let v: number;
      if (/^0[xX]/.test(p)) v = Number(p);
      else if (/^0\d+$/.test(p)) v = parseInt(p.slice(1), 8);
      else v = parseInt(p, 10);
      if (!Number.isInteger(v) || v < 0 || v > 255) return host;
      vals.push(v);
    }
    // inet_aton semantics: missing octets go before the last component
    // ("1.2.3" -> 1.2.0.3, "1.2" -> 1.0.0.2).
    while (vals.length < 4) vals.splice(vals.length - 1, 0, 0);
    return quad(((vals[0]! << 24) | (vals[1]! << 16) | (vals[2]! << 8) | vals[3]!) >>> 0);
  }
  return host;
}

export function safeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:") throw new Error("Only HTTPS URLs are allowed");
  const host = normalizeIpHost(url.hostname.toLowerCase().replace(/^\[|\]$/g, ""));
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new Error("Internal hosts are not allowed");
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    throw new Error("Private addresses are not allowed");
  }
  return url;
}

// Re-checked at send time as well as on write: the database is a second write
// path, and a stale or imported row must not turn into an SSRF.
function assertSafeUrl(raw: string): void {
  safeUrl(raw);
}

async function httpSend(url: string, init: RequestInit): Promise<Response> {
  const resp = await fetch(url, { ...init, redirect: "manual" });
  if (resp.status >= 300 && resp.status < 400) throw new Error(`Redirects are not allowed (${resp.status})`);
  return resp;
}

function requireOk(resp: Response, label: string): void {
  if (!resp.ok) throw new Error(`${label} error: HTTP ${resp.status}`);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

async function sendViaResend(env: Bindings, to: string, msg: Message): Promise<void> {
  const from = env.MAIL_FROM || "死了吗 <onboarding@resend.dev>";
  const resp = await httpSend("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: msg.title || "死了吗",
      html: emailHtml(msg),
    }),
  });
  requireOk(resp, "Email");
}

// Cloudflare Email Routing native delivery (no third party).
async function sendViaCloudflare(env: Bindings, to: string, msg: Message): Promise<void> {
  const { EmailMessage } = await import("cloudflare:email");
  const { createMimeMessage } = await import("mimemessage");

  if (!env.MAIL_FROM) {
    throw new Error("使用 CF 邮件发送需要设置 MAIL_FROM（须为已开启 Email Routing 的域名下地址）");
  }
  const fromAddr = env.MAIL_FROM.match(/<([^>]+)>/)?.[1] || env.MAIL_FROM;

  const mime = createMimeMessage();
  mime.setSender({ name: "死了吗", addr: fromAddr });
  mime.setRecipient(to);
  mime.setSubject(truncate(msg.title || "死了吗", 200));
  mime.addMessage({ contentType: "text/html; charset=utf-8", data: emailHtml(msg) });

  try {
    await env.SEND_EMAIL!.send(new EmailMessage(fromAddr, to, mime.asRaw()));
  } catch (err) {
    const detail = String((err as Error).message || err);
    if (/verified|destination/i.test(detail)) {
      throw new Error(
        `收件人 ${to} 未在 Cloudflare 验证：请在 CF 控制台 → Email Routing → Destination addresses 中添加并确认后再试`
      );
    }
    throw new Error(`CF 邮件发送失败: ${detail}`);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]!);
}

// Raw newlines collapse into spaces inside HTML — turn them into <br> so
// multi-line recipient content survives email rendering.
function nl2br(s: string): string {
  return s.replace(/\r?\n/g, "<br />");
}

// Telegram's HTML parse_mode understands only a handful of tags; a bare "<" or
// "&" anywhere in the text makes the whole call fail with HTTP 400. Allowed
// tags are stashed verbatim (attributes and all) and everything else is
// escaped as plain text.
const TG_ALLOWED_TAGS = /<\/?(?:b|i|u|s|a|code|pre|tg-spoiler)(?:\s[^<>]*)?>/gi;

function escapeTelegramHtml(s: string): string {
  const kept: string[] = [];
  const stashed = s.replace(TG_ALLOWED_TAGS, (m) => {
    kept.push(m);
    return `\u0000${kept.length - 1}\u0000`;
  });
  return stashed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)] ?? "");
}

function emailHtml(msg: Message): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
      <h2 style="margin:0 0 16px;color:#1e293b">${escapeHtml(msg.title || "死了吗")}</h2>
      <div style="font-size:14px;line-height:1.7;color:#334155">${nl2br(msg.body)}</div>
      ${msg.imageUrl ? `<img src="${escapeHtml(msg.imageUrl)}" alt="" style="max-width:100%;border-radius:8px;margin-top:16px" />` : ""}
    </div>
  </body></html>`;
}

export const adapters: Record<ChannelType, ChannelAdapter> = {
  email: {
    type: "email",
    validateConfig: (c: unknown) => {
      const cfg = c as { email?: unknown };
      if (typeof cfg?.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.email)) {
        throw new Error("Invalid email address");
      }
      return { email: cfg.email };
    },
    // Two delivery backends, tried in order:
    //   1. Resend  (env.RESEND_API_KEY)      — any recipient
    //   2. Cloudflare send_email binding       — free, but the recipient must be a
    //      verified destination in Email Routing; sender must be MAIL_FROM.
    send: async (env, config, msg) => {
      if (env.RESEND_API_KEY) {
        await sendViaResend(env, config.email, msg);
      } else if (env.SEND_EMAIL) {
        await sendViaCloudflare(env, config.email, msg);
      } else {
        throw new Error(
          "邮件通道未配置：请设置 RESEND_API_KEY（任意收件人），或启用 CF Email Routing 的 send_email 绑定（收件人需先验证）"
        );
      }
    },
  },

  telegram: {
    type: "telegram",
    validateConfig: (c: unknown) => {
      const cfg = c as { chatId?: unknown; botToken?: unknown };
      if (typeof cfg?.chatId !== "string" || !cfg.chatId.trim()) throw new Error("Telegram chatId required");
      if (typeof cfg?.botToken !== "string" || !/^\d+:[\w-]{30,}$/.test(cfg.botToken)) {
        throw new Error("Telegram botToken format invalid");
      }
      return { chatId: cfg.chatId.trim(), botToken: cfg.botToken.trim() };
    },
    send: async (_env, config, msg) => {
      const text = msg.title
        ? `<b>${escapeTelegramHtml(msg.title)}</b>\n${escapeTelegramHtml(msg.body)}`
        : escapeTelegramHtml(msg.body);
      const resp = await httpSend(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: config.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      requireOk(resp, "Telegram");
    },
  },

  bark: {
    type: "bark",
    validateConfig: (c: unknown) => {
      const cfg = c as { key?: unknown; server?: unknown };
      if (typeof cfg?.key !== "string" || !cfg.key.trim()) throw new Error("Bark key required");
      const server = typeof cfg.server === "string" && cfg.server.trim() ? cfg.server.trim() : "https://api.day.app";
      return { key: cfg.key.trim(), server: safeUrl(server).toString().replace(/\/$/, "") };
    },
    send: async (_env, config, msg) => {
      assertSafeUrl(config.server);
      const params = new URLSearchParams();
      params.set("title", msg.title || "Alert");
      params.set("body", msg.body);
      if (msg.imageUrl) params.set("image", msg.imageUrl);
      const resp = await httpSend(`${config.server}/${encodeURIComponent(config.key)}?${params}`, {});
      requireOk(resp, "Bark");
    },
  },

  ntfy: {
    type: "ntfy",
    validateConfig: (c: unknown) => {
      const cfg = c as { server?: unknown; topic?: unknown };
      const server = typeof cfg?.server === "string" && cfg.server.trim() ? cfg.server.trim() : "https://ntfy.sh";
      if (typeof cfg?.topic !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(cfg.topic)) {
        throw new Error("ntfy topic must be 1-64 chars of letters/digits/_/-");
      }
      return { server: safeUrl(server).toString().replace(/\/$/, ""), topic: cfg.topic };
    },
    send: async (_env, config, msg) => {
      assertSafeUrl(config.server);
      const resp = await httpSend(config.server, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: config.topic,
          title: msg.title || "Alert",
          message: msg.body,
          priority: "high",
          tags: ["skull"],
          markdown: true,
        }),
      });
      requireOk(resp, "ntfy");
    },
  },

  serverchan: {
    type: "serverchan",
    validateConfig: (c: unknown) => {
      const cfg = c as { sendKey?: unknown; channel?: unknown; openid?: unknown; noip?: unknown };
      // ServerChan keys are alphanumeric (e.g. "SCT123456TaBcDeFgHiJkLmNoP"); accept any case/prefix variant.
      if (typeof cfg?.sendKey !== "string" || !/^[A-Za-z0-9]{8,64}$/.test(cfg.sendKey.trim())) {
        throw new Error("ServerChan SendKey 格式无效：应为官网提供的 SendKey（如 SCT 开头的字母数字串）");
      }
      const out: Record<string, string> = { sendKey: cfg.sendKey.trim() };
      // Optional params per official docs (https://sctapi.ftqq.com/{key}.send):
      //   channel: digits/pipes, e.g. "9|66"; openid: receivers; noip=1 hides caller IP
      if (cfg.channel !== undefined && cfg.channel !== "") {
        if (typeof cfg.channel !== "string" || !/^\d{1,4}(\|\d{1,4}){0,1}$/.test(cfg.channel)) {
          throw new Error("channel 参数无效：应为通道数字值，最多两个并用 | 分隔（如 9|66）");
        }
        out.channel = cfg.channel;
      }
      if (cfg.openid !== undefined && cfg.openid !== "") {
        if (typeof cfg.openid !== "string" || !/^[\w@,-]{1,256}$/.test(cfg.openid)) {
          throw new Error("openid 参数无效：多个用 , 或 | 分隔");
        }
        out.openid = cfg.openid;
      }
      if (cfg.noip !== undefined && String(cfg.noip) === "1") out.noip = "1";
      return out;
    },
    send: async (_env, config, msg) => {
      // Official API: POST https://sctapi.ftqq.com/{key}.send, FORM-encoded by default.
      //   title: required, max 32 chars; desp: optional Markdown, max 32KB;
      //   short/noip/channel/openid optional. Response is queued (pushid/readkey).
      const params = new URLSearchParams();
      params.set("title", truncate(msg.title || "死了吗", 32));
      params.set("desp", msg.body.slice(0, 32 * 1024));
      if (config.short) params.set("short", truncate(config.short, 64));
      if (config.channel) params.set("channel", config.channel);
      if (config.openid) params.set("openid", config.openid);
      if (config.noip === "1") params.set("noip", "1");

      const resp = await httpSend(`https://sctapi.ftqq.com/${encodeURIComponent(config.sendKey)}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const text = await resp.text();

      if (!resp.ok) {
        throw new Error(`ServerChan HTTP ${resp.status}: ${truncate(text.replace(/\s+/g, " "), 200)}`);
      }
      // HTTP 200 can still carry a business error — surface it instead of silently "succeeding".
      let parsed: { code?: number; message?: string; info?: string; error?: string };
      try {
        parsed = JSON.parse(text);
      } catch {
        return; // non-JSON 2xx body: accept
      }
      if (typeof parsed.code === "number" && parsed.code !== 0 && parsed.code !== 200) {
        const info = parsed.message || parsed.info || parsed.error || "推送失败";
        if (/发送次数限制|次数限制/.test(info)) {
          throw new Error(
            "Server酱：今日免费额度（5 条/天）已用完。等待次日重置、前往官网升级套餐，或减少测试次数"
          );
        }
        if (/错误的Key|\[AUTH\]/.test(info)) {
          throw new Error("Server酱：SendKey 无效或未授权，请到 sct.ftqq.com 核对");
        }
        throw new Error(`ServerChan 错误 ${parsed.code}: ${info}`);
      }
    },
  },

  // Server酱³ (ft07.com APP push) — separate user system & keys from Turbo.
  // API: POST https://<uid>.push.ft07.com/send/<sendkey>.send
  // uid is embedded in the key as "sctp<uid>t..." (or provided explicitly).
  serverchan3: {
    type: "serverchan3",
    validateConfig: (c: unknown) => {
      const cfg = c as { sendKey?: unknown; uid?: unknown; tags?: unknown; short?: unknown };
      if (typeof cfg?.sendKey !== "string" || !/^[A-Za-z0-9]{8,80}$/.test(cfg.sendKey.trim())) {
        throw new Error("Server酱³ SendKey 格式无效：应为 sc3.ft07.com/sendkey 页面提供的字母数字串");
      }
      const out: Record<string, string> = { sendKey: cfg.sendKey.trim() };
      let uid = "";
      if (typeof cfg.uid === "string" && /^\d{1,12}$/.test(cfg.uid.trim())) {
        uid = cfg.uid.trim();
      } else {
        const m = out.sendKey.match(/^sctp(\d+)t/);
        if (m) uid = m[1]!;
      }
      if (!uid) {
        throw new Error("无法从 SendKey 提取 uid：请确认 Key 来自 Server酱³（sc3.ft07.com），或额外提供 uid 字段");
      }
      out.uid = uid;
      if (typeof cfg.tags === "string" && cfg.tags.trim()) out.tags = cfg.tags.trim().slice(0, 100);
      if (typeof cfg.short === "string" && cfg.short.trim()) out.short = cfg.short.trim().slice(0, 64);
      return out;
    },
    send: async (_env, config, msg) => {
      // Official params: title|text (required), desp (markdown body), tags (pipe-separated), short.
      const params = new URLSearchParams();
      params.set("title", truncate(msg.title || "死了吗", 64));
      params.set("desp", msg.body.slice(0, 32 * 1024));
      if (config.tags) params.set("tags", config.tags);
      if (config.short) params.set("short", truncate(config.short, 64));

      const resp = await httpSend(`https://${config.uid}.push.ft07.com/send/${encodeURIComponent(config.sendKey)}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const text = await resp.text();

      if (!resp.ok) {
        throw new Error(`Server酱³ HTTP ${resp.status}: ${truncate(text.replace(/\s+/g, " "), 200)}`);
      }
      let parsed: { code?: number; message?: string; info?: string; error?: string };
      try {
        parsed = JSON.parse(text);
      } catch {
        return; // non-JSON 2xx body: accept
      }
      if (typeof parsed.code === "number" && parsed.code !== 0 && parsed.code !== 200) {
        const info = parsed.message || parsed.info || parsed.error || "推送失败";
        if (/错误的?Key|\[AUTH\]/i.test(info)) {
          throw new Error("Server酱³：SendKey 无效，请到 sc3.ft07.com/sendkey 核对");
        }
        throw new Error(`Server酱³ 错误 ${parsed.code}: ${info}`);
      }
    },
  },

  webhook: {
    type: "webhook",
    validateConfig: (c: unknown) => {
      const cfg = c as { url?: unknown; method?: unknown; headers?: unknown; template?: unknown };
      if (typeof cfg?.url !== "string" || !cfg.url.trim()) throw new Error("Webhook URL required");
      const method = typeof cfg.method === "string" && ["POST", "PUT"].includes(cfg.method.toUpperCase())
        ? cfg.method.toUpperCase()
        : "POST";
      let headers = "{}";
      if (cfg.headers != null) {
        if (typeof cfg.headers !== "object") throw new Error("Webhook headers must be a JSON object");
        headers = JSON.stringify(Object.fromEntries(Object.entries(cfg.headers as object).map(([k, v]) => [k, String(v)])));
      }
      return { url: safeUrl(cfg.url).toString(), method, headers };
    },
    send: async (_env, config, msg) => {
      let extraHeaders: Record<string, string> = {};
      try {
        extraHeaders = JSON.parse(config.headers || "{}");
      } catch {
        throw new Error("Webhook headers must be valid JSON");
      }
      // Payload is always JSON: drop headers that would corrupt or spoof the
      // request framing (content-type/content-length/host).
      const FORBIDDEN = /^(content-type|content-length|host)$/i;
      const merged: Record<string, string> = {};
      for (const [k, v] of Object.entries(extraHeaders)) {
        if (!FORBIDDEN.test(k)) merged[k] = v;
      }
      merged["Content-Type"] = "application/json";
      const payload: Record<string, unknown> = {
        title: msg.title,
        body: msg.body,
        imageUrl: msg.imageUrl ?? null,
        time: new Date().toISOString(),
      };
      assertSafeUrl(config.url);
      const resp = await httpSend(config.url, {
        method: config.method,
        headers: merged,
        body: JSON.stringify(payload),
      });
      requireOk(resp, "Webhook");
    },
  },
};

export async function sendToChannel(
  env: Bindings,
  channelType: ChannelType,
  configJsonOrObj: string | Record<string, string>,
  msg: Message
): Promise<void> {
  const adapter = adapters[channelType];
  if (!adapter) throw new Error(`Unsupported channel: ${channelType}`);
  const raw = typeof configJsonOrObj === "string" ? JSON.parse(configJsonOrObj) : configJsonOrObj;
  const validated = adapter.validateConfig(raw);
  await adapter.send(env, validated, msg);
}

