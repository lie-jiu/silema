import type { FC } from "hono/jsx";
import { Notice } from "../ui/kit";
import { Shell } from "../ui/shell";

export function LoginPage(props: {
  error?: string;
  reason?: string;
  next?: string;
  username?: string;
  fragment?: boolean;
}): ReturnType<FC> {
  const form = (
    <div id="login-form" class="px-6 pt-8 pb-10"><div class="pt-safe"></div>
      <header class="text-center mb-8 rise" style={{ "--i": "0" }}>
        <div class="ecg mb-6"></div>
        <div class="micro mb-2.5">SILEMA · CONSOLE</div>
        <h1 class="text-num font-semibold tracking-tight">死了吗</h1>
        <p class="mt-2 text-label opacity-55">每日确认系统 · 后台管理</p>
      </header>

      {props.reason === "expired" ? (
        <div class="mb-4 rise" style={{ "--i": "1" }}>
          <Notice tone="warn" title="会话已结束">
            登录已过期，或在其他设备登录（本站是单会话）。
          </Notice>
        </div>
      ) : null}
      {props.error ? (
        <div class="mb-4 rise" style={{ "--i": "1" }}>
          <Notice tone="danger" title="登录失败">
            {props.error}
          </Notice>
        </div>
      ) : null}

      <form hx-post="/api/auth/login" hx-target="#login-form" hx-swap="outerHTML" class="flex flex-col gap-4 rise" style={{ "--i": "2" }} novalidate>
        <input type="hidden" name="next" value={props.next ?? "/admin"} />

        <div>
          <label for="f-username" class="flex items-baseline gap-1 micro mb-1.5">
            用户名<span class="text-danger">*</span>
          </label>
          <input
            id="f-username"
            name="username"
            type="text"
            value={props.username ?? ""}
            autocomplete="username"
            autocapitalize="none"
            class="field"
          />
        </div>

        <div>
          <div class="flex items-baseline justify-between mb-1.5">
            <label for="f-password" class="micro">
              密码<span class="text-danger">*</span>
            </label>
            <button type="button" data-reveal="f-password" class="text-label text-primary opacity-80 px-1">
              显示
            </button>
          </div>
          <input id="f-password" name="password" type="password" autocomplete="current-password" class="field" />
          <div class="mt-1.5 text-label opacity-55">凭据存在 Workers Secret，不在数据库里</div>
        </div>

        <div>
          <div class="flex items-baseline justify-between mb-1.5">
            <label for="f-totpCode" class="micro">
              验证码<span class="text-danger">*</span>
            </label>
            <span class="text-label opacity-55">30s 刷新 · 同码不可复用</span>
          </div>
          <input
            id="f-totpCode"
            name="totpCode"
            type="text"
            inputmode="numeric"
            maxlength={10}
            autocomplete="one-time-code"
            autocapitalize="none"
            placeholder="——————"
            class="field readout tracking-[0.32em] text-center"
          />
          <details class="mt-2.5">
            <summary class="text-label opacity-75 cursor-pointer py-2 min-h-11 select-none">用恢复码登录</summary>
            <div class="mt-1">
              <Notice tone="info">
                同一个框也接受恢复码（形如 <code class="readout">ABCDE-FGHIJ</code>）。每个恢复码只能用一次，用掉就少一个。
              </Notice>
            </div>
          </details>
        </div>

        <button type="submit" class="btn btn-primary w-full mt-3">
          <span class="btn-spinner" aria-hidden="true"></span>
          登录
        </button>
      </form>

      <div class="mt-8 pt-5 border-t border-ink/8 text-center">
        <div class="micro mb-2">TOTP 设备丢失</div>
        <p class="text-label opacity-55 leading-relaxed">
          先用恢复码登录；恢复码也用尽时，在部署机执行
          <code class="block mt-2 readout text-label opacity-85 break-all select-all">
            node scripts/init-owner.cjs --remote --reset-totp
          </code>
        </p>
      </div>
    </div>
  );

  if (props.fragment) return form;
  return (
    <Shell title="登录 · 死了吗" shell="admin" htmx noStore bare scripts={["/assets/dialog.js"]}>
      {form}
    </Shell>
  );
}
