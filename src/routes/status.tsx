import type { Child, FC } from "hono/jsx";

import { LOCK_AT } from "../lib/cron";
import { checkedThisCycle, type OwnerRow } from "../lib/db";
import { fmtDate } from "../lib/time";
import { Led, Notice, Stat } from "../ui/kit";
import { Shell } from "../ui/shell";

/**
 * 公开状态页（README 端点表 `GET /`）。受众包含潜在攻击者，所以这一页只陈述状态，
 * 不解释机制：发送时刻、令牌一次性、消费语义、解除路径一律不出现——连注释与 aria-label 也不行，
 * `view-source:` 是公开面。给联系人的机制说明在私发的最终消息里。
 */
export function StatusPage({ owner }: { owner: OwnerRow | null }): ReturnType<FC> {
  return (
    <Shell title="死了吗 · 公开状态" shell="public">
      {owner == null ? <Uninitialized /> : ScreenOf(owner)}
    </Shell>
  );
}

/**
 * 分支顺序即优先级：未初始化由调用方拦下，剩下四态互斥。
 * 「刚解除」必须排在「今日已确认」之前——恢复那一次签到同样会让 checkedToday 为真，
 * 只看到「今天已确认」的联系人会以为自己收到的告警是误报。
 */
function ScreenOf(o: OwnerRow): Child {
  if (o.state === "locked") return <Locked o={o} />;
  if (o.final_sent_at != null && o.streak <= 1) return <Recovered o={o} />;
  return checkedThisCycle(o) ? <Checked o={o} /> : <Pending o={o} />;
}

/** 走线：这页的全部意义就是这条线有没有断。live=扫描、无 class=静止、flat=断线。 */
function Pulse({ live, flat, dim }: { live?: boolean; flat?: boolean; dim?: boolean }): ReturnType<FC> {
  return (
    <div
      class={`ecg ${live ? "ecg-live" : ""} ${flat ? "ecg-flat" : ""} ${dim ? "opacity-40" : ""} mb-8 rise`}
      style={{ "--i": "0" }}
      aria-hidden="true"
    ></div>
  );
}

