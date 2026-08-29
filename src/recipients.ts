import { Hono } from "hono";
import { adapters, sendToChannel } from "./adapters";
import { buildMessage, buildVars, DEFAULT_TRIGGER_TITLE, DEFAULT_WARNING_TITLE } from "./messages";
import { rateLimit, clientIp } from "./ratelimit";
import { issueCheckinToken } from "./token";
import { formatFullInTz } from "./time";
import { VALID_CHANNELS, type ChannelType, type Message } from "./types";
import type { AuthEnv } from "./guard";

// Admin-managed notification recipients. Content is PER RECIPIENT:
//   warning_content → sent to them when the warning starts
//   trigger_content → sent to them when the warning ends unconfirmed
// First line of each content acts as the message title.
const MAX_CONTENT_LEN = 10000;

// 测试消息里的签到链接：够验证链接能点通，又不至于留一条长期有效的
// 签到入口在别人的收件箱里。
const TEST_LINK_TTL_SEC = 3600;

/* Channel credentials are write-only: the admin UI only needs to recognise a
 * channel, never read its secrets back. Masking happens server-side — doing it
 * in the browser would be pointless, since the plaintext has already arrived. */
const SECRET_CONFIG_KEYS = new Set(["botToken", "sendKey", "key"]);
const SECRET_HEADER_KEYS = /(authorization|auth|token|secret|key|signature|bearer|password|cookie)/i;

function maskValue(v: string): string {
  return v.length <= 4 ? "••••" : v.slice(0, 3) + "••••" + v.slice(-2);
}

// Returns a masked copy of the stored config JSON. Topic / server / url / email
// / chatId stay readable — the admin has to recognise and re-enter them anyway.
export function maskConfigJson(raw: string): string {
  let cfg: unknown;
  try {
    cfg = JSON.parse(raw);
  } catch {
    return "{}";
  }
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) return "{}";
  const out = cfg as Record<string, unknown>;

  for (const k of Object.keys(out)) {
    if (SECRET_CONFIG_KEYS.has(k) && typeof out[k] === "string") {
      out[k] = maskValue(out[k] as string);
    }
  }
  // Webhook stores extra headers as a JSON string; mask credential-looking ones.
  if (typeof out.headers === "string") {
    try {
      const h = JSON.parse(out.headers) as Record<string, unknown>;
      for (const k of Object.keys(h)) {
        if (SECRET_HEADER_KEYS.test(k) && typeof h[k] === "string") h[k] = maskValue(h[k] as string);
      }
      out.headers = JSON.stringify(h);
    } catch {
      /* keep the stored string as-is */
    }
  }
  return JSON.stringify(out);
}

const recipients = new Hono<AuthEnv>();

// Returns an error string when a checked event lacks its content.
function validateContents(
  onWarning: boolean,
  warningContent: string,
  onTrigger: boolean,
  triggerContent: string
): string | null {
  if (!onWarning && !onTrigger) return "接收人至少需要订阅一种通知（警告开始或警告结束）";
  if (onWarning && !warningContent.trim()) return "勾选了「警告开始」，必须填写对应的通知内容";
  if (onWarning && warningContent.length > MAX_CONTENT_LEN)
    return `警告开始内容过长（上限 ${MAX_CONTENT_LEN} 字符）`;
  if (onTrigger && !triggerContent.trim()) return "勾选了「警告结束」，必须填写对应的通知内容";
  if (onTrigger && triggerContent.length > MAX_CONTENT_LEN)
    return `警告结束内容过长（上限 ${MAX_CONTENT_LEN} 字符）`;
  return null;
}

