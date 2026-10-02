import { getOwner, setCronHealth, writeWithRetry, type OwnerRow } from "./db";
import { configOf, finalRecipients, promptRecipients, type RecipientRow } from "./recipients";
import { render, type EventType, type TemplateVars } from "./messages";
import { deliverWithRetry, type Env } from "./send";
import { fmtClock } from "./time";
import { ensureRecoveryToken, housekeeping, mintReminder, rollDailyPrompt } from "./tokens";

const GUARD_MS = 12 * 3_600_000;
const BUDGET_MS = 20_000;

/** 连续缺席满 3 个 24:00 判定即锁死；缺席第 1~2 天各发一次未签到提醒。 */
export const LOCK_AT = 3;
/** 最终消息最多送达两条：锁死当次一条 + 次日 12:00 一条，之后彻底静默。 */
export const FINAL_MAX = 2;

export type CronSummary = {
  ran: boolean;
  job: "send" | "judge";
  skipped?: string;
  sent: number;
  failed: number;
  detail: string;
  error: string | null;
};

export function parseCron(expr: string): "send" | "judge" | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour] = parts as [string, string];
  if (minute !== "0") return null;
  if (hour === "4") return "send";
  if (hour === "16") return "judge";
  return null;
}

function checkinUrl(env: Env, token: string): string {
  return `${env.SITE_URL.replace(/\/+$/, "")}/c/${token}`;
}

async function recordJudge(db: D1Database, now: number): Promise<void> {
  await writeWithRetry("last_judge_at", () =>
    db.prepare("UPDATE owner SET last_judge_at = ? WHERE id = 1").bind(now).run(),
  );
}

/**
 * 并发保护：判定写入一律带 `WHERE last_checkin_at IS NULL OR last_checkin_at < :windowStart`。
 * affected rows = 0 说明期间发生了签到，整体放弃本次判定、不发任何消息——否则午夜前后的点击
 * 会被随后落库的判定覆盖成 locked，而最终消息不可撤回（docs/backend.md §2.2 step 5）。
 */
async function conditionalUpdate(db: D1Database, sql: string, params: unknown[], windowStart: number) {
  return writeWithRetry("判定写入", () =>
    db
      .prepare(`${sql} AND (last_checkin_at IS NULL OR last_checkin_at < ?)`)
      .bind(...params, windowStart)
      .run(),
  );
}

async function fanout(
  env: Env,
  rows: RecipientRow[],
  event: EventType,
  varsFor: (row: RecipientRow) => TemplateVars,
): Promise<{ ok: number; failed: number; errors: string[] }> {
  const work = rows.map(async (row) => {
    const vars = varsFor(row);
    const rendered = render(
      event === "prompt" ? row.prompt_content : event === "reminder" ? row.reminder_content : row.final_content,
      event,
      vars,
    );
    // `{checkin_url}` 取不到 → 这条不发送（不回退站点地址），由调用方记 cron error
    if (!rendered) return { ok: false, detail: "缺少签到链接，已跳过该条" };
    return deliverWithRetry(env, row.channel_type, configOf(row), rendered.title, rendered.body);
  });

  const settled = await Promise.race([
    Promise.allSettled(work),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), BUDGET_MS)),
  ]);

  if (settled === "timeout") {
    return { ok: 0, failed: rows.length, errors: [`超出 ${BUDGET_MS / 1000}s 时间预算，按失败计`] };
  }
  const errors: string[] = [];
  let ok = 0;
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value.ok) ok++;
    else errors.push(r.status === "fulfilled" ? r.value.detail : String(r.reason));
  }
  return { ok, failed: rows.length - ok, errors };
}

/**
 * 投递一条最终消息。锁死当次与次日 12:00 的那一条共用同一份模板与同一条 7 天恢复链接，
 * 只有至少一个通道成功才落时间戳。写哪一列由调用方指定：judge 传进来的 owner 是加锁前的快照，
 * `final_sent_at` 还留着上一次锁死的旧值，据此推断会写错列。
 */
async function deliverFinal(
  env: Env,
  owner: OwnerRow,
  now: number,
  point: { missedDays: number; lockedAt: number; column: "final_sent_at" | "final_second_at" },
): Promise<{ ok: number; failed: number; errors: string[]; targets: RecipientRow[] }> {
  const db = env.DB;
  const token = await ensureRecoveryToken(db, now);
  const targets = await finalRecipients(db);
  const r = await fanout(env, targets, "final", (row) => ({
    site: env.SITE_URL,
    label: row.label,
    checkin_url: checkinUrl(env, token),
    last_checkin: owner.last_checkin_at == null ? undefined : fmtClock(owner.timezone, owner.last_checkin_at),
    missed_days: point.missedDays,
    time: fmtClock(owner.timezone, point.lockedAt),
  }));
  if (r.ok > 0) {
    await writeWithRetry(point.column, () =>
      db.prepare(`UPDATE owner SET ${point.column} = ? WHERE id = 1 AND state = 'locked'`).bind(now).run(),
    );
  }
  return { ...r, targets };
}

