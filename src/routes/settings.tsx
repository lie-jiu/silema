import type { Child } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { OwnerRow } from "../lib/db";
import type { Health } from "../lib/health";
import { fmtClock } from "../lib/time";
import { Card, ConfirmDialog, Label, Led, Notice, OpenDialog, Stat } from "../ui/kit";
import { Shell, type Flash } from "../ui/shell";

const COMMON_TZ = [
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

function Row(props: { title: string; sub?: Child; href?: string; trailing?: Child }): ReturnType<FC> {
  const inner = (
    <>
      <span class="flex-1 min-w-0">
        <span class="block text-body font-semibold">{props.title}</span>
        {props.sub ? <span class="block text-label opacity-55 mt-0.5">{props.sub}</span> : null}
      </span>
      {props.trailing ?? (props.href ? <Chevron /> : null)}
    </>
  );
  if (props.href)
    return (
      <a href={props.href} class="row active:bg-ink/3">
        {inner}
      </a>
    );
  return <div class="row">{inner}</div>;
}

function Chevron(): ReturnType<FC> {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" class="opacity-30 shrink-0">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function SettingsPage(props: {
  owner: OwnerRow;
  health: Health;
  flash?: Flash;
  site: string;
  now: number;
}): ReturnType<FC> {
  const o = props.owner;
  const tzOptions = [...new Set([...COMMON_TZ, o.timezone])];
  return (
    <Shell title="设置" shell="admin" tab="settings" htmx navTitle="设置" flash={props.flash} scripts={["/assets/dialog.js"]}>
      <div class="p-4 flex flex-col gap-3.5">
        <Card class="rise">
          <Label>时区</Label>
          <form hx-post="/api/settings" hx-target="#tz-result" hx-swap="innerHTML settle:240ms" hx-trigger="change">
            {/* 原生 <select>：iOS/Android 都调起系统选择器，比自绘 wheel 更贴合平台习惯 */}
            <select name="timezone" class="field readout text-body">
              {tzOptions.map((tz) => (
                <option value={tz} selected={tz === o.timezone}>
                  {tz}
                </option>
              ))}
            </select>
            <div id="tz-result" class="mt-2 text-label"></div>
            <div class="mt-3">
              <Notice tone="warn" title="改这里不会改提醒时间">
                任务时刻固定为北京 12:00，由部署配置（wrangler.jsonc 的 cron）决定：这一次运行<b>先判定上一周期</b>
                （不发任何消息，只作废已到期的当日链接），<b>再发出今天唯一的那条</b>。当日链接另按墙钟 24:00 到期。
                时区只影响消息与页面里的时间显示。
              </Notice>
            </div>
          </form>
        </Card>

        <Card flush class="rise">
          <Row
            title="巡检健康"
            sub={
              <span class="readout">
                send {short(o.last_send_at, props.now)} · judge {short(o.last_judge_at, props.now)}
              </span>
            }
            href="/admin/health"
            trailing={
              <span class={`flex items-center gap-2 text-label font-semibold ${props.health.bad ? "text-danger" : "text-ok"}`}>
                <Led tone={props.health.bad ? "danger" : "ok"} live={!props.health.bad} />
                {props.health.summary}
              </span>
            }
          />
          <Row title="账号安全" sub="恢复码 · 会话 · TOTP 恢复" href="/admin/security" />
          <Row title="接收人" sub="通知通道与三类消息文案" href="/admin/recipients" />
        </Card>

        <Card class="rise">
          <Label>只读信息</Label>
          <dl class="flex flex-col text-label">
            <Spec k="状态">
              <span class={`font-semibold ${o.state === "locked" ? "text-danger" : "text-ok"}`}>
                {o.state === "locked" ? "LOCKED 已锁死" : "NORMAL 正常"}
              </span>
            </Spec>
            <Spec k="站点地址">
              <span class="readout break-all">{props.site}</span>
            </Spec>
            <Spec k="会话">
              <span class="readout">httpOnly cookie · 12h · 单会话</span>
            </Spec>
            <Spec k="版本">
              <span class="readout">0.1.0</span>
            </Spec>
          </dl>
        </Card>

        <form hx-post="/api/auth/logout" class="pb-2 rise">
          <button type="submit" class="btn btn-flat w-full">
            退出登录
          </button>
        </form>
      </div>
    </Shell>
  );
}

function Spec(props: { k: string; children: Child }): ReturnType<FC> {
  return (
    <div class="flex items-start justify-between gap-4 py-2 border-b border-ink/5 last:border-0">
      <dt class="opacity-55 shrink-0">{props.k}</dt>
      <dd class="text-right min-w-0">{props.children}</dd>
    </div>
  );
}

function short(ms: number | null, now: number): string {
  if (ms == null) return "从未";
  const h = Math.round((now - ms) / 3_600_000);
  if (h < 1) return "刚刚";
  if (h < 48) return `${h}h 前`;
  return `${Math.round(h / 24)}d 前`;
}

