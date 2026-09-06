import type { Bindings } from "./types";

/* 快速签到令牌。
 *
 * 存库而非自签名：随机串本身不携带任何信息，服务端握有完整状态，因此
 * 既能查「这条链接什么时候发的、被点了几次」，也能在怀疑泄露时一键作废。
 *
 * 令牌是一次性消费的：首次成功签到后立即作废，再次打开显示「已使用」。
 * 这是有意为之 —— 可重复链接意味着泄露后被他人持续续命，且「签到链接」
 * 语义上就应是一次性的。为避免「我到底签上没有」的恐慌，作废后页面会明确
 * 告知「已使用」而非笼统报错。首次使用时间与次数仍记账，用于事后审计。
 *
 * 令牌按事件（cycle）统一生成、全体接收人共用，而不是每个频道各发一条 ——
 * 见 getOrIssueSharedToken。
 */

export type TokenPurpose = "warning" | "trigger" | "test";

// 32 字节 ≈ 256 位，URL 安全 base64 后 43 字符。
const TOKEN_BYTES = 32;

function randomToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 对外链接的基底：APP_BASE_URL 优先；测试发送这类有请求上下文的调用方可用
 * 请求 Origin 兜底。Cron 没有请求上下文，APP_BASE_URL 未配置时只能返回空。 */
function baseUrl(env: Bindings, fallback?: string): string {
  const base = (env.APP_BASE_URL || "").replace(/\/+$/, "");
  if (base) return base;
  return (fallback || "").replace(/\/+$/, "");
}

/** 生成一条签到链接用的令牌，返回已拼好的完整 URL；无法确定站点地址时返回 null。 */
export async function issueCheckinToken(
  env: Bindings,
  opts: { purpose: TokenPurpose; ttlSec: number; cycle?: number | null; base?: string }
): Promise<string | null> {
  const base = baseUrl(env, opts.base);
  if (!base) return null;

  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO checkin_tokens (token, purpose, cycle, created_at, expires_at, use_count)
     VALUES (?, ?, ?, ?, ?, 0)`
  )
    .bind(token, opts.purpose, opts.cycle ?? null, now, now + opts.ttlSec)
    .run();

  return `${base}/c/${token}`;
}

/**
 * 取本次事件共用的签到链接；还没有就现造一条。
 *
 * 一次警告 / 一次触发只应有一条链接，所有频道的 {checkin_url} 都指向它。
 * 若放在每个频道的循环里各生成一条，N 个通道就是 N 条互不相同的入口，而
 * 令牌是一次性的 —— 点过其中一条，其余全部变成「已使用」，等于这次通知
 * 白扔了 N-1 条链接，还让人怀疑是不是点错了。
 *
 * 重试时按 cycle 查回同一条，同一轮事件自始至终只有一个入口。
 */
export async function getOrIssueSharedToken(
  env: Bindings,
  opts: { purpose: TokenPurpose; cycle: number; ttlSec: number; base?: string }
): Promise<string | null> {
  const base = baseUrl(env, opts.base);
  if (!base) return null;

  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare(
    `SELECT token FROM checkin_tokens
      WHERE purpose = ? AND cycle = ? AND expires_at >= ?
      ORDER BY created_at DESC LIMIT 1`
  )
    .bind(opts.purpose, opts.cycle, now)
    .first<{ token: string }>();

  if (existing) return `${base}/c/${existing.token}`;

  return issueCheckinToken(env, {
    purpose: opts.purpose,
    cycle: opts.cycle,
    ttlSec: opts.ttlSec,
    base: opts.base,
  });
}

export interface TokenRow {
  token: string;
  purpose: TokenPurpose;
  expires_at: number;
  used_at: number | null;
}

/** 只校验有效性，不记账。渲染确认页时用 —— 打开页面还没签到，不该算一次使用。 */
export async function validateCheckinToken(env: Bindings, token: string): Promise<TokenRow | null> {
  if (!token || token.length > 128) return null;

  const row = await env.DB.prepare(
    "SELECT token, purpose, expires_at, used_at FROM checkin_tokens WHERE token = ?"
  )
    .bind(token)
    .first<TokenRow>();
  if (!row) return null;

  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    // 顺手清理：过期的已经没用了，留着只是白占空间。
    await env.DB.prepare("DELETE FROM checkin_tokens WHERE token = ?").bind(token).run();
    return null;
  }
  return row;
}

/** 一次性消费：有效且未被用过才记账并返回行，否则返回 null（缺失/过期/已用）。 */
export async function consumeCheckinToken(env: Bindings, token: string): Promise<TokenRow | null> {
  const row = await validateCheckinToken(env, token);
  if (!row || row.used_at != null) return null;

  const now = Math.floor(Date.now() / 1000);
  // WHERE used_at IS NULL 保证并发时只有一个请求真正消费成功 —— 但 UPDATE
  // 影响行数为 0（另一并发请求抢先）时必须返回 null，否则两个请求都会拿着
  // 各自查询到的快照继续往下走，签到链接就消费了两次。
  const res = await env.DB.prepare(
    `UPDATE checkin_tokens
        SET used_at = ?, use_count = use_count + 1
      WHERE token = ? AND used_at IS NULL`
  )
    .bind(now, token)
    .run();
  if ((res.meta.changes ?? 0) === 0) return null;

  return row;
}

/** cron 清理：删掉过期超过一天的令牌，以及用过后超过 7 天的（留审计痕迹的窗口足够）。 */
export async function purgeExpiredTokens(env: Bindings, now: number): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM checkin_tokens WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)"
  )
    .bind(now - 86400, now - 7 * 86400)
    .run();
}
