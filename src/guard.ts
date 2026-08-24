import type { Context, Next } from "hono";
import { sign, verify } from "hono/jwt";
import type { Bindings } from "./types";

// Tokens are valid for 12 hours from issuance. Only the most recently
// issued token (matching the current session epoch) is accepted.
export const TOKEN_TTL = 12 * 3600;

export interface OwnerJwtPayload {
  sub: string;
  exp?: number;
  iat?: number;
  epoch?: number;
  [key: string]: unknown;
}

export async function verifyOwnerToken(
  secret: string | undefined,
  header: string | undefined
): Promise<OwnerJwtPayload | null> {
  if (!secret || !header?.startsWith("Bearer ")) return null;
  try {
    const payload = await verify(header.slice(7), secret, "HS256");
    const typed = payload as OwnerJwtPayload;
    return typed.sub === "owner" ? typed : null;
  } catch {
    return null;
  }
}

export async function currentEpoch(env: Bindings): Promise<number> {
  const row = await env.DB.prepare("SELECT session_epoch FROM owner WHERE id = 1")
    .first<{ session_epoch: number }>();
  return row?.session_epoch ?? 0;
}

// Invalidates every previously issued token; returns the new epoch to embed.
export async function bumpEpoch(env: Bindings): Promise<number> {
  const next = (await currentEpoch(env)) + 1;
  await env.DB.prepare("UPDATE owner SET session_epoch = ? WHERE id = 1").bind(next).run();
  return next;
}

export async function issueToken(
  secret: string,
  opts: { epoch: number }
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: "owner",
    iat: now,
    exp: now + TOKEN_TTL,
    epoch: opts.epoch,
  };
  return sign(payload, secret, "HS256");
}

export interface AuthEnv {
  Bindings: Bindings;
  Variables: { jwtPayload: OwnerJwtPayload };
}

export async function requireAuth(c: Context<AuthEnv>, next: Next): Promise<Response | void> {
  const payload = await verifyOwnerToken(c.env.JWT_SECRET, c.req.header("Authorization"));
  if (!payload) return c.json({ error: "Unauthorized" }, 401);

  const epoch = await currentEpoch(c.env);
  if ((payload.epoch ?? -1) !== epoch) {
    return c.json({ error: "会话已失效，请重新登录" }, 401);
  }

  c.set("jwtPayload", payload);
  await next();
}
