import type { Child } from "hono/jsx";
import type { FC } from "hono/jsx";

export type Tone = "info" | "ok" | "warn" | "danger" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  info: "text-primary-ink",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  neutral: "text-ink",
};

const NOTICE_SKIN: Record<Tone, string> = {
  info: "border-primary/22 bg-primary/5",
  ok: "border-ok/25 bg-ok/6",
  warn: "border-warn/28 bg-warn/6",
  danger: "border-danger/28 bg-danger/6",
  neutral: "border-ink/10 bg-panel/70",
};

/** 常驻提示条：约束条 / 掩码说明 / 测试警示 / 健康规则说明共 5 处需要。 */
export function Notice(props: { tone?: Tone; title?: string; children: Child }): ReturnType<FC> {
  const tone = props.tone ?? "neutral";
  return (
    <div
      class={`relative pl-4 pr-3 py-2.5 rounded-field border text-label leading-relaxed ${NOTICE_SKIN[tone]} ${
        tone === "danger" ? "alert-flash" : ""
      }`}
      role={tone === "danger" ? "alert" : undefined}
    >
      <span
        class={`absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-current opacity-70 ${TONE_TEXT[tone]}`}
      ></span>
      {props.title ? (
        <div class={`font-semibold text-body mb-0.5 ${TONE_TEXT[tone]}`}>{props.title}</div>
      ) : null}
      <div class="text-ink/80">{props.children}</div>
    </div>
  );
}

/** 分区微型标签 + 向右延伸的刻线 */
export function Label(props: { children: Child; class?: string }): ReturnType<FC> {
  return <div class={`rule micro mb-3 ${props.class ?? ""}`}>{props.children}</div>;
}

export function Card(props: {
  children: Child;
  tone?: Tone;
  class?: string;
  ticks?: boolean;
  flush?: boolean;
}): ReturnType<FC> {
  const tone = props.tone ?? "neutral";
  return (
    <section
      class={`panel ${tone === "danger" ? "panel-alert" : ""} ${props.ticks ? "panel-ticks" : ""} ${
        props.flush ? "" : "p-4"
      } ${props.class ?? ""}`}
    >
      {props.children}
    </section>
  );
}

/** 仪表读数：数值永远比标签大，且等宽（P2-5 / P2-10） */
export function Stat(props: { value: Child; label: string; tone?: Tone; display?: boolean }): ReturnType<FC> {
  return (
    <div>
      <div
        class={`readout ${props.display ? "text-display" : "text-num"} font-semibold leading-none ${
          TONE_TEXT[props.tone ?? "neutral"]
        }`}
      >
        {props.value}
      </div>
      <div class="mt-2.5 micro">{props.label}</div>
    </div>
  );
}

export function Led(props: { tone: Tone; live?: boolean; label?: string }): ReturnType<FC> {
  return (
    <span class={`inline-flex items-center gap-2 ${TONE_TEXT[props.tone]}`}>
      <span class={`led ${props.live ? "led-live" : ""}`}></span>
      {props.label ? <span class="text-label font-semibold tracking-tight">{props.label}</span> : null}
    </span>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }): ReturnType<FC> {
  return (
    <section class="panel p-4" aria-busy="true">
      <div class="skeleton h-9 w-1/3"></div>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} class="skeleton h-3 mt-3" style={{ width: `${92 - i * 18}%` }}></div>
      ))}
    </section>
  );
}

/** 图标 + 标题 + 描述三段语义化标记；CTA 与占位块并排，不嵌套（P2-2）。 */
export function Result(props: { tone?: Tone; title: string; desc?: string; children?: Child }): ReturnType<FC> {
  const tone = props.tone ?? "info";
  return (
    <div class="py-4 px-2 text-center">
      <div class="relative mx-auto w-[78px] h-[78px]">
        <span class={`absolute inset-0 rounded-full bg-current opacity-[0.07] ${TONE_TEXT[tone]}`}></span>
        <span
          class={`absolute inset-[7px] rounded-full border border-current/25 bg-panel/75 flex items-center justify-center ${TONE_TEXT[tone]}`}
        >
          <Glyph tone={tone} />
        </span>
      </div>
      <h2 class="mt-6 text-num font-semibold tracking-tight">{props.title}</h2>
      {props.desc ? (
        <p class="mt-2.5 text-body opacity-75 leading-relaxed max-w-[300px] mx-auto">{props.desc}</p>
      ) : null}
      {props.children ? <div class="mt-7 flex flex-col gap-2.5 items-center">{props.children}</div> : null}
    </div>
  );
}

