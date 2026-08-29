import type { Bindings, ChannelType } from "./types";
import { sendToChannel } from "./adapters";
import {
  buildMessage,
  DEFAULT_TRIGGER_BODY,
  DEFAULT_TRIGGER_TITLE,
  DEFAULT_WARNING_BODY,
  DEFAULT_WARNING_TITLE,
} from "./messages";
import { buildVars } from "./messages";
import { formatFullInTz } from "./time";
import { getOrIssueSharedToken, purgeExpiredTokens } from "./token";

const RETRY_INTERVAL_SEC = 10 * 60;
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_RETENTION_SEC = 86400;
// 投递表现在同时是审计日志，不能无限增长：只清理已终结（非排队中）的旧行。
const DELIVERY_RETENTION_SEC = 90 * 86400;

// 警告链接要活过整个警告窗口，再多留 6 小时余量：所有者可能在截止前
// 几分钟才看到邮件，链接不该恰好在那时候失效。
const WARNING_LINK_GRACE_SEC = 6 * 3600;
// 触发之后没有「警告窗口」这个概念了，给接收人一个宽松但有限的期限。
const TRIGGER_LINK_TTL_SEC = 7 * 86400;

interface OwnerStateRow {
  id: number;
  timezone: string;
  expiry_hours: number;
  warning_hours: number;
  state: string;
  last_checkin_at: number | null;
  warning_sent_at: number | null;
  triggered_at: number | null;
}

/**
 * 所有消息共用的变量基座：签到链接之外的字段只跟 owner 有关，与发给谁无关。
 * 抽出来是为了让警告和群发两条链路的时间口径完全一致 —— 一个用所有者
 * 时区、另一个用 UTC 之类的偏差，在真出事时会直接误导接收人。
 */
function baseContext(owner: OwnerStateRow, site: string, now: number) {
  const tz = owner.timezone || "UTC";
  const hours =
    owner.last_checkin_at != null
      ? String(Math.round((Math.max(0, now - owner.last_checkin_at) / 3600) * 10) / 10)
      : "";
  return {
    tz,
    site,
    lastCheckin: owner.last_checkin_at
      ? `${formatFullInTz(owner.last_checkin_at, tz)}（${tz}）`
      : "尚无记录",
    hours,
    expiryHours: owner.expiry_hours,
    warningHours: owner.warning_hours,
  };
}

export async function handleCron(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // Housekeeping once per hour rather than on every 5-minute tick — the
  // rate limiter already cleans up opportunistically on 5% of requests.
  if (now % 3600 < 300) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
        .bind(now - RATE_LIMIT_RETENTION_SEC),
      env.DB.prepare("DELETE FROM deliveries WHERE status != 'pending' AND created_at < ?")
        .bind(now - DELIVERY_RETENTION_SEC),
    ]);
    await purgeExpiredTokens(env, now);
  }

  const owner = await env.DB.prepare(
    "SELECT * FROM owner WHERE id = 1"
  ).first<OwnerStateRow>();
  if (!owner) return;

  switch (owner.state as string) {
    case "normal": {
      if (!owner.last_checkin_at) break;
      if ((now - (owner.last_checkin_at as number)) / 3600 <= owner.expiry_hours) break;

      // Conditional UPDATE: when a concurrent invocation already advanced the
      // state, changes is 0 and we must not send a second warning.
      const res = await env.DB.prepare(
        "UPDATE owner SET state = 'warning', warning_sent_at = ? WHERE id = 1 AND state = 'normal'"
      ).bind(now).run();
      if ((res.meta.changes ?? 0) === 0) break;

      await sendWarningToOwner(env, { ...owner, state: "warning", warning_sent_at: now });
      break;
    }

    case "warning": {
      if (!owner.warning_sent_at) break;
      if ((now - (owner.warning_sent_at as number)) / 3600 <= owner.warning_hours) break;

      const res = await env.DB.prepare(
        "UPDATE owner SET state = 'triggered', triggered_at = ? WHERE id = 1 AND state = 'warning'"
      ).bind(now).run();
      if ((res.meta.changes ?? 0) === 0) break;

      const { results: recipients } = await env.DB.prepare(
        "SELECT id FROM recipients WHERE on_trigger = 1"
      ).all<{ id: number }>();

      if (recipients.length > 0) {
        // cycle = triggered_at identifies this broadcast. INSERT OR IGNORE plus
        // the unique index makes a racing second invocation a no-op instead of
        // a duplicate message.
        await env.DB.batch(
          recipients.map((rcpt) =>
            env.DB.prepare(
              "INSERT OR IGNORE INTO deliveries (recipient_id, cycle, status, attempts, created_at) VALUES (?, ?, 'pending', 0, ?)"
            ).bind(rcpt.id, now, now)
          )
        );
      }

      await processDeliveries(env, owner);
      break;
    }

    case "triggered": {
      await processDeliveries(env, owner);
      break;
    }
  }
}