/**
 * 心跳监控的是「调度器有没有跑到这一步」，不是「消息有没有发出去」。
 * 所以按设计跳过的路径（locked 不发日常链接、12h 幂等守卫、两条最终消息已发满的静默期）同样要喂狗——
 * 否则一次锁死会让两个 check 在整个期间天天误报，而告警接收方是紧急联系人。
 * 两个 job 各一个独立 check URL（docs/backend.md §7）。
 */
async function ping(env: Env, job: "send" | "judge", ok: boolean): Promise<void> {
  const base = job === "send" ? env.HEARTBEAT_SEND_URL : env.HEARTBEAT_JUDGE_URL;
  if (!base) return;
  const url = `${base.replace(/\/+$/, "")}/${ok ? "pass" : "fail"}`;
  try {
    await fetch(url, { method: "POST", body: "", signal: AbortSignal.timeout(3_000) });
  } catch {
    /* 心跳失败不影响主流程 */
  }
}

/** 12:00 发送任务（docs/backend.md §2.1）：normal 态发当日签到链接，locked 态负责第二条、也是最后一条最终消息。 */
export async function runSend(env: Env, opts: { force?: boolean; now?: number } = {}): Promise<CronSummary> {
  const db = env.DB;
  const now = opts.now ?? Date.now();
  const owner = await getOwner(db);
  if (!owner) {
    return { ran: false, job: "send", sent: 0, failed: 0, detail: "owner 行不存在，先跑 init-owner", error: "[send] owner 行不存在" };
  }
  if (owner.state === "locked") return runFinalFollowup(env, owner, now);
  if (!opts.force && owner.last_send_at != null && now - owner.last_send_at < GUARD_MS) {
    await ping(env, "send", true);
    await housekeeping(db, now);
    return { ran: false, job: "send", skipped: "距上次发送不足 12 小时", sent: 0, failed: 0, detail: "跳过", error: null };
  }

  const token = await rollDailyPrompt(db, now);
  const url = checkinUrl(env, token.token);
  const targets = await promptRecipients(db);
  if (targets.length === 0) {
    const msg = "[send] 没有配置任何「日常提醒」通道，今日链接发不出去";
    await setCronHealth(db, now, "error", msg);
    await db.prepare("UPDATE owner SET last_send_at = ? WHERE id = 1").bind(now).run();
    await ping(env, "send", false);
    return { ran: true, job: "send", sent: 0, failed: 0, detail: msg, error: msg };
  }

  const r = await fanout(env, targets, "prompt", (row) => ({
    site: env.SITE_URL,
    label: row.label,
    checkin_url: url,
  }));

  // 全部通道 settle 之后才写 last_send_at，否则中途被杀会留下部分投递且无任何记录（§2.4）
  await db.prepare("UPDATE owner SET last_send_at = ? WHERE id = 1").bind(now).run();
  const ok = r.failed === 0;
  const error = ok ? null : `[send] ${r.failed}/${targets.length} 个通道失败：${r.errors.join(" | ").slice(0, 300)}`;
  await setCronHealth(db, now, ok ? "ok" : "error", error);
  await ping(env, "send", ok);
  await housekeeping(db, now);

  return {
    ran: true,
    job: "send",
    sent: r.ok,
    failed: r.failed,
    detail: ok ? `已向 ${r.ok} 个通道发出今日链接` : (error ?? "发送失败"),
    error,
  };
}

/**
 * 锁死后的第二条、也是最后一条最终消息（§2.1 步 0）。第一条整条失败时这里的成功算「补发」而不是
 * 第二条，所以**失败不消耗名额**、次日 12:00 继续重试；只有 `final_second_at` 落库后系统才彻底静默。
 * 不碰 `last_send_at`——那个时间戳只表示「今天的签到链接发出去了」，混进来会让恢复后的读数说谎。
 */
