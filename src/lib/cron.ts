import { getOwner, setCronHealth, writeWithRetry, type OwnerRow } from "./db";
import { configOf, finalRecipients, promptRecipients, type RecipientRow } from "./recipients";
import { render, type EventType, type TemplateVars } from "./messages";
import { deliverWithRetry, type Env } from "./send";
import { fmtClock } from "./time";
import { ensureRecoveryToken, housekeeping, livePromptToken, rollDailyPrompt, voidDayLinks } from "./tokens";

const GUARD_MS = 12 * 3_600_000;
const BUDGET_MS = 20_000;

/**
 * 连续缺席满 3 个周期即锁死。周期 = 相邻两次 12:00 运行之间（当日链接在墙钟 24:00 到期）。
 * 缺席期间**不额外发消息**：次日 12:00 的那一条日常消息自动改用「未确认提醒」文案，
 * 所以 missed_streak ∈ {1,2} 就是提醒次数，天然最多 2 次。
 */
export const LOCK_AT = 3;
/** 最终消息最多送达两条：锁死那次的 12:00 一条 + 次一个 12:00 一条，之后彻底静默。 */
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

/** 一次 cron 运行 = 判定 + 发送两个阶段，两边的结果都要留痕。 */
export type DailySummary = {
  job: "daily";
  judge: CronSummary;
  send: CronSummary;
  error: string | null;
};

/** 只认 `wrangler.jsonc` 里那一条 cron；对不上的表达式不执行任何任务（§2）。 */
export function parseCron(expr: string): "daily" | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour] = parts as [string, string];
  return minute === "0" && hour === "4" ? "daily" : null;
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
 * 会被随后落库的判定覆盖成 locked，而最终消息不可撤回（README「它每天怎么运转」）。
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
 * 投递一条最终消息。两条共用同一份模板与同一条 7 天恢复链接，只有至少一个通道成功才落时间戳。
 * 写哪一列由调用方指定：`final_sent_at` 为空说明第一条还没送达（补发也写这一列），
 * 否则写 `final_second_at`。
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
 * 两个阶段各一个独立 check URL，由同一次运行分别喂（README「自监控与运维」）——判定炸了与发送炸了因此仍可区分。
 */
export async function ping(env: Env, job: "send" | "judge", ok: boolean): Promise<void> {
  const base = job === "send" ? env.HEARTBEAT_SEND_URL : env.HEARTBEAT_JUDGE_URL;
  if (!base) return;
  const url = `${base.replace(/\/+$/, "")}/${ok ? "pass" : "fail"}`;
  try {
    await fetch(url, { method: "POST", body: "", signal: AbortSignal.timeout(3_000) });
  } catch {
    /* 心跳失败不影响主流程 */
  }
}

/**
 * 每天 12:00 那唯一一次 cron 运行：先判定上一周期，再发出今天这一条（README「它每天怎么运转」）。
 *
 * 判定必须排在发送之前——`missed_streak` 决定这一条用日常文案还是「未确认提醒」文案；而缺席满
 * `LOCK_AT` 次时，判定刚落下的 locked 会被同一次运行的发送阶段读到，第一条最终消息因此与锁死
 * 同刻投出。分成两条 cron 时它要等 12 小时，而那段窗口里 owner 手里一条自救链接都没有。
 *
 * 两个阶段各自兜异常：判定炸了不能连累当天的投递。
 */
export async function runDaily(env: Env, opts: { force?: boolean; now?: number } = {}): Promise<DailySummary> {
  const now = opts.now ?? Date.now();
  const judge = await runPhase(env, "judge", () => runJudge(env, opts));
  const send = await runPhase(env, "send", () => runSend(env, opts));
  const error = [judge.error, send.error].filter(Boolean).join(" | ") || null;
  // 两个阶段各自写过一次 last_cron_*，这里用合并结果收尾：否则紧随其后一次正常的发送
  // 会把判定留下的 error 盖掉，而 owner 行只有这一个槽位（§2.2 步 7）。
  try {
    await setCronHealth(env.DB, now, error ? "error" : "ok", error);
  } catch (err) {
    console.error("[daily] 合并健康写入失败", err);
  }
  return { job: "daily", judge, send, error };
}

