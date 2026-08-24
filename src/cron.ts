import type { Bindings, ChannelType, Message } from "./types";
import { sendToChannel } from "./adapters";
import { splitMessage } from "./recipients";
import { formatFullInTz } from "./time";

const RETRY_INTERVAL_SEC = 10 * 60;
const MAX_ATTEMPTS = 3;

/* Built-in fallbacks for legacy rows created before per-recipient content
 * existed (their *_content columns are empty). */
export const DEFAULT_WARNING_TITLE = "⚠️ 死了吗 — 你还好吗";
export const DEFAULT_WARNING_BODY =
  "你已超过签到时限未签到。若在 {deadline} 之前仍未确认，系统将向所有订阅者发送你的预设消息。\n\n请立即登录并签到以解除警报。";
export const DEFAULT_TRIGGER_TITLE = "死了吗：主人失联了";
export const DEFAULT_TRIGGER_BODY = "所有者已超过设定时限未签到。这是系统自动发出的预设消息。";

// Replace {placeholder} tokens; unknown names are left untouched so typos
// stay visible instead of silently vanishing from the message.
function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k]! : m));
}

export async function handleCron(env: Bindings): Promise<void> {
  await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
    .bind(Math.floor(Date.now() / 1000) - 86400)
    .run();

  const owner = await env.DB.prepare(
    "SELECT * FROM owner WHERE id = 1"
  ).first<{
    id: number;
    timezone: string;
    expiry_hours: number;
    warning_hours: number;
    state: string;
    last_checkin_at: number | null;
    warning_sent_at: number | null;
    triggered_at: number | null;
  }>();
  if (!owner) return;

  const now = Math.floor(Date.now() / 1000);

  switch (owner.state as string) {
    case "normal": {
      if (!owner.last_checkin_at) break;
      const hoursSinceCheckin = (now - (owner.last_checkin_at as number)) / 3600;
      if (hoursSinceCheckin > owner.expiry_hours) {
        await env.DB.prepare(
          "UPDATE owner SET state = 'warning', warning_sent_at = ? WHERE id = 1"
        ).bind(now).run();
        await sendWarningToOwner(env, { ...owner, warning_sent_at: now } as typeof owner);
      }
      break;
    }

    case "warning": {
      if (!owner.warning_sent_at) break;
      const hoursSinceWarning = (now - (owner.warning_sent_at as number)) / 3600;
      if (hoursSinceWarning > owner.warning_hours) {
        await env.DB.prepare(
          "UPDATE owner SET state = 'triggered', triggered_at = ? WHERE id = 1"
        ).bind(now).run();

        const { results: recipients } = await env.DB.prepare(
          "SELECT id FROM recipients WHERE on_trigger = 1"
        ).all<{ id: number }>();

        for (const rcpt of recipients) {
          await env.DB.prepare(
            "INSERT INTO deliveries (recipient_id, status, attempts, created_at) VALUES (?, 'pending', 0, ?)"
          ).bind(rcpt.id, now).run();
        }

        await processDeliveries(env, owner.timezone);
      }
      break;
    }

    case "triggered": {
      await processDeliveries(env, owner.timezone);
      break;
    }
  }
}