async function runFinalFollowup(env: Env, owner: OwnerRow, now: number): Promise<CronSummary> {
  const db = env.DB;
  if (owner.final_second_at != null) {
    await ping(env, "send", true);
    await housekeeping(db, now);
    return {
      ran: false,
      job: "send",
      skipped: `${FINAL_MAX} 条最终消息已发满（最后一条于 ${fmtClock(owner.timezone, owner.final_second_at)} 送达），不再发送任何消息`,
      sent: 0,
      failed: 0,
      detail: "跳过",
      error: null,
    };
  }
  // 锁死后 owner 自己签过到就撤销判定；这里兜住「读 owner 之后才落库的那次签到」这几秒
  if (owner.locked_at != null && !(await stillAbsent(db, owner.locked_at))) {
    await ping(env, "send", true);
    await housekeeping(db, now);
    return {
      ran: false,
      job: "send",
      skipped: "锁死后检测到签到，未发送第二条最终消息",
      sent: 0,
      failed: 0,
      detail: "跳过",
      error: null,
    };
  }

  const firstPending = owner.final_sent_at == null;
  const r = await deliverFinal(env, owner, now, {
    missedDays: owner.missed_streak,
    lockedAt: owner.locked_at ?? now,
    column: firstPending ? "final_sent_at" : "final_second_at",
  });
  const error =
    r.ok > 0
      ? null
      : r.targets.length === 0
        ? "[send] 锁死待补发，但没有任何「紧急联系人」通道，最终消息发给了空气"
        : `[send] 最终消息 ${r.failed}/${r.targets.length} 失败，明日 12:00 继续重试`;
  await setCronHealth(db, now, error ? "error" : "ok", error);
  await ping(env, "send", !error);
  await housekeeping(db, now);

  return {
    ran: true,
    job: "send",
    sent: r.ok,
    failed: r.failed,
    detail:
      r.ok > 0
        ? firstPending
          ? `第一条最终消息补发成功，送达 ${r.ok} 个通道；次日 12:00 再发最后一条`
          : `第二条最终消息已送达 ${r.ok} 个通道，此后系统不再发送任何消息`
        : (error ?? "发送失败"),
    error,
  };
}

/** 24:00 判定任务（docs/backend.md §2.2）。 */
export async function runJudge(env: Env, opts: { force?: boolean; now?: number } = {}): Promise<CronSummary> {
  const db = env.DB;
  const now = opts.now ?? Date.now();
  const owner = await getOwner(db);
  if (!owner) {
    return { ran: false, job: "judge", sent: 0, failed: 0, detail: "owner 行不存在，先跑 init-owner", error: "[judge] owner 行不存在" };
  }
  if (!opts.force && now - owner.last_judge_at < GUARD_MS) {
    await ping(env, "judge", true);
    await housekeeping(db, now);
    return { ran: false, job: "judge", skipped: "距上次判定不足 12 小时", sent: 0, failed: 0, detail: "跳过", error: null };
  }

  if (owner.state === "locked") {
    const done = await runLockedIdle(env, owner, now);
    await housekeeping(db, now);
    return done;
  }

  const windowStart = owner.last_judge_at;
  // 健康判定必须在更新 last_judge_at 之前求值：条件是 last_send_at 落在本次窗口内，
  // 不是「早于 last_judge_at」——正常情况下 send 12:00、judge 24:00，后者会每天误报（§2.2 step 6）。
  const sentInWindow = owner.last_send_at != null && owner.last_send_at >= windowStart && owner.last_send_at < now;
  const missingSend = sentInWindow
    ? null
    : "[judge] 本周期没有发出过签到链接，判定结果不可信；可用 /api/cron/resend 重发";

  const checkedIn = owner.last_checkin_at != null && owner.last_checkin_at >= windowStart;
  if (checkedIn) {
    if (owner.missed_streak !== 0) {
      await writeWithRetry("缺席归零", () =>
        db.prepare("UPDATE owner SET missed_streak = 0 WHERE id = 1").run(),
      );
    }
    await setCronHealth(db, now, missingSend ? "error" : "ok", missingSend);
    await ping(env, "judge", !missingSend);
    await recordJudge(db, now);
    await housekeeping(db, now);
    return {
      ran: true,
      job: "judge",
      sent: 0,
      failed: 0,
      detail: missingSend ?? "本周期已签到，缺席计数归零",
      error: missingSend,
    };
  }

  const newStreak = owner.missed_streak + 1;

  if (newStreak < LOCK_AT) {
    const res = await conditionalUpdate(
      db,
      "UPDATE owner SET missed_streak = ?, streak = 0 WHERE id = 1",
      [newStreak],
      windowStart,
    );
    if ((res.meta?.changes ?? 0) === 0) return abandoned(env, now, windowStart);

    if (!(await stillAbsent(db, windowStart))) return abandoned(env, now, windowStart);

    const token = await mintReminder(db, now);
    const url = checkinUrl(env, token);
    const targets = await promptRecipients(db);
    const r = await fanout(env, targets, "reminder", (row) => ({
      site: env.SITE_URL,
      label: row.label,
      checkin_url: url,
      last_checkin: owner.last_checkin_at == null ? undefined : fmtClock(owner.timezone, owner.last_checkin_at),
      missed_days: newStreak,
      reminder_index: newStreak,
    }));
    const error = missingSend ?? (r.failed > 0 ? `[judge] 提醒 ${r.failed}/${targets.length} 失败：${r.errors.join(" | ").slice(0, 200)}` : null);
    await setCronHealth(db, now, error ? "error" : "ok", error);
    await ping(env, "judge", !error);
    await recordJudge(db, now);
    await housekeeping(db, now);
    return {
      ran: true,
      job: "judge",
      sent: r.ok,
      failed: r.failed,
      detail: `连续缺席第 ${newStreak}/${LOCK_AT - 1} 次提醒已发出`,
      error,
    };
  }

  // 缺席满 LOCK_AT 天：锁死。两个送达时间戳都必须显式清空，否则第二次锁死会读到上一次的记录、
  // 「最多两条」直接失效。
  const res = await conditionalUpdate(
    db,
    "UPDATE owner SET state = 'locked', locked_at = ?, missed_streak = ?, streak = 0, final_sent_at = NULL, final_second_at = NULL WHERE id = 1",
    [now, LOCK_AT],
    windowStart,
  );
  if ((res.meta?.changes ?? 0) === 0) return abandoned(env, now, windowStart);
  if (!(await stillAbsent(db, windowStart))) return abandoned(env, now, windowStart);

  const r = await deliverFinal(env, owner, now, { missedDays: newStreak, lockedAt: now, column: "final_sent_at" });
  const error =
    missingSend ??
    (r.targets.length === 0
      ? "[judge] 已锁死但没有任何「紧急联系人」通道，最终消息发给了空气"
      : r.failed > 0
        ? `[judge] 最终消息 ${r.failed}/${r.targets.length} 失败，明日 12:00 重试`
        : null);
  await setCronHealth(db, now, error ? "error" : "ok", error);
  await ping(env, "judge", !error);
  await recordJudge(db, now);
  await housekeeping(db, now);

  return {
    ran: true,
    job: "judge",
    sent: r.ok,
    failed: r.failed,
    detail:
      r.ok > 0
        ? `已锁死，第一条最终消息送达 ${r.ok} 个通道；次日 12:00 再发最后一条`
        : "已锁死，最终消息未送达，系统每天 12:00 自动重试",
    error,
  };
}

