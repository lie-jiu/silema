export type OwnerRow = {
  id: number;
  totp_secret: string;
  totp_last_step: number;
  backup_codes: string | null;
  session_epoch: number;
  timezone: string;
  state: "normal" | "locked";
  streak: number;
  missed_streak: number;
  last_checkin_at: number | null;
  locked_at: number | null;
  final_sent_at: number | null;
  final_second_at: number | null;
  last_send_at: number | null;
  last_judge_at: number;
  last_cron_at: number | null;
  last_cron_status: string | null;
  last_cron_error: string | null;
};

/**
 * D1 只对只读查询做自动重试（release notes 原文「At the moment, only read-only queries are
 * retried」），所以状态写入必须自带重试——幂等条件写入使其可安全重放（README「自监控与运维」）。
 */
export async function writeWithRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
  }
  throw new Error(`${label} 写入失败（重试 ${attempts} 次）: ${String(lastError)}`);
}

export async function getOwner(db: D1Database): Promise<OwnerRow | null> {
  return db.prepare("SELECT * FROM owner WHERE id = 1").first<OwnerRow>();
}

/** `last_checkin_at >= last_judge_at` 即本周期已签到（README「数据模型」）。 */
export function checkedThisCycle(owner: OwnerRow): boolean {
  return owner.last_checkin_at != null && owner.last_checkin_at >= owner.last_judge_at;
}

export function setCronHealth(db: D1Database, at: number, status: "ok" | "error", error: string | null) {
  return writeWithRetry("cron 健康记录", () =>
    db
      .prepare(
        `UPDATE owner SET last_cron_at = ?, last_cron_status = ?, last_cron_error = ? WHERE id = 1`,
      )
      .bind(at, status, error)
      .run(),
  );
}