export function SecurityPage(props: {
  owner: OwnerRow;
  flash?: Flash;
  codes?: string[] | null;
  sessionExpiresAt: number | null;
  now: number;
  remainingCodes: number;
}): ReturnType<FC> {
  const o = props.owner;
  const left = props.sessionExpiresAt == null ? null : Math.max(0, props.sessionExpiresAt - props.now);
  const exhausted = props.remainingCodes === 0;
  return (
    <Shell
      title="账号安全"
      shell="admin"
      tab="settings"
      htmx
      navTitle="账号安全"
      backHref="/admin/settings"
      flash={props.flash}
      scripts={["/assets/dialog.js"]}
    >
      <div class="p-4 flex flex-col gap-3.5">
        <Card ticks class="rise">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1">
              <Label>恢复码</Label>
              <div class="text-label opacity-60 leading-relaxed">
                TOTP 设备丢失时，用任一未使用的恢复码在登录框直接登录；每个码只能用一次。
              </div>
            </div>
            <div class="text-right shrink-0">
              <Stat
                value={
                  <>
                    {props.remainingCodes}
                    <span class="text-label font-normal opacity-45"> /10</span>
                  </>
                }
                label="REMAINING"
                tone={exhausted ? "danger" : undefined}
              />
            </div>
          </div>
          {exhausted ? (
            <div class="mt-3.5">
              <Notice tone="danger" title="恢复码已用尽">
                现在只剩一条路：<code class="readout">--reset-totp</code>。建议现在就生成一批新的。
              </Notice>
            </div>
          ) : null}
          <div class="mt-4">
            <OpenDialog target="gen-codes">生成新的恢复码</OpenDialog>
          </div>
          <div data-backup-slot class="mt-3.5">
            {props.codes ? (
              <div>
                <div class="mb-2.5">
                  <Notice tone="danger" title="明文只显示这一次，现在就存好">
                    关闭后就再也看不到；系统只保存哈希，且旧的一批已全部失效。
                  </Notice>
                </div>
                <ul data-codes class="grid grid-cols-2 gap-2">
                  {props.codes.map((c) => (
                    <li class="px-2.5 py-2 rounded-field bg-ink/4 border border-ink/6 readout text-body text-center select-all">
                      {c}
                    </li>
                  ))}
                </ul>
                <div class="mt-3">
                  <button type="button" data-copy-into="[data-codes]" class="btn btn-ghost w-full">
                    复制全部
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        <Card flush class="rise">
          <div class="row">
            <span class="flex-1">
              <span class="block text-body font-semibold">当前会话</span>
              <span class="block text-label opacity-55 mt-0.5">单会话：在其他设备登录会自动踢掉本机</span>
            </span>
            <span class="readout text-body tabular-nums shrink-0">
              {left == null ? "—" : `${Math.floor(left / 3_600_000)}h ${Math.floor((left % 3_600_000) / 60_000)}m`}
            </span>
          </div>
          <div class="row">
            <span class="flex-1">
              <span class="block text-body font-semibold text-danger">注销所有设备</span>
              <span class="block text-label opacity-55 mt-0.5">包括本机，需要重新用密码 + 验证码登录</span>
            </span>
            <OpenDialog target="logout-all" class="btn btn-danger h-9 px-3.5 text-label">
              注销
            </OpenDialog>
          </div>
        </Card>

        <details class="panel px-4 py-1 rise">
          <summary class="flex items-center gap-2 py-3 min-h-12 cursor-pointer text-body font-semibold select-none">
            TOTP 设备丢了怎么办
            <span class="ml-auto text-label opacity-45">两级恢复</span>
          </summary>
          <div class="pb-3.5 flex flex-col gap-2.5">
            <Notice tone="info" title="① 首选：用恢复码登录">
              登录页的验证码框同样接受恢复码；用掉一个即刻少一个，登录后回到这里重新生成一批。
            </Notice>
            <Notice tone="warn" title="② 恢复码也没了：重置 TOTP">
              在部署机执行，会覆盖 <code class="readout">totp_secret</code>、清空恢复码并递增{" "}
              <code class="readout">session_epoch</code>，不碰任何业务状态。
              <pre class="mt-2 p-2.5 rounded-field bg-ink/4 border border-ink/6 readout text-label whitespace-pre-wrap break-all select-all">
                node scripts/init-owner.cjs --remote --reset-totp
              </pre>
            </Notice>
            <Notice tone="neutral">这两条路径都没有，就只能等系统按缺席节奏锁死。</Notice>
          </div>
        </details>

        <Card class="rise">
          <Label>凭据存放</Label>
          <div class="text-label opacity-60 leading-relaxed">
            登录用户名、口令哈希与会话签名密钥存在 Workers Secret，不在数据库里；恢复码只存 SHA-256 哈希。
          </div>
        </Card>

        <ConfirmDialog
          id="gen-codes"
          title="生成新的恢复码？"
          tone="primary"
          confirmText="生成"
          body="会使现有全部恢复码失效（包括没用完的那些），并生成 10 个新码。"
          post="/api/auth/backup-codes"
          target="[data-backup-slot]"
          go="/admin/security?flash=rotated"
        />
        <ConfirmDialog
          id="logout-all"
          title="注销所有设备？"
          confirmText="注销"
          body="会让包括本机在内的所有登录失效，需要重新用密码 + 验证码登录。"
          post="/api/auth/logout-all"
          go="/admin/login?reason=logout"
        />
      </div>
    </Shell>
  );
}