async function runPhase(env: Env, job: "send" | "judge", fn: () => Promise<CronSummary>): Promise<CronSummary> {
  try {
    return await fn();
  } catch (err) {
    const msg = `[${job}] 未捕获异常：${String(err instanceof Error ? err.message : err).slice(0, 300)}`;
    console.error(msg, err);
    await ping(env, job, false);
    return { ran: false, job, sent: 0, failed: 0, detail: msg, error: msg };
  }
}

/**
 * 发送阶段（README「它每天怎么运转」）：全站唯一的对外投递窗口，每天 12:00 紧跟判定之后跑。
 * normal 态每天**只发一条**——缺席时同一条消息自动升级为「未确认提醒」文案，用的还是当日这条链接；
 * locked 态负责最多两条最终消息。判定阶段不发任何东西。
 */
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

  // force = 后台「重发今日链接」/ `/__cron?force=1`：复用当日令牌，不清链（§2.1 步 4）。
  // 只有确实没有可复用的（当日还没铸过、或已过期）才走清链重铸，否则重发会杀死已送达链接。
  const token = opts.force
    ? ((await livePromptToken(db, now)) ?? (await rollDailyPrompt(db, now)))
    : await rollDailyPrompt(db, now);
  const url = checkinUrl(env, token.token);
  const targets = await promptRecipients(db);
  if (targets.length === 0) {
    const msg = "[send] 没有配置任何「日常提醒」通道，今日链接发不出去";
    await setCronHealth(db, now, "error", msg);
    await writeWithRetry("last_send_at", () => db.prepare("UPDATE owner SET last_send_at = ? WHERE id = 1").bind(now).run());
    await ping(env, "send", false);
    return { ran: true, job: "send", sent: 0, failed: 0, detail: msg, error: msg };
  }

  // 缺席期：同一条消息换成提醒文案，链接仍是刚铸的当日令牌——任何时刻只有一条活链接。
  const absent = owner.missed_streak > 0;
  const r = await fanout(env, targets, absent ? "reminder" : "prompt", (row) => ({
    site: env.SITE_URL,
    label: row.label,
    checkin_url: url,
    last_checkin: owner.last_checkin_at == null ? undefined : fmtClock(owner.timezone, owner.last_checkin_at),
    missed_days: owner.missed_streak,
    reminder_index: owner.missed_streak,
  }));

  // 全部通道 settle 之后才写 last_send_at，否则中途被杀会留下部分投递且无任何记录（§2.4）
  await writeWithRetry("last_send_at", () => db.prepare("UPDATE owner SET last_send_at = ? WHERE id = 1").bind(now).run());
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
    detail: ok
      ? `已向 ${r.ok} 个通道发出今日${absent ? `「未确认提醒 ${owner.missed_streak}/${LOCK_AT - 1}」` : "签到链接"}`
      : (error ?? "发送失败"),
    error,
  };
}

