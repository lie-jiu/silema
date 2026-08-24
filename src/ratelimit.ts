const CLEANUP_SAMPLE = 0.05;

export async function rateLimit(
  env: { DB: D1Database },
  key: string,
  limit: number,
  windowSec: number
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSec;

  // Single atomic statement: increment (or roll the window) and read back the
  // count in one shot, so concurrent requests can never share a stale count.
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start)
     VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < ? THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < ? THEN ? ELSE rate_limits.window_start END
     RETURNING count`
  )
    .bind(key, now, windowStart, windowStart, now)
    .first<{ count: number }>();

  if (Math.random() < CLEANUP_SAMPLE) {
    await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
      .bind(now - 86400)
      .run();
  }

  return (row?.count ?? 0) <= limit;
}

export function clientIp(headers: Headers): string {
  return headers.get("CF-Connecting-IP") || headers.get("X-Forwarded-For")?.split(",")[0].trim() || "unknown";
}