/** 两格读数条：卡片下沿的公开字段一律只到日期粒度。 */
function Readouts({ cells }: { cells: Array<{ label: string; value: string; class?: string }> }): ReturnType<FC> {
  return (
    <div class="mt-4 pt-4 border-t border-ink/8 flex">
      {cells.map((c, i) => (
        <div key={c.label} class="flex-1 flex items-center">
          {i > 0 ? <div class="w-px h-full bg-ink/8 -ml-px" aria-hidden="true"></div> : null}
          <div class="flex-1 text-center py-0.5">
            <div class="micro mb-1.5">{c.label}</div>
            <div class={`readout text-body font-semibold ${c.class ?? ""}`}>{c.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 居中式的容器必须自带顶部安全区：内容超过一屏时居中式会退化成贴顶，走线会被状态栏压掉。 */
function Board({ children, footer }: { children: Child; footer?: string }): ReturnType<FC> {
  return (
    <div class="flex flex-col min-h-screen px-6 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
      <div class="flex-1 flex items-center">
        <div class="w-full">{children}</div>
      </div>
      <footer class="pb-safe pb-7 text-center">
        {footer ? <div class="text-label opacity-55">{footer}</div> : null}
      </footer>
    </div>
  );
}

function Checked({ o }: { o: OwnerRow }): ReturnType<FC> {
  return (
    <Board footer="本页只给日期，不给精确时刻">
      <Pulse live />
      <div class="text-center rise" style={{ "--i": "1" }}>
        <div class="micro mb-2">SILEMA · 公开状态</div>
        <h1 class="text-num font-semibold tracking-tight">今天已确认</h1>
      </div>
      <div class="mt-7 panel p-4 rise" style={{ "--i": "2" }}>
        <div class="flex items-end justify-between gap-3">
          <Stat value={o.streak} label="DAY STREAK" tone="ok" display />
          <Led tone="ok" live label="正常" />
        </div>
        <Readouts
          cells={[
            { label: "上次确认", value: fmtDate(o.timezone, o.last_checkin_at!) },
            { label: "今日确认", value: "已完成", class: "text-ok" },
          ]}
        />
      </div>
    </Board>
  );
}

function Pending({ o }: { o: OwnerRow }): ReturnType<FC> {
  return (
    <Board footer={o.last_checkin_at == null ? "尚无确认记录" : `上次确认 ${fmtDate(o.timezone, o.last_checkin_at)}`}>
      <Pulse />
      <div class="text-center rise" style={{ "--i": "1" }}>
        <div class="micro mb-2">SILEMA · 公开状态</div>
        <h1 class="text-num font-semibold tracking-tight">今天还没确认</h1>
      </div>
      <div class="mt-7 panel p-4 rise" style={{ "--i": "2" }}>
        <div class="flex items-end justify-between gap-3">
          <Stat value={o.streak} label="DAY STREAK" display />
          <Led tone="warn" label="待确认" />
        </div>
        <div class="mt-4">
          <Notice tone="warn">系统正常，今天还没记到确认。</Notice>
        </div>
      </div>
      {/* 否定式边界：解决「访客在页面上找按钮」，同时不解释任何机制 */}
      <div class="mt-5 text-center text-label leading-relaxed opacity-60 rise" style={{ "--i": "3" }}>
        这一页只显示状态，不能用来完成确认。
      </div>
    </Board>
  );
}

function Locked({ o }: { o: OwnerRow }): ReturnType<FC> {
  const missed = Math.max(1, Math.min(o.missed_streak || LOCK_AT, LOCK_AT));
  return (
    <Board footer="本页只给日期，不给精确时刻">
      <Pulse flat />
      <div class="text-center rise" style={{ "--i": "1" }}>
        <div class="micro mb-2 text-danger">LOCKDOWN</div>
        <h1 class="text-num font-semibold tracking-tight text-danger">系统已锁死</h1>
      </div>
      <div class="mt-7 panel panel-alert p-4 rise" style={{ "--i": "2" }}>
        <div class="flex items-end justify-between gap-3">
          <Stat value={missed} label="连续缺席天数" tone="danger" display />
          <span class="inline-flex items-center gap-2 text-danger">
            <span class="led"></span>
            <span class="readout text-label">
              {missed}/{LOCK_AT}
            </span>
          </span>
        </div>
        <Readouts
          cells={[
            { label: "最后确认", value: o.last_checkin_at == null ? "—" : fmtDate(o.timezone, o.last_checkin_at) },
            { label: "锁死于", value: o.locked_at == null ? "—" : fmtDate(o.timezone, o.locked_at), class: "text-danger" },
          ]}
        />
      </div>
      <div class="mt-4 rise" style={{ "--i": "3" }}>
        <Notice tone="danger" title="最终消息已发出">
          不可撤回。恢复只能由 TA 本人完成。
        </Notice>
      </div>
      <div class="mt-7 rise" style={{ "--i": "4" }}>
        <a href="/help" class="btn btn-ghost w-full">
          我能帮什么
        </a>
      </div>
    </Board>
  );
}

function Recovered({ o }: { o: OwnerRow }): ReturnType<FC> {
  return (
    <Board footer="本页只给日期，不给精确时刻">
      <Pulse live />
      <div class="text-center rise" style={{ "--i": "1" }}>
        <div class="micro mb-2 text-primary-ink">RECOVERED</div>
        <h1 class="text-num font-semibold tracking-tight">锁定已解除</h1>
      </div>
      <div class="mt-7 rise" style={{ "--i": "2" }}>
        <Notice tone="info" title="TA 已自行恢复">
          系统已回到正常周期。此前那条最终消息不会自动撤回。
        </Notice>
      </div>
      <div class="mt-4 panel p-4 rise" style={{ "--i": "3" }}>
        <Readouts
          cells={[
            { label: "解除于", value: o.last_checkin_at == null ? "—" : fmtDate(o.timezone, o.last_checkin_at) },
            { label: "当前连续", value: `${o.streak} 天`, class: "text-primary-ink" },
          ]}
        />
      </div>
    </Board>
  );
}

function Uninitialized(): ReturnType<FC> {
  return (
    <Board>
      <div class="text-center">
        <Pulse dim />
        <div class="micro mb-2">SILEMA · 公开状态</div>
        <h1 class="text-num font-semibold tracking-tight">系统尚未初始化</h1>
        <div class="mt-6 text-left">
          <Notice tone="neutral">
            还没有 owner 记录，因此不存在任何确认周期。部署完成初始化后，这一页会自动变为正常状态。
          </Notice>
        </div>
      </div>
    </Board>
  );
}

/**
 * 锁死屏的 L2：只告诉联系人「用你自己的方式联系 TA」并把机制指回私发消息。
 * 静态页，不读 owner——它不需要知道任何状态，也就没有任何可泄露的。
 */
export function LockGuidePage(): ReturnType<FC> {
  const dos = [
    "直接用你手上的方式联系 TA：电话、上门、共同好友。",
    "如果联系上了，把「系统已经发出最终消息」这件事直接告诉 TA。",
    "你收到的那条消息里已经写了该怎么做，以它为准——这一页不重复它的说明。",
  ];
  const donts = [
    "不要指望在这个页面上替 TA 做什么：它只显示状态，没有任何能改变状态的操作。",
    "不要对外转发那一页的截图：它只反映某一刻的状态，隔天再打开就不是这样了。",
    "不要把它当成误报：锁死的唯一原因是连续缺席达到了阈值。",
  ];
  return (
    <Shell title="死了吗 · 锁死是什么意思" shell="admin" navTitle="锁死是什么意思" backHref="/">
      <div class="p-4">
        <div class="rise" style={{ "--i": "1" }}>
          <div class="panel p-4">
            <div class="rule micro mb-3">现在就做</div>
            <ul class="space-y-2.5 text-label leading-relaxed">
              {dos.map((t) => (
                <li key={t} class="flex gap-2">
                  <span class="text-ok shrink-0">✓</span>
                  <span class="text-ink/80">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div class="mt-4 rise" style={{ "--i": "2" }}>
          <div class="panel p-4">
            <div class="rule micro mb-3">不要做</div>
            <ul class="space-y-2.5 text-label leading-relaxed">
              {donts.map((t) => (
                <li key={t} class="flex gap-2">
                  <span class="text-danger shrink-0">×</span>
                  <span class="text-ink/80">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div class="mt-4 rise" style={{ "--i": "3" }}>
          <Notice tone="info">
            这套机制的设计前提是「没人能替我确认我还活着」。所以那里没有按钮、没有表单，只有状态。
          </Notice>
        </div>
      </div>
    </Shell>
  );
}