/**
 * locked 态的判定：什么都不发（第二条归 12:00 的 send 管），只推进时间戳并保留 send 记下的错误。
 * 照常推进 `last_judge_at` 与喂狗，否则 §7 的 25h 健康阈值会在整个锁死期天天误报。
 */
async function runLockedIdle(env: Env, owner: OwnerRow, now: number): Promise<CronSummary> {
  const db = env.DB;
  await ping(env, "judge", true);
  await setCronHealth(db, now, owner.last_cron_status === "error" ? "error" : "ok", owner.last_cron_error);
  await recordJudge(db, now);
  return {
    ran: true,
    job: "judge",
    sent: 0,
    failed: 0,
    detail:
      owner.final_second_at != null
        ? `已锁死，${FINAL_MAX} 条最终消息已发满（最后一条于 ${fmtClock(owner.timezone, owner.final_second_at)} 送达），系统静默`
        : owner.final_sent_at != null
          ? `已锁死，第一条已于 ${fmtClock(owner.timezone, owner.final_sent_at)} 送达，等待次日 12:00 的最后一条`
          : "已锁死，最终消息一条都没送达，每日 12:00 重试",
    error: null,
  };
}

async function stillAbsent(db: D1Database, windowStart: number): Promise<boolean> {
  const fresh = await getOwner(db);
  if (!fresh) return true;
  return !(fresh.last_checkin_at != null && fresh.last_checkin_at >= windowStart);
}

/**
 * 期间发生了签到：放弃本次判定、不发任何消息，也不回滚已经写下的东西（§2.2 step 5）。
 * 但这一次任务确实跑到了，所以照常推进 last_judge_at 并喂狗——窗口起点前移是安全的，
 * 那次签到落在旧窗口内，新窗口要求一次新的签到。
 */
async function abandoned(env: Env, now: number, windowStart: number): Promise<CronSummary> {
  await recordJudge(env.DB, now);
  await ping(env, "judge", true);
  await housekeeping(env.DB, now);
  return {
    ran: false,
    job: "judge",
    skipped: `判定窗口 [${new Date(windowStart).toISOString()}] 内检测到签到，放弃本次判定、未发送任何消息`,
    sent: 0,
    failed: 0,
    detail: "已放弃",
    error: null,
  };
}