// GET /api/recipients
recipients.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, label, channel_type, config_json, on_warning, on_trigger,
            warning_content, trigger_content, created_at
     FROM recipients ORDER BY created_at DESC`
  ).all<{
    id: number;
    label: string;
    channel_type: ChannelType;
    config_json: string;
    on_warning: number;
    on_trigger: number;
    warning_content: string;
    trigger_content: string;
    created_at: number;
  }>();

  // Never ship bot tokens / send keys / webhook auth headers to the browser.
  const masked = results.map((r) => ({ ...r, config_json: maskConfigJson(r.config_json) }));
  return c.json({ recipients: masked });
});

// POST /api/recipients — add a recipient (content required per checked event)
recipients.post("/", async (c) => {
  const body = await c.req.json<{
    label?: string;
    channelType?: string;
    config?: unknown;
    onWarning?: boolean;
    onTrigger?: boolean;
    warningContent?: string;
    triggerContent?: string;
  }>();

  if (!body.channelType || !VALID_CHANNELS.includes(body.channelType as ChannelType)) {
    return c.json({ error: "Invalid channel type" }, 400);
  }

  let normalized: Record<string, string>;
  try {
    normalized = adapters[body.channelType as ChannelType].validateConfig(body.config);
  } catch (err) {
    return c.json({ error: `Invalid config: ${(err as Error).message}` }, 400);
  }

  const label = typeof body.label === "string" ? body.label.trim().slice(0, 50) : "";
  const onWarning = body.onWarning ? 1 : 0;
  const onTrigger = body.onTrigger === false ? 0 : 1;
  const warningContent = typeof body.warningContent === "string" ? body.warningContent : "";
  const triggerContent = typeof body.triggerContent === "string" ? body.triggerContent : "";

  const invalid = validateContents(!!onWarning, warningContent, !!onTrigger, triggerContent);
  if (invalid) return c.json({ error: invalid }, 400);

  await c.env.DB.prepare(
    `INSERT INTO recipients
       (label, channel_type, config_json, on_warning, on_trigger, warning_content, trigger_content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      label,
      body.channelType,
      JSON.stringify(normalized),
      onWarning,
      onTrigger,
      warningContent,
      triggerContent,
      Math.floor(Date.now() / 1000)
    )
    .run();

  return c.json({ message: "Recipient added" });
});

