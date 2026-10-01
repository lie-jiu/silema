/** 按 IP 的固定窗口限流，存 D1（docs/backend.md §7）。 */
export async function hitRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<{ allowed: boolean; count: number; retryAfterMinutes: number }> {
  await db.batch([
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

  const row = await db.prepare("SELECT count, window_start FROM rate_limits WHERE key = ?").bind(key).first<{
    count: number;
    window_start: number;
  }>();
  const count = row?.count ?? 1;
  const elapsed = now - (row?.window_start ?? now);
  const retryAfter = Math.max(1, Math.ceil((windowMs - elapsed) / 60_000));
  return { allowed: count <= limit, count, retryAfterMinutes: retryAfter };
}

export async function clearRateLimit(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM rate_limits WHERE key = ?").bind(key).run();
}