/**
 * 锁死后的最终消息投递——两条都由这里发，判定阶段一条都不发（§2.1 步 0）。
 * 第一条失败时这次的成功算「补发」而不是第二条，所以**失败不消耗名额**、次日 12:00 继续重试；
 * 只有 `final_second_at` 落库后系统才彻底静默。两条之间还有一道 12 小时护栏，
 * 挡住手动触发把两条烧进同一小时。
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

  // 两条最终消息必须落在不同的 12:00。locked 分支在 12h 幂等守卫**之前**分流（那个守卫管的是
  // 日常链接），所以手动 `POST /__cron?job=send` 不受它约束：少了这一条，锁定期连点两次就会把
  // 相隔一天的两条塌成同一小时内连发，然后 `final_second_at` 落库、系统永久静默——
  // 而第二条的存在意义正是给 owner 一整个白天去撤销第一条。
  if (owner.final_sent_at != null && now - owner.final_sent_at < GUARD_MS) {
    await ping(env, "send", true);
    await housekeeping(db, now);
    return {
      ran: false,
      job: "send",
      skipped: `第一条最终消息送达不足 12 小时（${fmtClock(owner.timezone, owner.final_sent_at)}），第二条留到下一个 12:00`,
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
          ? `第一条最终消息已送达 ${r.ok} 个通道；次日 12:00 再发最后一条`
          : `第二条最终消息已送达 ${r.ok} 个通道，此后系统不再发送任何消息`
        : (error ?? "发送失败"),
    error,
  };
}

/**
 * 判定阶段（README「它每天怎么运转」）：**只判定，一条消息都不发**——缺席计数、锁死与作废当日
 * 链接都在这里完成，投递全部归紧随其后的发送阶段。窗口 = 相邻两次运行之间（约 24 小时）。
 */
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
  // 判定即「这一天过去了」：把已到期的当日链接物理删掉，此后任何点击都只可能显示「已失效」。
  // 只删 expires_at <= now，所以白天 force=1 手动跑判定不会杀掉当天还活着的那条。
  await voidDayLinks(db, now);

  // 健康判定必须在更新 last_judge_at 之前求值：条件是 last_send_at 落在本次窗口 [windowStart, now) 内，
  // 不是「早于 last_judge_at」——同一次运行里判定先于发送，上一周期的 last_send_at 永远晚于
  // 上一周期的 last_judge_at，按后者会每天误报（§2.2 step 7）。
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

    // 提醒不在这里发：缺席期内的「未确认提醒」就是次日 12:00 的那一条日常消息换了文案，
    // 用的仍是当日令牌，所以任何时刻最多一条活链接（§2.1）。
    await setCronHealth(db, now, missingSend ? "error" : "ok", missingSend);
    await ping(env, "judge", !missingSend);
    await recordJudge(db, now);
    await housekeeping(db, now);
    return {
      ran: true,
      job: "judge",
      sent: 0,
      failed: 0,
      detail: `连续缺席 ${newStreak} 天，本阶段不发送任何消息；当天那条日常消息改用提醒文案`,
      error: missingSend,
    };
  }

  // 缺席满 LOCK_AT 天：锁死。这里**不做任何投递**，第一条最终消息由同一次运行紧随其后的发送阶段
  // 投出，两者之间没有空窗——当日链接刚被作废、锁定期又不铸新的，那段空窗里本来一条自救入口都没有。
  // 两个送达时间戳都必须显式清空，否则第二次锁死会读到上一次的记录、
  // 「最多两条」直接失效。
  const res = await conditionalUpdate(
    db,
    "UPDATE owner SET state = 'locked', locked_at = ?, missed_streak = ?, streak = 0, final_sent_at = NULL, final_second_at = NULL WHERE id = 1",
    [now, LOCK_AT],
    windowStart,
  );
  if ((res.meta?.changes ?? 0) === 0) return abandoned(env, now, windowStart);

  await setCronHealth(db, now, missingSend ? "error" : "ok", missingSend);
  await ping(env, "judge", !missingSend);
  await recordJudge(db, now);
  await housekeeping(db, now);

  return {
    ran: true,
    job: "judge",
    sent: 0,
    failed: 0,
    detail: `连续缺席满 ${newStreak} 个周期，已锁死；本阶段不发消息，第一条最终消息由同一次运行的发送阶段投出`,
    error: missingSend,
  };
}

/**
 * locked 态的判定：本来就不发任何东西（两条最终消息都归发送阶段管），只推进时间戳并保留 send 记下的错误。
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
 * 期间发生了签到：放弃本次判定，也不回滚已经写下的东西（§2.2 step 6）。
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