// PUT /api/recipients/:id — update toggles, label, config and/or contents
recipients.put("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT id, label, channel_type, config_json, on_warning, on_trigger,
            warning_content, trigger_content
     FROM recipients WHERE id = ?`
  )
    .bind(id)
    .first<{
      id: number;
      label: string;
      channel_type: string;
      config_json: string;
      on_warning: number;
      on_trigger: number;
      warning_content: string;
      trigger_content: string;
    }>();
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<{
    label?: string;
    config?: unknown;
    onWarning?: boolean;
    onTrigger?: boolean;
    warningContent?: string;
    triggerContent?: string;
  }>();

  let label = existing.label;
  if (typeof body.label === "string") label = body.label.trim().slice(0, 50);

  let configJson = existing.config_json;
  if (body.config !== undefined) {
    try {
      const normalized = adapters[existing.channel_type as ChannelType].validateConfig(body.config);
      configJson = JSON.stringify(normalized);
    } catch (err) {
      return c.json({ error: `Invalid config: ${(err as Error).message}` }, 400);
    }
  }

  const onWarning = typeof body.onWarning === "boolean" ? (body.onWarning ? 1 : 0) : existing.on_warning;
  const onTrigger = typeof body.onTrigger === "boolean" ? (body.onTrigger ? 1 : 0) : existing.on_trigger;

  const warningContent =
    typeof body.warningContent === "string" ? body.warningContent : existing.warning_content ?? "";
  const triggerContent =
    typeof body.triggerContent === "string" ? body.triggerContent : existing.trigger_content ?? "";

  const invalid = validateContents(!!onWarning, warningContent, !!onTrigger, triggerContent);
  if (invalid) return c.json({ error: invalid }, 400);

  await c.env.DB.prepare(
    `UPDATE recipients SET label = ?, config_json = ?, on_warning = ?, on_trigger = ?,
            warning_content = ?, trigger_content = ? WHERE id = ?`
  )
    .bind(label, configJson, onWarning, onTrigger, warningContent, triggerContent, id)
    .run();

  return c.json({ message: "Recipient updated" });
});

// DELETE /api/recipients/:id
recipients.delete("/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);

  // Also cancel any undelivered messages queued for this recipient.
  // 同样是取消而非删除：接收人删掉后，他此前失败过的投递记录仍应可回溯。
  await c.env.DB.prepare(
    "UPDATE deliveries SET status = 'cancelled' WHERE recipient_id = ? AND status = 'pending'"
  ).bind(id).run();
  const result = await c.env.DB.prepare("DELETE FROM recipients WHERE id = ?").bind(id).run();
  if ((result.meta.changes ?? 0) === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ message: "Recipient removed" });
});

// POST /api/recipients/:id/test — push THIS recipient's real configured texts
// through their channel (one message per subscribed event, prefixed [测试]).
recipients.post("/:id/test", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isInteger(id)) return c.json({ error: "Invalid id" }, 400);

  // Every test push spends real channel quota (Server酱 allows 5/day), so cap
  // it per client rather than per recipient.
  const allowed = await rateLimit(c.env, `rtest:${clientIp(c.req.raw.headers)}`, 20, 3600);
  if (!allowed) return c.json({ error: "测试发送过于频繁，请稍后再试" }, 429);

  const row = await c.env.DB.prepare(
    `SELECT label, channel_type, config_json, on_warning, on_trigger,
            warning_content, trigger_content
     FROM recipients WHERE id = ?`
  )
    .bind(id)
    .first<{
      label: string;
      channel_type: ChannelType;
      config_json: string;
      on_warning: number;
      on_trigger: number;
      warning_content: string;
      trigger_content: string;
    }>();
  if (!row) return c.json({ error: "Not found" }, 404);

  // 测试消息走的是和真实告警完全相同的变量表，唯一的差别是值：时间用示例
  // 值，签到链接则发一条真实可用的短时效令牌 —— 只有点得通，才算验证了链路。
  const owner = await c.env.DB.prepare(
    "SELECT timezone, expiry_hours, warning_hours, last_checkin_at FROM owner WHERE id = 1"
  ).first<{
    timezone: string;
    expiry_hours: number;
    warning_hours: number;
    last_checkin_at: number | null;
  }>();

  const now = Math.floor(Date.now() / 1000);
  const tz = owner?.timezone || "UTC";
  const site = (c.env.APP_BASE_URL || "").replace(/\/+$/, "");
  const stamp = (t: number) => `${formatFullInTz(t, tz)}（${tz}）`;
  const sample = `示例值（${stamp(now)}）`;

  const base = {
    tz,
    site,
    lastCheckin: owner?.last_checkin_at ? stamp(owner.last_checkin_at) : "尚无记录",
    hours:
      owner?.last_checkin_at != null
        ? String(Math.round((Math.max(0, now - owner.last_checkin_at) / 3600) * 10) / 10)
        : "",
    expiryHours: owner?.expiry_hours,
    warningHours: owner?.warning_hours,
    label: row.label,
  };

  const messages: Message[] = [];
  // 一次测试只生成一条链接，警告与触发两条消息共用 —— 与正式链路保持一致，
  // 免得测试里各发一条、跟线上行为对不上。
  const testUrl =
    (await issueCheckinToken(c.env, {
      purpose: "test",
      ttlSec: TEST_LINK_TTL_SEC,
      cycle: now,
    })) ?? "";
  if (row.on_warning && row.warning_content.trim()) {
    const m = buildMessage(
      row.warning_content,
      { title: DEFAULT_WARNING_TITLE, body: "" },
      buildVars({ purpose: "warning", ...base, checkinUrl: testUrl, deadline: sample })
    );
    messages.push({ title: "[测试] " + (m.title ?? DEFAULT_WARNING_TITLE), body: m.body });
  }
  if (row.on_trigger && row.trigger_content.trim()) {
    const m = buildMessage(
      row.trigger_content,
      { title: DEFAULT_TRIGGER_TITLE, body: "" },
      buildVars({ purpose: "trigger", ...base, checkinUrl: testUrl, time: sample })
    );
    messages.push({ title: "[测试] " + (m.title ?? DEFAULT_TRIGGER_TITLE), body: m.body });
  }
  if (messages.length === 0) {
    return c.json({ error: "该接收人没有可发送的内容：请先勾选事件并填写对应内容" }, 400);
  }

  try {
    for (const msg of messages) {
      await sendToChannel(c.env, row.channel_type, row.config_json, msg);
    }
  } catch (err) {
    return c.json({ error: `Send failed: ${(err as Error).message}` }, 502);
  }
  return c.json({ message: `已发送 ${messages.length} 条测试消息` });
});

export default recipients;
