import { writeWithRetry } from "./db";
import { SCHEDULE_TZ, endOfDayMs } from "./time";
import { randomHex } from "./util";

export type TokenPurpose = "prompt" | "reminder" | "final" | "test";

export type TokenRow = {
  token: string;
  purpose: TokenPurpose;
  created_at: number;
  expires_at: number;
  used_at: number | null;
};

export function isLive(row: TokenRow | null, now: number): row is TokenRow {
  return !!row && row.used_at == null && row.expires_at > now;
}

export async function mint(
  db: D1Database,
  purpose: TokenPurpose,
  expiresAt: number,
  now = Date.now(),
): Promise<string> {
  const token = randomHex(32);
  // ON CONFLICT DO NOTHING 让重试可安全重放：第一次其实落库成功、只是响应丢了。
  await writeWithRetry("铸造令牌", () =>
    db
      .prepare(
        "INSERT INTO checkin_tokens (token, purpose, created_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO NOTHING",
      )
      .bind(token, purpose, now, expiresAt)
      .run(),
  );
  return token;
}

export async function findToken(db: D1Database, token: string): Promise<TokenRow | null> {
  return db.prepare("SELECT * FROM checkin_tokens WHERE token = ?").bind(token).first<TokenRow>();
}

/**
 * 12:00 清链 + 铸造当日令牌。`purpose != 'test'` 全删（含已使用，不留审计），
 * 到期时刻取固定墙钟当日 24:00——不用 created_at+12h，cron 晚触发时两者会分叉（README「签到与状态机」）。
 */
export async function rollDailyPrompt(db: D1Database, now = Date.now()): Promise<TokenRow> {
  const token = randomHex(32);
  const expiresAt = endOfDayMs(SCHEDULE_TZ, new Date(now));
  await writeWithRetry("清链", () =>
    db.batch([
      db.prepare("DELETE FROM checkin_tokens WHERE purpose != 'test'"),
      db
        .prepare(
          "INSERT INTO checkin_tokens (token, purpose, created_at, expires_at) VALUES (?, 'prompt', ?, ?) ON CONFLICT(token) DO NOTHING",
        )
        .bind(token, now, expiresAt),
    ]),
  );
  return { token, purpose: "prompt", created_at: now, expires_at: expiresAt, used_at: null };
}

/**
 * 重发用的当日令牌：`/api/cron/resend` 与 `/__cron?force=1` 复用这条，不重新清链
 * （README「使用前必须知道的边界」）——
 * 清链会让已经送达的消息里那条链接当场变「已失效」，而重发本是「链接没送到」的补救手段。
 * 刻意不过滤 `used_at`：今天已签过再重发，接收人看到「今日已签」才是事实。
 */
export async function livePromptToken(db: D1Database, now = Date.now()): Promise<TokenRow | null> {
  return db
    .prepare("SELECT * FROM checkin_tokens WHERE purpose = 'prompt' AND expires_at > ? ORDER BY created_at DESC")
    .bind(now)
    .first<TokenRow>();
}

/**
 * 24:00 判定任务作废当日链接：物理删除**已到期**的 daily/reminder 令牌。
 * 只删已到期的，所以 `force=1` 在白天手动跑判定不会杀掉当天那条还活着的链接；
 * 当日令牌的到期时刻正是墙钟 24:00，正常 cron 跑到的那一刻条件必然成立。
 * 恢复链接（`final`，TTL 7 天）不在删除范围内——锁定期它是唯一的自救入口。
 */
export async function voidDayLinks(db: D1Database, now = Date.now()): Promise<void> {
  await writeWithRetry("作废当日链接", () =>
    db.prepare("DELETE FROM checkin_tokens WHERE purpose IN ('prompt','reminder') AND expires_at <= ?").bind(now).run(),
  );
}

/** 恢复链接 TTL 7 天；锁死期间逐日复用未过期那条（README「它每天怎么运转」）。 */
export async function ensureRecoveryToken(db: D1Database, now = Date.now()): Promise<string> {
  const live = await db
    .prepare("SELECT * FROM checkin_tokens WHERE purpose = 'final' AND used_at IS NULL AND expires_at > ?")
    .bind(now)
    .first<TokenRow>();
  if (live) return live.token;
  return mint(db, "final", now + 7 * 86_400_000, now);
}

export async function housekeeping(db: D1Database, now = Date.now()): Promise<void> {
  await writeWithRetry("清理过期数据", () =>
    db.batch([
      db.prepare("DELETE FROM checkin_tokens WHERE expires_at < ? AND purpose != 'prompt'").bind(now),
      db.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - 86_400_000),
    ]),
  );
}
