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
  await db
    .prepare("INSERT INTO checkin_tokens (token, purpose, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(token, purpose, now, expiresAt)
    .run();
  return token;
}

export async function findToken(db: D1Database, token: string): Promise<TokenRow | null> {
  return db.prepare("SELECT * FROM checkin_tokens WHERE token = ?").bind(token).first<TokenRow>();
}

/**
 * 12:00 清链 + 铸造当日令牌。`purpose != 'test'` 全删（含已使用，不留审计），
 * 到期时刻取固定墙钟当日 24:00——不用 created_at+12h，cron 晚触发时两者会分叉（docs/backend.md §2.1）。
 */
export async function rollDailyPrompt(db: D1Database, now = Date.now()): Promise<TokenRow> {
  const token = randomHex(32);
  const expiresAt = endOfDayMs(SCHEDULE_TZ, new Date(now));
  await writeWithRetry("清链", () =>
    db.batch([
      db.prepare("DELETE FROM checkin_tokens WHERE purpose != 'test'"),
      db
        .prepare("INSERT INTO checkin_tokens (token, purpose, created_at, expires_at) VALUES (?, 'prompt', ?, ?)")
        .bind(token, now, expiresAt),
    ]),
  );
  return { token, purpose: "prompt", created_at: now, expires_at: expiresAt, used_at: null };
}

/** 提醒令牌 TTL 12h，与次日 12:00 的清链一致（docs/backend.md §2.3）。 */
export async function mintReminder(db: D1Database, now = Date.now()): Promise<string> {
  return mint(db, "reminder", now + 12 * 3_600_000, now);
}

/** 恢复链接 TTL 7 天；锁死期间逐日复用未过期那条（docs/backend.md §2.2）。 */
export async function ensureRecoveryToken(db: D1Database, now = Date.now()): Promise<string> {
  const live = await db
    .prepare("SELECT * FROM checkin_tokens WHERE purpose = 'final' AND used_at IS NULL AND expires_at > ?")
    .bind(now)
    .first<TokenRow>();
  if (live) return live.token;
  return mint(db, "final", now + 7 * 86_400_000, now);
}

export async function housekeeping(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM checkin_tokens WHERE expires_at < ? AND purpose != 'prompt'").bind(now),
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now - 86_400_000),
  ]);
}