function Glyph({ tone }: { tone: Tone }): ReturnType<FC> {
  const p = {
    width: 30,
    height: 30,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (tone === "ok")
    return (
      <svg {...p}>
        <path d="M5 13l4 4L19 7" />
      </svg>
    );
  if (tone === "danger")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5v5.5M12 16.4v.1" />
      </svg>
    );
  if (tone === "warn")
    return (
      <svg {...p}>
        <path d="M12 4 3 19.5h18z" />
        <path d="M12 10v4M12 16.6v.1" />
      </svg>
    );
  return (
    <svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11.5v5M12 8.2v.1" />
    </svg>
  );
}

export function Button(props: {
  href?: string;
  variant?: "primary" | "outlined" | "danger" | "text";
  submit?: boolean;
  post?: string;
  disabled?: boolean;
  target?: string;
  swap?: string;
  loading?: boolean;
  children: Child;
  class?: string;
}): ReturnType<FC> {
  const v = props.variant ?? "primary";
  const skin =
    v === "primary" ? "btn-primary" : v === "danger" ? "btn-danger" : v === "outlined" ? "btn-ghost" : "btn-flat";
  const cls = `btn ${skin} ${props.class ?? ""}`;
  const inner = (
    <>
      {props.loading ? <span class="btn-spinner" aria-hidden="true"></span> : null}
      {props.children}
    </>
  );
  if (props.href)
    return (
      <a href={props.href} class={cls}>
        {inner}
      </a>
    );
  return (
    <button
      class={cls}
      type={props.submit ? "submit" : "button"}
      disabled={props.disabled}
      hx-post={props.post}
      hx-target={props.target}
      hx-swap={props.swap}
    >
      {inner}
    </button>
  );
}

/** 缺席进度：每段一天，最后一段（锁死阈值）转红。段数由调用方传入 LOCK_AT，避免前后端各写一个魔法数。 */
export function MissedDots({ missed, total, locked }: { missed: number; total: number; locked?: boolean }): ReturnType<FC> {
  return (
    <div class="flex items-center gap-3">
      <div class="flex gap-1.5 flex-1" role="img" aria-label={`连续缺席 ${missed} 天，满 ${total} 天锁死`}>
        {Array.from({ length: total }, (_, i) => i + 1).map((i) => (
          <span
            key={i}
            class={`h-1.5 flex-1 rounded-full transition-colors ${
              i > missed ? "bg-ink/10" : i >= total ? "bg-danger" : "bg-warn"
            }`}
          ></span>
        ))}
      </div>
      <span class="readout text-label opacity-55 whitespace-nowrap">{missed}/{total}</span>
      {locked ? <span class="micro text-danger">LOCKED</span> : null}
    </div>
  );
}

export function Field(props: {
  label: string;
  name: string;
  type?: string;
  value?: string;
  hint?: string;
  secret?: string;
  required?: boolean;
  inputmode?: "numeric" | "text" | "url" | "tel" | "email" | "decimal" | "search" | "none";
  maxlength?: number;
  textarea?: boolean;
  rows?: number;
  autocomplete?: string;
  error?: string;
}): ReturnType<FC> {
  const id = `f-${props.name.replace(/[^a-z0-9]/gi, "-")}`;
  return (
    <div>
      <label for={id} class="flex items-baseline gap-1 micro mb-1.5">
        {props.label}
        {props.required ? <span class="text-danger">*</span> : null}
      </label>
      {props.textarea ? (
        <textarea id={id} name={props.name} rows={props.rows ?? 4} class="field font-mono text-body">
          {props.value ?? ""}
        </textarea>
      ) : (
        <input
          id={id}
          name={props.name}
          type={props.type ?? "text"}
          value={props.value ?? ""}
          inputmode={props.inputmode}
          maxlength={props.maxlength}
          autocomplete={props.autocomplete ?? "off"}
          class={`field ${props.inputmode === "numeric" ? "readout tracking-[0.14em]" : ""} ${
            props.error ? "!border-danger" : ""
          }`}
        />
      )}
      {props.secret ? (
        <div class="mt-1.5 text-label opacity-60">
          当前 <code class="readout px-1.5 py-0.5 rounded bg-ink/6 text-ink/85">{props.secret}</code> · 留空或保持掩码
          = 不修改
        </div>
      ) : null}
      {props.error ? <div class="mt-1.5 text-label text-danger">{props.error}</div> : null}
      {props.hint && !props.error ? <div class="mt-1.5 text-label opacity-55">{props.hint}</div> : null}
    </div>
  );
}

