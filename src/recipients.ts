import { Hono } from "hono";
import { adapters, sendToChannel } from "./adapters";
import { VALID_CHANNELS, type ChannelType, type Message } from "./types";
import type { AuthEnv } from "./guard";

// Admin-managed notification recipients. Content is PER RECIPIENT:
//   warning_content → sent to them when the warning starts
//   trigger_content → sent to them when the warning ends unconfirmed
// First line of each content acts as the message title.
const MAX_CONTENT_LEN = 10000;

interface SplitMsg {
  title?: string;
  body: string;
}

// First line = title, remainder = body. A single-line text is used as both.
export function splitMessage(content: string): SplitMsg {
  const idx = content.indexOf("\n");
  if (idx === -1) return { body: content };
  const first = content.slice(0, idx).trim();
  const rest = content.slice(idx + 1).trim();
  return first ? { title: first, body: rest || first } : { body: rest };
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
  ).all();
  return c.json({ recipients: results });
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
  await c.env.DB.prepare("DELETE FROM deliveries WHERE recipient_id = ? AND status != 'sent'").bind(id).run();
  const result = await c.env.DB.prepare("DELETE FROM recipients WHERE id = ?").bind(id).run();
  if ((result.meta.changes ?? 0) === 0) return c.json({ error: "Not found" }, 404);
  return c.json({ message: "Recipient removed" });
});

// POST /api/recipients/:id/test — push THIS recipient's real configured texts
// through their channel (one message per subscribed event, prefixed [测试]).
recipients.post("/:id/test", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
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

  const tzOffset = -new Date().getTimezoneOffset() / 60;
  const sampleTime = `2026-01-01 12:00（UTC${tzOffset >= 0 ? "+" : ""}${tzOffset} 示例）`;
  const messages: Message[] = [];
  if (row.on_warning && row.warning_content.trim()) {
    const m = splitMessage(row.warning_content);
    messages.push({
      title: "[测试] " + (m.title ?? ""),
      body: m.body.replace(/\{deadline\}/g, sampleTime),
    });
  }
  if (row.on_trigger && row.trigger_content.trim()) {
    const m = splitMessage(row.trigger_content);
    messages.push({
      title: "[测试] " + (m.title ?? ""),
      body: m.body.replace(/\{time\}/g, sampleTime),
    });
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
