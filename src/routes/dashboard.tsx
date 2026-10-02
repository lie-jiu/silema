import type { Child } from "hono/jsx";
import type { FC } from "hono/jsx";
import { checkedThisCycle, type OwnerRow } from "../lib/db";
import { LOCK_AT } from "../lib/cron";
import type { Health } from "../lib/health";
import { fmtClock, fmtTimeOnly } from "../lib/time";
import { Card, ConfirmDialog, Label, Led, MissedDots, Notice, OpenDialog, Skeleton, Stat } from "../ui/kit";
import { Shell, type Flash } from "../ui/shell";

export function DashboardPage(props: {
  owner: OwnerRow | null;
  health: Health;
  recipientCounts: { prompt: number; final: number };
  flash?: Flash;
  loading?: boolean;
  now: number;
}): ReturnType<FC> {
  if (props.loading || !props.owner) {
    return (
      <Shell title="死了吗 · 后台" shell="admin" tab="dashboard" htmx navTitle="死了吗 · 后台">
        <div class="p-4 flex flex-col gap-3">
          <Skeleton lines={2} />
          <Skeleton lines={3} />
        </div>
      </Shell>
    );
  }

  const o = props.owner;
  const checked = checkedThisCycle(o);
  const fresh = o.last_send_at == null && o.last_checkin_at == null && o.streak === 0;
  const locked = o.state === "locked";

  return (
    <Shell
      title="死了吗 · 后台"
      shell="admin"
      tab="dashboard"
      tabAlert={props.health.bad}
      htmx
      navTitle="死了吗 · 后台"
      flash={props.flash}
      scripts={["/assets/dialog.js"]}
      actions={
        <a
          href="/admin"
          aria-label="刷新"
          class="tap-target px-1 flex items-center justify-center text-ink/55 active:text-primary"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M20 11a8 8 0 1 0-.6 4M20 5v6h-6" />
          </svg>
        </a>
      }
    >
      <div class="p-4 flex flex-col gap-3.5">
        {/* 主读数面板 */}
        <Card ticks class="rise overflow-hidden !p-0" >
          <div class="px-5 pt-5 pb-4 flex items-start justify-between gap-4">
            <Stat value={o.streak} label="DAY STREAK" display tone={locked ? "danger" : checked ? "ok" : "warn"} />
            <div class="text-right">
              <Led
                tone={locked ? "danger" : checked ? "ok" : "warn"}
                live={!locked && checked}
                label={locked ? "LOCKED" : checked ? "今日已确认" : "今日待确认"}
              />
              <div class="mt-1.5 readout text-label opacity-55">
                {o.last_checkin_at == null ? "—" : fmtTimeOnly(o.timezone, o.last_checkin_at)}
              </div>
            </div>
          </div>
          <div class="h-px bg-gradient-to-r from-transparent via-ink/10 to-transparent"></div>
          <div class="px-5 py-4 flex flex-col gap-3">
            <MissedDots missed={o.missed_streak} total={LOCK_AT} locked={locked} />
            <div class="text-label opacity-55 leading-relaxed">
              {locked
                ? "锁死已触发，凭最终消息里的恢复链接签到即解除。"
                : o.missed_streak >= LOCK_AT - 1
                  ? "最后警告：今天 24:00 前不确认就是第 3 天缺席，次日 12:00 判定即锁死，第一条最终消息同刻发出。"
                  : `连续缺席满 ${LOCK_AT} 天，系统向紧急联系人发出最终消息。`}
            </div>
          </div>
        </Card>

        {locked ? (
          <Card tone="danger" class="rise" >
            <Label class="!mb-2">
              <span class="text-danger">LOCKDOWN</span>
            </Label>
            <div class="text-body leading-relaxed">
              {o.final_sent_at == null ? (
                <>
                  最终消息<span class="text-danger font-semibold">还没有送达</span>——第一条在锁死后的下一个
                  12:00 投出，之后每天 12:00 重试，直到至少一个「紧急联系人」通道成功。
                </>
              ) : o.final_second_at == null ? (
                <>
                  锁定于 <span class="readout">{fmtClock(o.timezone, o.locked_at ?? 0)}</span>，第一条已于{" "}
                  <span class="readout">{fmtClock(o.timezone, o.final_sent_at)}</span> 发出，不可撤回。
                  次日 12:00 还会再发最后一条，之后系统彻底静默。
                </>
              ) : (
                <>
                  锁定于 <span class="readout">{fmtClock(o.timezone, o.locked_at ?? 0)}</span>，两条最终消息已分别于{" "}
                  <span class="readout">{fmtClock(o.timezone, o.final_sent_at)}</span> 和{" "}
                  <span class="readout">{fmtClock(o.timezone, o.final_second_at)}</span> 发出，不可撤回。
                  <span class="text-danger">此后系统不再发送任何消息</span>，只能凭消息里的恢复链接签到解除。
                </>
              )}
            </div>
            {o.final_sent_at == null && props.recipientCounts.final === 0 ? (
              <div class="mt-3">
                <Notice tone="danger">当前没有任何「紧急联系人」通道，最终消息发给了空气。</Notice>
              </div>
            ) : null}
          </Card>
        ) : null}

        {props.health.send.level === "error" || props.health.send.level === "unknown" ? (
          <Card tone="danger" class="rise">
            <Label class="!mb-2">
              <span class="text-danger">今日链接未送达</span>
            </Label>
            <div class="text-body opacity-80">{props.health.send.note ?? "上次发送时刻异常"}</div>
            {o.last_cron_error ? (
              <pre class="mt-2.5 p-2.5 rounded-field bg-danger/6 border border-danger/15 readout text-label whitespace-pre-wrap break-all select-all">
                {o.last_cron_error}
              </pre>
            ) : null}
            <div class="mt-3.5">
              <OpenDialog target="resend-dialog">重发今日链接</OpenDialog>
            </div>
          </Card>
        ) : null}

        {fresh ? (
          <Card class="rise">
            <Label>初始化</Label>
            <div class="text-body opacity-80 leading-relaxed">还没有确认记录。今天 12:00 会发出第一条链接。</div>
            <div class="mt-3.5">
              <OpenDialog target="resend-dialog">立刻重发一次</OpenDialog>
            </div>
          </Card>
        ) : null}

        {/* 通道概览 */}
        <Card flush class="rise">
          <div class="row">
            <span class="flex-1">
              <span class="block text-body font-semibold">通道</span>
              <span class={`block text-label mt-0.5 ${props.recipientCounts.final === 0 ? "text-danger" : "opacity-55"}`}>
                {props.recipientCounts.final === 0
                  ? "还没有紧急联系人 · 锁死时没有人会收到最终消息"
                  : `日常提醒 ${props.recipientCounts.prompt} · 紧急联系人 ${props.recipientCounts.final}`}
              </span>
            </span>
            <a href="/admin/recipients" class="btn btn-flat h-9 px-3 text-label">
              管理
            </a>
          </div>
          <div class="row">
            <span class="flex-1">
              <span class="block text-body font-semibold">巡检健康</span>
              <span class="block text-label opacity-55 mt-0.5 readout">
                send {fmtAgo(o.last_send_at)} · judge {fmtAgo(o.last_judge_at)}
              </span>
            </span>
            <a
              href="/admin/health"
              class={`flex items-center gap-2 px-3 text-label font-semibold ${
                props.health.bad ? "text-danger" : "text-ok"
              }`}
            >
              <Led tone={props.health.bad ? "danger" : "ok"} live={!props.health.bad} />
              {props.health.summary}
            </a>
          </div>
        </Card>

        {/* 没有签到按钮必须被解释，否则用户以为功能坏了 */}
        <details class="panel px-4 py-1 rise">
          <summary class="flex items-center gap-2 py-3 min-h-12 cursor-pointer text-body font-semibold select-none">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" class="text-primary opacity-70">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5.5M12 7.8v.1" />
            </svg>
            本站不提供签到按钮
            <span class="ml-auto text-label opacity-45">为什么？</span>
          </summary>
          <div class="pb-3.5">
            <Notice tone="info">
              签到只能通过每天 12:00 发到你通道里的一次性链接完成。后台能改配置、能重发链接，但不能替自己签到——这样「已签到」才永远等价于「今天真的收到并点开了链接」。没收到链接时用「重发今日链接」，重发的仍是同一条临时链接。
            </Notice>
          </div>
        </details>
      </div>

      <ConfirmDialog
        id="resend-dialog"
        title="重发今日链接？"
        tone="primary"
        confirmText="重发"
        body={
          <>
            把当天那条链接原样再发一遍到所有「日常提醒」通道，<b>不换新链接</b>——已经收到过的人手里那条仍然有效。
            只有当天那条已过 24:00 到期时刻（或今天还没发出去）时才会铸一条新的。
            缺席期重发的也是那条「未确认提醒」，不是另加一条消息。锁定期这个按钮不可用。
          </>
        }
        post="/api/cron/resend"
        go="/admin?flash=resent"
      />
    </Shell>
  );
}

function fmtAgo(ms: number | null): Child {
  if (ms == null) return "从未";
  const h = Math.round((Date.now() - ms) / 3_600_000);
  if (h < 1) return "刚刚";
  if (h < 48) return `${h}h 前`;
  return `${Math.round(h / 24)}d 前`;
}
