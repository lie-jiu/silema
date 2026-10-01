import type { Child } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { CheckinView } from "../lib/checkin";
import type { OwnerRow } from "../lib/db";
import { fmtClock, fmtExpiryTime } from "../lib/time";
import { Notice, Result } from "../ui/kit";
import { Shell } from "../ui/shell";

type StageProps = {
  view: CheckinView;
  site: string;
  /** 长按成功后的服务端回显（locked 恢复走另一套文案） */
  done?: { streak: number; wasLocked: boolean };
  error?: string;
  /** `purpose='test'` 的链接：确认成功但绝不记为签到，必须与真实签到态区分开 */
  test?: boolean;
  /** htmx 片段请求只要这一坨，页面请求要整套 Shell */
  fragment?: boolean;
};

export function CheckinPage(props: StageProps): ReturnType<FC> {
  // display:contents 的包装层只为 htmx 提供 swap 锚点，不影响布局；片段与整页共用
  const stage = <div id="checkin-stage" class="contents">{Stage(props)}</div>;
  if (props.fragment) return stage;
  return (
    <Shell title="死了吗 · 每日确认" shell="public" htmx noStore scripts={["/assets/hold-button.js"]}>
      {stage}
    </Shell>
  );
}

function Stage(props: StageProps): ReturnType<FC> {
  const { view } = props;
  if (props.test) return <TestView />;
  if (props.done) return <DoneView streak={props.done.streak} wasLocked={props.done.wasLocked} owner={view.owner} />;
  if (props.error) return <ConfirmView {...props} token={{ token: "", expires_at: 0 }} error={props.error} />;
  if (view.kind === "checked") return <CheckedView owner={view.owner} />;
  if (view.kind === "invalid") return <InvalidView owner={view.owner} />;
  return <ConfirmView {...props} token={view.token} />;
}

/** 顶部的生命体征走线：这个产品的全部意义就在这条线有没有断。 */
function Pulse(props: { live?: boolean; class?: string }): ReturnType<FC> {
  return <div class={`ecg ${props.live ? "ecg-live" : ""} ${props.class ?? ""}`} aria-hidden="true"></div>;
}

function Readout(props: { label: string; value: Child; tone?: string }): ReturnType<FC> {
  return (
    <div class="flex-1 px-4 py-3 text-center">
      <div class="micro mb-1.5">{props.label}</div>
      <div class={`readout text-body font-semibold ${props.tone ?? ""}`}>{props.value}</div>
    </div>
  );
}

function ConfirmView(
  props: StageProps & { token: { token: string; expires_at: number; purpose?: string }; error?: string },
): ReturnType<FC> {
  const owner = props.view.owner;
  const last = owner.last_checkin_at;
  return (
    <div class="flex flex-col min-h-screen">
      <header class="pt-6 px-6 text-center rise" style={{ "--i": 0 }}>
        <Pulse live class="mb-6" />
        <div class="micro mb-2">SILEMA · 每日确认</div>
        <h1 class="text-num font-semibold tracking-tight">今天你还活着吗？</h1>
      </header>

      <div class="mx-6 mt-7 rise" style={{ "--i": 1 }}>
        <div class="panel flex divide-x divide-ink/8 p-0 overflow-hidden">
          <Readout label="上次确认" value={last == null ? "从未" : fmtClock(owner.timezone, last)} />
          <Readout
            label="已连续"
            value={
              <>
                <span class="text-num">{owner.streak}</span>
                <span class="text-label font-normal opacity-60"> 天</span>
              </>
            }
            tone={owner.streak > 0 ? "text-primary-ink" : "text-warn"}
          />
        </div>
      </div>

      {/* 大圆位于视口 55-65%：主 CTA 不能落在拇指盲区（P1-6） */}
      <div class="flex-1 flex flex-col items-center justify-center pt-[6vh] pb-4 rise" style={{ "--i": 2 }}>
        <button
          type="button"
          data-hold-post
          hx-post={`/c/${props.token.token}/do`}
          hx-target="#checkin-stage"
          hx-swap="outerHTML"
          hx-trigger="hold"
          hx-disabled-elt="this"
          class="dial-host"
          style={{ "--p": "0" }}
          aria-label="按住 0.6 秒确认今天还活着"
        >
          <span class="dial-ticks" aria-hidden="true"></span>
          <span class="dial" aria-hidden="true"></span>
          <span class="dial-face">
            <span class="text-sub font-semibold tracking-tight leading-tight">按住</span>
            <span class="text-sub font-semibold tracking-tight leading-tight">确认</span>
          </span>
        </button>
        <div class="mt-7 micro">HOLD 0.6s</div>
        <div class="mt-1 text-label opacity-55">按住不放，进度环走满即确认</div>

        {/* 无 JS 时仍可签到：原生 POST 返回整页 */}
        <noscript>
          <form method="post" action={`/c/${props.token.token}/do`} class="mt-6 w-full px-6">
            <button type="submit" class="btn btn-primary w-full">
              确认今天还活着
            </button>
          </form>
        </noscript>
      </div>

      <footer class="px-6 pb-safe pb-7 text-center rise" style={{ "--i": 3 }}>
        {props.token.purpose === "test" ? (
          <div class="mb-3 text-left">
            <Notice tone="warn">这是测试链接，按住确认不会记为今天的签到。</Notice>
          </div>
        ) : null}
        {props.error ? (
          <div class="mb-3 text-left">
            <Notice tone="danger" title="确认没有提交成功">
              {props.error}
            </Notice>
          </div>
        ) : null}
        <div class="flex items-center justify-center gap-2 text-label opacity-55">
          <span class="led bg-warn text-warn"></span>
          <span class="readout">链接今日 {fmtExpiryTime(owner.timezone, props.token.expires_at)} 失效</span>
        </div>
      </footer>
    </div>
  );
}

