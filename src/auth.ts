import { Hono } from "hono";
import { timingSafeEqualStr } from "./crypto";
import { verifyTOTP } from "./totp";
import { issueToken, bumpEpoch } from "./guard";
import { rateLimit, clientIp } from "./ratelimit";
import type { AuthEnv } from "./guard";

const auth = new Hono<AuthEnv>();

async function checkRate(
  c: { env: AuthEnv["Bindings"]; req: { raw: Request }; json: (o: object, s?: number) => Response },
  bucket: string,
  limit: number,
  windowSec: number
): Promise<Response | null> {
  const ok = await rateLimit(c.env, `${bucket}:${clientIp(c.req.raw.headers)}`, limit, windowSec);
  if (!ok) return c.json({ error: "Too many attempts. Try again later." }, 429);
  return null;
}

auth.post("/login", async (c) => {
  const limited = await checkRate(c, "login", 10, 900);
  if (limited) return limited;

  let body: { username?: string; password?: string; totpCode?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const { username, password, totpCode } = body;
  if (!username || !password || !totpCode) {
    return c.json({ error: "Missing username, password or totpCode" }, 400);
  }
  if (!c.env.JWT_SECRET) return c.json({ error: "JWT_SECRET not configured" }, 500);

  // Credentials come exclusively from Worker secrets.
  const adminUser = c.env.ADMIN_USERNAME?.trim() || "";
  const adminPass = c.env.ADMIN_PASSWORD || "";
  if (!adminUser || !adminPass) {
    return c.json(
      { error: "ADMIN_USERNAME / ADMIN_PASSWORD 未配置：请运行 wrangler secret put 设置" },
      500
    );
  }

  // TOTP secret stays in D1; the owner row also carries settings/state.
  const owner = await c.env.DB.prepare("SELECT totp_secret FROM owner WHERE id = 1").first<{
    totp_secret: string;
  }>();
  if (!owner) return c.json({ error: "No owner configured" }, 404);

  // Constant-shape failure: always run all checks before responding.
  const [userOk, passOk, totpOk] = await Promise.all([
    timingSafeEqualStr(username.trim(), adminUser),
    timingSafeEqualStr(password, adminPass),
    verifyTOTP(owner.totp_secret, totpCode),
  ]);
  if (!userOk || !passOk || !totpOk) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  // Single active session: issuing a token revokes all previous ones.
  const epoch = await bumpEpoch(c.env);
  return c.json({ token: await issueToken(c.env.JWT_SECRET, { epoch }) });
});

export default auth;
