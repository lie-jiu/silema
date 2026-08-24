import { Hono } from "hono";
import auth from "./auth";
import checkinRoutes, { CHECKIN_COOLDOWN_SEC } from "./checkin";
import recipientsRoutes from "./recipients";
import { handleCron, handleReset } from "./cron";
import { requireAuth, type AuthEnv } from "./guard";
import { isValidTimeZone } from "./time";
import { publicPage } from "./pages/public";
import { adminPage } from "./pages/admin";
import type { Bindings } from "./types";

const app = new Hono<AuthEnv>();

// No CORS on purpose: the two pages are served by this same Worker, so every
// browser client is same-origin. Dropping the header restores the default
// same-origin policy instead of allowing any site to read the APIs.
app.onError((err, c) => {
  console.error("Worker error:", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

/* ---------------- Public ---------------- */

app.get("/", (c) => c.html(publicPage()));

// R2 images are served read-only under /img/
app.get("/img/*", async (c) => {
  let key: string;
  try {
    key = decodeURIComponent(new URL(c.req.url).pathname.slice("/img/".length));
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
  if (!/^images\/[0-9a-fA-F-]{36}\.(jpg|png|gif|webp)$/.test(key)) {
    return c.json({ error: "Not found" }, 404);
  }
  const obj = await c.env.IMG.get(key);
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});

app.get("/api/status", async (c) => {
  const owner = await c.env.DB.prepare(
    "SELECT last_checkin_at, state, expiry_hours FROM owner WHERE id = 1"
  ).first<{ last_checkin_at: number | null; state: string; expiry_hours: number }>();

  if (!owner || !owner.last_checkin_at) {
    return c.json({ hoursSinceCheckin: 0, state: "normal", level: "green", ratio: 0, cooldownSec: CHECKIN_COOLDOWN_SEC });
  }

  const hoursSince = Math.max(0, (Date.now() / 1000 - owner.last_checkin_at) / 3600);
  const ratio = owner.expiry_hours > 0 ? hoursSince / owner.expiry_hours : 0;

  let level: string;
  if (owner.state === "triggered") level = "dark";
  else if (owner.state === "warning") level = "red";
  else if (ratio >= 0.9) level = "red";
  else if (ratio >= 0.5) level = "yellow";
  else level = "green";

  return c.json({
    hoursSinceCheckin: Math.round(hoursSince * 10) / 10,
    state: owner.state,
    level,
    ratio: Math.round(ratio * 100) / 100,
    cooldownSec: CHECKIN_COOLDOWN_SEC,
  });
});

app.route("/api/auth", auth);

// Manual cron trigger, guarded by a shared secret
app.post("/__cron", async (c) => {
  if (!c.env.CRON_SECRET || c.req.header("X-Cron-Secret") !== c.env.CRON_SECRET) {
    return c.json({ error: "Not found" }, 404);
  }
  await handleCron(c.env);
  return c.json({ ok: true });
});

/* ---------------- Protected ---------------- */

app.use("/api/checkin/*", requireAuth);
app.use("/api/recipients", requireAuth);
app.use("/api/recipients/*", requireAuth);
app.use("/api/settings", requireAuth);
app.use("/api/settings/*", requireAuth);
app.use("/api/reset", requireAuth);

app.route("/api/checkin", checkinRoutes);
app.route("/api/recipients", recipientsRoutes);

app.get("/api/settings", async (c) => {
  const owner = await c.env.DB.prepare(
    "SELECT timezone, expiry_hours, warning_hours, last_checkin_at, state FROM owner WHERE id = 1"
  ).first();
  return c.json(owner ?? {});
});

app.put("/api/settings", async (c) => {
  const body = await c.req.json<{ timezone?: unknown; expiry_hours?: unknown; warning_hours?: unknown }>();
  const tz = typeof body.timezone === "string" ? body.timezone.trim() : "";
  if (!isValidTimeZone(tz)) return c.json({ error: "Invalid IANA timezone" }, 400);

  const expiry = Number(body.expiry_hours);
  const warning = Number(body.warning_hours);
  if (!Number.isInteger(expiry) || expiry < 1 || expiry > 8760) {
    return c.json({ error: "expiry_hours must be an integer between 1 and 8760" }, 400);
  }
  if (!Number.isInteger(warning) || warning < 1 || warning > 8760) {
    return c.json({ error: "warning_hours must be an integer between 1 and 8760" }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE owner SET timezone = ?, expiry_hours = ?, warning_hours = ? WHERE id = 1"
  ).bind(tz, expiry, warning).run();

  return c.json({ message: "Settings saved" });
});

app.post("/api/reset", async (c) => {
  const result = await handleReset(c.env);
  if (!result.success) return c.json({ error: result.error }, 400);
  return c.json({ message: "Reset successful" });
});

/* ---------------- Pages ---------------- */

app.get("/admin", (c) => c.html(adminPage()));

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => {
    // scheduled handlers bypass the fetch onError path — log failures here so
    // cron errors show up in tail output instead of vanishing.
    ctx.waitUntil(handleCron(env).catch((err) => console.error("[cron] scheduled run failed:", err)));
  },
};