async function processDeliveries(env: Bindings, tz: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const { results: due } = await env.DB.prepare(
    `SELECT d.id, d.recipient_id, r.channel_type, r.config_json, r.trigger_content
     FROM deliveries d
     JOIN recipients r ON d.recipient_id = r.id
     WHERE d.status = 'pending'
       AND d.attempts < ?
       AND (d.last_attempt_at IS NULL OR d.last_attempt_at < ?)`,
  ).bind(MAX_ATTEMPTS, now - RETRY_INTERVAL_SEC).all<{
    id: number;
    recipient_id: number;
    channel_type: ChannelType;
    config_json: string;
    trigger_content: string;
  }>();

  if (due.length === 0) return;

  // Atomically claim each pending delivery before sending so concurrent
  // invocations (scheduled trigger + manual POST /__cron) never deliver the
  // same message twice. The claim already bumps attempts/last_attempt_at.
  const claimed: typeof due = [];
  for (const delivery of due) {
    const res = await env.DB.prepare(
      `UPDATE deliveries SET attempts = attempts + 1, last_attempt_at = ?
       WHERE id = ? AND status = 'pending'
         AND attempts < ? AND (last_attempt_at IS NULL OR last_attempt_at < ?)`
    ).bind(now, delivery.id, MAX_ATTEMPTS, now - RETRY_INTERVAL_SEC).run();
    if ((res.meta.changes ?? 0) > 0) claimed.push(delivery);
  }
  if (claimed.length === 0) return;

  const results = await Promise.allSettled(
    claimed.map(async (delivery) => {
      const sentAt = formatFullInTz(now, tz) + `（${tz}）`;
      // Each recipient gets THEIR OWN trigger text; legacy empty content
      // falls back to the built-in default.
      const m = splitMessage(delivery.trigger_content?.trim() || DEFAULT_TRIGGER_BODY);
      const msg: Message = {
        title: fillTemplate(m.title || DEFAULT_TRIGGER_TITLE, { time: sentAt }),
        body: fillTemplate(m.body, { time: sentAt }),
      };
      await sendToChannel(env, delivery.channel_type, delivery.config_json, msg);
    })
  );

  for (let i = 0; i < claimed.length; i++) {
    const delivery = claimed[i]!;
    const outcome = results[i]!;
    if (outcome.status === "fulfilled") {
      await env.DB.prepare(
        "UPDATE deliveries SET status = 'sent', sent_at = ? WHERE id = ?"
      ).bind(now, delivery.id).run();
    } else {
      await recordFailure(env, delivery.id, String(outcome.reason?.message || outcome.reason));
      console.error(`[cron] delivery ${delivery.id} failed:`, outcome.reason);
    }
  }
}

// Attempts were already incremented by the claim; only persist the error and
// flip to failed once the retry budget is exhausted.
async function recordFailure(env: Bindings, id: number, error: string): Promise<void> {
  const row = await env.DB.prepare("SELECT attempts FROM deliveries WHERE id = ?").bind(id).first<{ attempts: number }>();
  const exhausted = (row?.attempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS;
  await env.DB.prepare(
    "UPDATE deliveries SET last_error = ?, status = CASE WHEN ? THEN 'failed' ELSE status END WHERE id = ?"
  ).bind(error.slice(0, 500), exhausted ? 1 : 0, id).run();
}

export async function sendWarningToOwner(env: Bindings, owner: Record<string, unknown>): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const warningSentAt = Number(owner.warning_sent_at ?? now);
  const triggerAt = warningSentAt + Number(owner.warning_hours) * 3600;
  const tz = String(owner.timezone || "UTC");
  const deadline = `${formatFullInTz(triggerAt, tz)}（${tz}）`;

  // Each subscribed recipient gets THEIR OWN warning text.
  const { results: channels } = await env.DB.prepare(
    "SELECT label, channel_type, config_json, warning_content FROM recipients WHERE on_warning = 1"
  ).all<{ label: string; channel_type: ChannelType; config_json: string; warning_content: string }>();

  if (channels.length === 0) {
    console.warn("[cron] WARNING state entered but no recipients subscribed to warnings — cannot notify owner");
    return;
  }

  const outcomes = await Promise.allSettled(
    channels.map(async (ch) => {
      const m = splitMessage(ch.warning_content?.trim() || DEFAULT_WARNING_BODY);
      const msg: Message = {
        title: fillTemplate(m.title || DEFAULT_WARNING_TITLE, { deadline }),
        body: fillTemplate(m.body, { deadline }),
      };
      return sendToChannel(env, ch.channel_type, ch.config_json, msg);
    })
  );
  outcomes.forEach((o, i) => {
    if (o.status === "rejected") {
      console.error(`[cron] owner warning failed on ${channels[i]!.channel_type}:`, o.reason);
    }
  });
}

export async function handleReset(env: Bindings): Promise<{ success: boolean; error?: string }> {
  const owner = await env.DB.prepare("SELECT state FROM owner WHERE id = 1").first<{ state: string }>();
  if (!owner) return { success: false, error: "No owner configured" };
  if (owner.state === "normal") return { success: false, error: "Already in normal state" };

  // Cancel any undelivered messages from the aborted cycle.
  await env.DB.prepare("DELETE FROM deliveries WHERE status != 'sent'").run();
  await env.DB.prepare(
    "UPDATE owner SET state = 'normal', warning_sent_at = NULL, triggered_at = NULL WHERE id = 1"
  ).run();

  return { success: true };
}