async function processDeliveries(env: Bindings, owner: OwnerStateRow): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const tz = owner.timezone || "UTC";
  const site = (env.APP_BASE_URL || "").replace(/\/+$/, "");

  const { results: due } = await env.DB.prepare(
    `SELECT d.id, d.cycle, d.recipient_id, r.label, r.channel_type, r.config_json, r.trigger_content
     FROM deliveries d
     JOIN recipients r ON d.recipient_id = r.id
     WHERE d.status = 'pending'
       AND d.purpose = 'trigger'
       AND d.attempts < ?
       AND (d.last_attempt_at IS NULL OR d.last_attempt_at < ?)`,
  ).bind(MAX_ATTEMPTS, now - RETRY_INTERVAL_SEC).all<{
    id: number;
    cycle: number;
    recipient_id: number;
    label: string;
    channel_type: ChannelType;
    config_json: string;
    trigger_content: string;
  }>();

  if (due.length === 0) return;

  // Atomically claim each pending delivery before sending so concurrent
  // invocations (scheduled trigger + manual POST /__cron) never deliver the
  // same message twice. The claim already bumps attempts/last_attempt_at.
  const claims = await env.DB.batch(
    due.map((delivery) =>
      env.DB.prepare(
        `UPDATE deliveries SET attempts = attempts + 1, last_attempt_at = ?
         WHERE id = ? AND status = 'pending' AND purpose = 'trigger'
           AND attempts < ? AND (last_attempt_at IS NULL OR last_attempt_at < ?)`
      ).bind(now, delivery.id, MAX_ATTEMPTS, now - RETRY_INTERVAL_SEC)
    )
  );
  const claimed = due.filter((_, i) => ((claims[i] as D1Result).meta.changes ?? 0) > 0);
  if (claimed.length === 0) return;

  const sentAt = formatFullInTz(now, tz) + `（${tz}）`;

  // 同一轮触发（cycle）共用一条链接。通常一次只有一个 cycle，但重试可能把上一轮
  // 未发完的行一起捞出来，按 cycle 分组保证同一轮拿到的始终是同一个入口。
  // 缓存的是 Promise 而不是结果：并发调用时若缓存结果，几个请求会同时 miss、
  // 各自造一条令牌；缓存 Promise 才能保证同一 cycle 只查一次库。
  const urlByCycle = new Map<number, Promise<string>>();
  const sharedUrl = (cycle: number): Promise<string> => {
    let pending = urlByCycle.get(cycle);
    if (!pending) {
      pending = getOrIssueSharedToken(env, {
        purpose: "trigger",
        cycle,
        ttlSec: TRIGGER_LINK_TTL_SEC,
      }).then((u) => u ?? "");
      urlByCycle.set(cycle, pending);
    }
    return pending;
  };

  const results = await Promise.allSettled(
    claimed.map(async (delivery) => {
      // Each recipient gets THEIR OWN trigger text; legacy empty content
      // falls back to the built-in default.
      const vars = buildVars({
        purpose: "trigger",
        ...baseContext(owner, site, now),
        checkinUrl: await sharedUrl(delivery.cycle),
        time: sentAt,
        label: delivery.label,
      });
      const msg = buildMessage(
        delivery.trigger_content,
        { title: DEFAULT_TRIGGER_TITLE, body: DEFAULT_TRIGGER_BODY },
        vars
      );
      await sendToChannel(env, delivery.channel_type, delivery.config_json, msg);
    })
  );

  const succeeded: number[] = [];
  const failures: { id: number; reason: unknown }[] = [];
  claimed.forEach((delivery, i) => {
    const outcome = results[i]!;
    if (outcome.status === "fulfilled") succeeded.push(delivery.id);
    else failures.push({ id: delivery.id, reason: outcome.reason });
  });

  if (succeeded.length > 0) {
    await env.DB.batch(
      succeeded.map((id) =>
        env.DB.prepare("UPDATE deliveries SET status = 'sent', sent_at = ? WHERE id = ?").bind(now, id)
      )
    );
  }

  for (const failure of failures) {
    await recordFailure(env, failure.id, String((failure.reason as Error)?.message || failure.reason));
    console.error(`[cron] delivery ${failure.id} failed:`, failure.reason);
  }
}

