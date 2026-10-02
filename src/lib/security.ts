import type { Context, MiddlewareHandler } from "hono";

import { getOwner, type OwnerRow } from "./db";
import { getCookie } from "hono/cookie";
import { readSession, SESSION_COOKIE } from "./session";
import type { Env } from "./send";

/** 三者任一缺失 → 一律 503，绝不放行（docs/backend.md §5）。 */
export function missingSecrets(env: Env): string[] {
  return ["ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "SESSION_SECRET"].filter((k) => !env[k as keyof Env]);
}

export function securityHeaders(c: Context, extra: Record<string, string> = {}): void {
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  c.header("X-Content-Type-Options", "nosniff");
  // 不用 no-referrer：那会把 csrfGuard 的 Referer 兜底整个抹掉（Origin 在 iOS WebKit 的同源表单 POST 上也不发）。
  // strict-origin-when-cross-origin 是各浏览器的默认值：跨站只带站点根、**路径永远不外泄**，
  // 所以签到链接里的令牌不会跟着 Referer 出去；只有同源请求带完整 URL，而那是发给我们自己的。
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  for (const [k, v] of Object.entries(extra)) c.header(k, v);
}

function sameOrigin(c: Context): boolean {
  const origin = c.req.header("Origin") ?? c.req.header("Referer");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

/**
 * CSRF：cookie 是 SameSite=Lax（跨站 POST 根本不带 cookie），再叠一层「这个请求确实来自本站」的判定。
 *
 * 判定按可靠性从高到低取任一成立即可：
 * 1. `Sec-Fetch-Site: same-origin` —— 浏览器给真实发起的导航/请求打的标，跨站表单永远拿不到 same-origin。
 * 2. `HX-Request` —— htmx 自动带，跨站 HTML 表单无法设置自定义头。
 * 3. `Origin` 同源 —— **iOS WebKit（含微信内置浏览器）对同源的表单导航 POST 不发 Origin**，不能只靠它。
 * 4. `Referer` 同源 —— 只有在 Referrer-Policy 允许同源带路径时才有值（见 securityHeaders）。
 */
export function csrfGuard(c: Context): string | null {
  if (c.req.header("Sec-Fetch-Site") === "same-origin") return null;
  if (c.req.header("HX-Request") === "true") return null;
  if (sameOrigin(c)) return null;
  return "请求缺少同源校验，请刷新页面后重试";
}

export type AuthedContext = { owner: OwnerRow };

/**
 * 会话失效统一拦截（docs/mobile-ui.md §3 Screen 3）：页面请求 302 到登录页，
 * htmx 片段请求回 `HX-Redirect` 头——返回 401 JSON 的话 htmx 会静默忽略，
 * 用户看到的是「点了没反应」，内容永远不更新。
 */
export function requireAuth(): MiddlewareHandler<{ Bindings: Env; Variables: AuthedContext }> {
  return async (c, next) => {
    const env = c.env;
    const missing = missingSecrets(env);
    if (missing.length > 0) {
      return c.text(`服务未正确配置，缺少 ${missing.join(" / ")}`, 503);
    }
    const payload = await readSession(env.SESSION_SECRET!, getCookie(c, SESSION_COOKIE));
    const owner = await getOwner(env.DB);
    if (!payload || !owner || payload.e !== owner.session_epoch) {
      if (wantsHtmx(c)) {
        c.header("HX-Redirect", `/admin/login?reason=expired`);
        return c.body(null, 204);
      }
      const next = encodeURIComponent(c.req.path);
      return c.redirect(`/admin/login?next=${next}&reason=expired`, 302);
    }
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const csrf = csrfGuard(c);
      if (csrf) return c.text(csrf, 403);
    }
    c.set("owner", owner);
    await next();
  };
}

export function wantsHtmx(c: Context): boolean {
  return c.req.header("HX-Request") === "true";
}