export function Switch(props: { name: string; checked: boolean; label: string; desc?: string }): ReturnType<FC> {
  return (
    <label class="flex items-start gap-3 py-2.5 min-h-12 cursor-pointer select-none">
      <input type="checkbox" role="switch" name={props.name} value="1" checked={props.checked} class="peer sr-only" />
      <span class="mt-0.5 w-11 h-6 shrink-0 rounded-full bg-ink/12 relative transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:w-[18px] after:h-[18px] after:rounded-full after:bg-panel after:shadow-sm after:transition-transform peer-checked:after:translate-x-5"></span>
      <span class="flex-1">
        <span class="block text-body font-semibold">{props.label}</span>
        {props.desc ? <span class="block text-label opacity-55 mt-0.5">{props.desc}</span> : null}
      </span>
    </label>
  );
}

/**
 * 原生 `<dialog>`：自带 backdrop、Esc 关闭、focus trap，零依赖。
 * 带 `post` 的确认按钮走 `data-post-confirm`，由 `/assets/dialog.js` 发 POST 后关闭并跳转——
 * 不用内联 onclick，为了守住 CSP `script-src 'self'`（docs/backend.md §7）。
 */
export function ConfirmDialog(props: {
  id: string;
  title: string;
  body: Child;
  confirmText?: string;
  tone?: "danger" | "primary";
  post?: string;
  go?: string;
  /** 给出 target 时改用 htmx 局部替换（结果要就地渲染，比如只显示一次的恢复码） */
  target?: string;
  swap?: "innerHTML" | "outerHTML";
}): ReturnType<FC> {
  const tone = props.tone ?? "danger";
  const skin = tone === "danger" ? "btn-danger" : "btn-primary";
  const label = props.confirmText ?? (props.post ? "确认" : "知道了");
  const confirm = props.target ? (
    <button
      type="button"
      hx-post={props.post}
      hx-target={props.target}
      hx-swap={props.swap ?? "innerHTML"}
      data-close-after
      class={`btn ${skin} flex-1`}
    >
      {label}
    </button>
  ) : (
    <button
      value={props.post ? undefined : "ok"}
      type={props.post ? "button" : undefined}
      data-post-confirm={props.post}
      data-post-go={props.go}
      class={`btn ${skin} flex-1`}
    >
      {label}
    </button>
  );

  return (
    <dialog id={props.id} class="w-full max-w-[360px] rounded-dialog p-0 backdrop:bg-canvas/82">
      <form method="dialog" class="panel p-5">
        <h3 class="text-sub font-semibold tracking-tight">{props.title}</h3>
        <div class="mt-2 text-body opacity-75 leading-relaxed">{props.body}</div>
        {/* 确认后 POST 失败时由 dialog.js 填这里并保持对话框打开，否则用户只会觉得「点了没反应」 */}
        <div data-error hidden class="mt-3 text-label text-danger leading-relaxed"></div>
        <div class="mt-6 flex gap-2.5">
          <button value="cancel" class="btn btn-flat flex-1">
            取消
          </button>
          {confirm}
        </div>
      </form>
    </dialog>
  );
}

export function OpenDialog(props: { target: string; children: Child; class?: string }): ReturnType<FC> {
  return (
    <button type="button" data-open-dialog={props.target} class={props.class ?? "btn btn-ghost"}>
      {props.children}
    </button>
  );
}
