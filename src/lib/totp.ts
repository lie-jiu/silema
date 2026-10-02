import { TOTP } from "otpauth";

export const TOTP_STEP_MS = 30_000;
const DRIFT_WINDOW = 1;

/** otpauth 直接吃 base32 字符串，不需要额外编码。 */
function totp(secret: string): TOTP {
  return new TOTP({ secret, digits: 6, period: 30 });
}

export function totpUri(secret: string, label: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(
    issuer,
  )}&algorithm=SHA1&digits=6&period=30`;
}

export type TotpResult = { ok: true; step: number } | { ok: false; reason: "bad" | "replay" };

/**
 * 允许 ±1 步时钟漂移，但用过的步数写进 `owner.totp_last_step` 后不可再用（README「端点 · 认证」）。
 * 恢复码不走这里——那是同一个输入框、另一套校验。
 */
export function verifyTotp(secret: string, code: string, lastStep: number, now = Date.now()): TotpResult {
  const normalized = code.replace(/\s/g, "");
  if (!/^[0-9]{6}$/.test(normalized)) return { ok: false, reason: "bad" };
  const delta = totp(secret).validate({ token: normalized, timestamp: now, window: DRIFT_WINDOW });
  if (delta === null) return { ok: false, reason: "bad" };
  const step = Math.floor(now / TOTP_STEP_MS) - delta;
  if (step <= lastStep) return { ok: false, reason: "replay" };
  return { ok: true, step };
}

export function currentTotp(secret: string, now = Date.now()): string {
  return totp(secret).generate({ timestamp: now });
}