function DoneView(props: { streak: number; wasLocked: boolean; owner: OwnerRow }): ReturnType<FC> {
  return (
    <div class="flex flex-col min-h-screen px-6">
      <div class="flex-1 flex items-center">
        <div class="w-full">
          <Pulse live class="mb-8" />
          {props.wasLocked ? (
            <Result
              tone="warn"
              title="已恢复"
              desc="最终消息已发给紧急联系人，且不可撤回。锁定已解除，连续天数从今天重新计。"
            >
              <Stat value={props.streak} label="DAY STREAK" />
            </Result>
          ) : (
            <Result tone="ok" title="今天已确认" desc="明天 12:00 会再给你一条链接。">
              <Stat value={props.streak} label="DAY STREAK" display tone="ok" />
            </Result>
          )}
        </div>
      </div>
      <footer class="pb-safe pb-7 text-center micro">可以直接关掉这个页面</footer>
    </div>
  );
}

function Stat(props: { value: Child; label: string; tone?: "ok"; display?: boolean }): ReturnType<FC> {
  return (
    <div class="text-center">
      <div
        class={`readout roll font-semibold leading-none ${props.display ? "text-display" : "text-num"} ${
          props.tone === "ok" ? "text-ok" : "text-ink"
        }`}
      >
        {props.value}
      </div>
      <div class="mt-2 micro">{props.label}</div>
    </div>
  );
}

/** 「已使用」= 今天已经记到一次确认，系统是安全的，所以刻意不给任何按钮。 */
function CheckedView(props: { owner: OwnerRow }): ReturnType<FC> {
  const o = props.owner;
  return (
    <div class="flex flex-col min-h-screen px-6">
      <div class="flex-1 flex items-center">
        <div class="w-full">
          <Pulse class="mb-8" />
          <Result tone="ok" title="今日已确认" desc={`今天已经记到一次确认，系统是安全的。连续 ${o.streak} 天。`} />
        </div>
      </div>
      <footer class="pb-safe pb-7 text-center">
        <div class="micro mb-2">CONFIRMED AT</div>
        <div class="readout text-body opacity-70">
          {o.last_checkin_at == null ? "—" : fmtClock(o.timezone, o.last_checkin_at)}
        </div>
      </footer>
    </div>
  );
}

/** 「已失效」= 今天无从签到，必须给后台入口；与上一态绝不共用文案。 */
function InvalidView(props: { owner: OwnerRow }): ReturnType<FC> {
  return (
    <div class="flex flex-col min-h-screen px-6">
      <div class="flex-1 flex items-center">
        <div class="w-full">
          <Pulse class="mb-8" />
          <Result tone="danger" title="链接已失效" desc="这条链接只在当天有效。去后台可以重发今天的链接，或检查通知通道。">
            <a href="/admin" class="btn btn-ghost w-full">
              打开后台
            </a>
          </Result>
        </div>
      </div>
      <footer class="pb-safe pb-7"></footer>
    </div>
  );
}

/** 测试链接专用终态：绝不能长得像真签到，否则一次测试就把真实缺席掩盖掉了。 */
function TestView(): ReturnType<FC> {
  return (
    <div class="flex flex-col min-h-screen px-6">
      <div class="flex-1 flex items-center">
        <div class="w-full">
          <Pulse class="mb-8" />
          <Result tone="info" title="测试链接有效" desc="通道投递正常。这条是测试链接，点开不会记为今天的确认。">
            <Notice tone="warn">今天仍需通过 12:00 收到的那条链接来完成确认。</Notice>
          </Result>
        </div>
      </div>
      <footer class="pb-safe pb-7"></footer>
    </div>
  );
}