// Attempts were already incremented by the claim; only persist the error and
// flip to failed once the retry budget is exhausted.
async function recordFailure(env: Bindings, id: number, error: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE deliveries SET last_error = ?, status = CASE WHEN attempts >= ? THEN 'failed' ELSE status END WHERE id = ?"
  ).bind(error.slice(0, 500), MAX_ATTEMPTS, id).run();
}

export async function sendWarningToOwner(env: Bindings, owner: OwnerStateRow): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const warningSentAt = Number(owner.warning_sent_at ?? now);
  const triggerAt = warningSentAt + Number(owner.warning_hours) * 3600;
  const tz = String(owner.timezone || "UTC");
  const deadline = `${formatFullInTz(triggerAt, tz)}（${tz}）`;
  const site = (env.APP_BASE_URL || "").replace(/\/+$/, "");

  // Each subscribed recipient gets THEIR OWN warning text.
  const { results: channels } = await env.DB.prepare(
    "SELECT id, label, channel_type, config_json, warning_content FROM recipients WHERE on_warning = 1"
  ).all<{ id: number; label: string; channel_type: ChannelType; config_json: string; warning_content: string }>();

  if (channels.length === 0) {
    console.warn("[cron] WARNING state entered but no recipients subscribed to warnings — cannot notify owner");
    return;
  }

  // 警告此前直接发送、完全不落库，一旦失败连日志之外什么都不留下 —— 而它是
  // 所有者避免触发的最后机会。现在先入队再发，一次定生死：警告有时效性，不进
  // 重试队列（processDeliveries 只捞 purpose='trigger'），重发只会是过期信息。
  await env.DB.batch(
    channels.map((ch) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO deliveries
           (recipient_id, cycle, purpose, status, attempts, created_at)
         VALUES (?, ?, 'warning', 'pending', 0, ?)`
      ).bind(ch.id, warningSentAt, now)
    )
  );

  // 一次警告只生成一条链接，所有频道共用。此前放在循环里，N 个通道会各发一条
  // 互不相同的链接，而令牌是一次性的 —— 点过其中一条，其余全部变成「已使用」。
  const checkinUrl =
    (await getOrIssueSharedToken(env, {
      purpose: "warning",
      cycle: warningSentAt,
      ttlSec: Number(owner.warning_hours) * 3600 + WARNING_LINK_GRACE_SEC,
    })) ?? "";

  const outcomes = await Promise.allSettled(
    channels.map(async (ch) => {
      const vars = buildVars({
        purpose: "warning",
        ...baseContext(owner, site, now),
        checkinUrl,
        deadline,
        label: ch.label,
      });
      const msg = buildMessage(
        ch.warning_content,
        { title: DEFAULT_WARNING_TITLE, body: DEFAULT_WARNING_BODY },
        vars
      );
      return sendToChannel(env, ch.channel_type, ch.config_json, msg);
    })
  );

  await env.DB.batch(
    channels.map((ch, i) => {
      const outcome = outcomes[i]!;
      const sent = outcome.status === "fulfilled";
      if (!sent) {
        console.error(`[cron] owner warning failed on ${ch.channel_type}:`, outcome.reason);
      }
      const errText = sent
        ? null
        : String(outcome.reason?.message || outcome.reason).slice(0, 500);
      return env.DB.prepare(
        `UPDATE deliveries SET status = ?, attempts = 1, last_attempt_at = ?, sent_at = ?, last_error = ?
         WHERE recipient_id = ? AND cycle = ? AND purpose = 'warning'`
      ).bind(sent ? "sent" : "failed", now, sent ? now : null, errText, ch.id, warningSentAt);
    })
  );
}
