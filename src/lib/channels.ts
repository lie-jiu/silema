export type ChannelType =
  | "email"
  | "telegram"
  | "bark"
  | "ntfy"
  | "serverchan"
  | "serverchan3"
  | "webhook";

export type FieldDef = {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  hint?: string;
  kind?: "text" | "url" | "numeric" | "multiline" | "email";
};

export const CHANNELS: Record<ChannelType, { name: string; fields: FieldDef[] }> = {
  email: {
    name: "邮件（Resend）",
    fields: [
      {
        key: "to",
        label: "收件地址",
        kind: "email",
        hint: "发件地址与 API Key 是部署级 Secret（EMAIL_FROM / EMAIL_API_KEY），不在这里填",
      },
    ],
  },
  telegram: {
    name: "Telegram",
    fields: [
      { key: "botToken", label: "Bot Token", secret: true, hint: "123456:ABC-DEF…" },
      { key: "chatId", label: "Chat ID", kind: "numeric" },
    ],
  },
  bark: {
    name: "Bark（iPhone）",
    fields: [
      { key: "url", label: "服务器地址", kind: "url", optional: true, hint: "留空 = https://api.day.app" },
      { key: "key", label: "设备 Key", secret: true },
    ],
  },
  ntfy: {
    name: "ntfy",
    fields: [
      { key: "url", label: "服务器地址", kind: "url", optional: true, hint: "留空 = https://ntfy.sh" },
      { key: "topic", label: "Topic", secret: true },
      { key: "token", label: "Access Token", secret: true, optional: true },
    ],
  },
  serverchan: {
    name: "Server酱·Turbo",
    fields: [{ key: "sendKey", label: "SendKey", secret: true, hint: "SCT…" }],
  },
  serverchan3: {
    name: "Server酱³",
    fields: [{ key: "sendKey", label: "SendKey", secret: true, hint: "sctp…" }],
  },
  webhook: {
    name: "自定义 Webhook",
    fields: [
      { key: "url", label: "回调地址", kind: "url", hint: "POST JSON {title, body}" },
      { key: "token", label: "Bearer Token", secret: true, optional: true },
    ],
  },
};

export const CHANNEL_TYPES = Object.keys(CHANNELS) as ChannelType[];

export function isChannelType(v: string): v is ChannelType {
  return v in CHANNELS;
}

export function secretKeys(type: ChannelType): string[] {
  return CHANNELS[type].fields.filter((f) => f.secret).map((f) => f.key);
}

/** 掩码只保留末 4 位；这个串同时是「保持原值」的哨兵（docs/backend.md §5）。 */
export function maskValue(value: string): string {
  if (!value) return "";
  const tail = value.slice(-4);
  return `****${tail}`;
}

export function maskConfig(type: ChannelType, config: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of CHANNELS[type].fields) {
    const raw = String(config[f.key] ?? "");
    out[f.key] = f.secret ? maskValue(raw) : raw;
  }
  return out;
}

/**
 * 掩码哨兵：字段缺省、或值等于 GET 返回的那串掩码 = 保留原值。
 * 缺了这条，后台表单一次正常提交就会把 botToken 写成 `****abcd`，此后所有发送静默失败。
 */
export function mergeConfig(
  type: ChannelType,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of CHANNELS[type].fields) {
    const prev = String(existing?.[f.key] ?? "");
    const next = incoming?.[f.key];
    const value = next == null ? "" : String(next).trim();
    const keepPrev = value === "" || (f.secret === true && value === maskValue(prev));
    out[f.key] = keepPrev ? prev : value;
  }
  return out;
}

export function validateConfig(type: ChannelType, config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const f of CHANNELS[type].fields) {
    const value = String(config?.[f.key] ?? "").trim();
    if (!f.optional && !value) errors.push(`${f.label} 不能为空`);
    if (f.kind === "url" && value && !/^https?:\/\//i.test(value)) errors.push(`${f.label} 必须是 http(s) 地址`);
    if (f.kind === "numeric" && value && !/^[0-9:.-]+$/.test(value)) errors.push(`${f.label} 只能是数字`);
    // 收件地址写错的代价是当日链接静默发不出去 → 连吃 3 天提醒后误锁死，所以入库前就拦。
    if (f.kind === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.push(`${f.label} 不是合法邮箱地址`);
    }
  }
  return errors;
}

/** webhook 不得指向本站或内网：前者会形成自激循环，后者是 SSRF（docs/backend.md §7）。 */
export function unsafeWebhookUrl(raw: string, siteUrl: string): string | null {
  let url: URL;
  let site: URL;
  try {
    url = new URL(raw);
    site = new URL(siteUrl);
  } catch {
    return "回调地址不是合法 URL";
  }
  if (url.hostname.toLowerCase() === site.hostname.toLowerCase()) {
    return "不能把通知发回本站，会造成自激循环";
  }
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1)/i.test(url.hostname)) {
    return "回调地址不能指向内网或环回地址";
  }
  return null;
}
