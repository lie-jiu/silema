import { b64url, constantTimeEqual, unb64url } from "./util";

export const SESSION_COOKIE = "slm_session";
export const SESSION_TTL_MS = 12 * 3_600_000;

export type SessionPayload = { e: number; exp: number };

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg))));
}

export async function issueSession(
  secret: string,
  epoch: number,
  now = Date.now(),
): Promise<{ value: string; maxAge: number }> {
  const payload: SessionPayload = { e: epoch, exp: now + SESSION_TTL_MS };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return { value: `${body}.${await hmac(secret, body)}`, maxAge: SESSION_TTL_MS / 1000 };
}

/** 只验签与验期；`session_epoch` 必须再由调用方比对 owner 行（docs/backend.md §5）。 */
export async function readSession(
  secret: string,
  value: string | undefined,
  now = Date.now(),
): Promise<SessionPayload | null> {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  if (!constantTimeEqual(sig, await hmac(secret, body))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(unb64url(body))) as SessionPayload;
    if (typeof payload.e !== "number" || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

/** `HttpOnly; Secure; SameSite=Lax; Path=/` —— cookie 属性在 §5 里是定死的。 */
export function sessionCookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
