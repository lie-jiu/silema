/** 按 IP 的固定窗口限流，存 D1（限额见 README「安全」与「环境变量」）。 */
export async function hitRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<{ allowed: boolean; count: number; retryAfterMinutes: number }> {
  // upsert 与回读必须在同一个 batch 里：batch 是一个隐式事务，回读看得到刚写下的计数，
  // 而拆成两次往返会在这个全站最热的路径（打开签到链接）上白付一次 D1 round-trip。
  const [, read] = await db.batch<{ count: number; window_start: number }>([
    db
      .prepare(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN ? - rate_limits.window_start < ? THEN rate_limits.count + 1 ELSE 1 END,
           window_start = CASE WHEN ? - rate_limits.window_start < ? THEN rate_limits.window_start ELSE ? END`,
      )
      .bind(key, now, now, windowMs, now, windowMs, now),
    db.prepare("SELECT count, window_start FROM rate_limits WHERE key = ?").bind(key),
  ]);

  const row = read?.results?.[0];
  const count = row?.count ?? 1;
  const elapsed = now - (row?.window_start ?? now);
  const retryAfter = Math.max(1, Math.ceil((windowMs - elapsed) / 60_000));
  return { allowed: count <= limit, count, retryAfterMinutes: retryAfter };
}

export async function clearRateLimit(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM rate_limits WHERE key = ?").bind(key).run();
}
