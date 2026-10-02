import type { Child } from "hono/jsx";
import type { FC } from "hono/jsx";
import { raw } from "hono/utils/html";
import styleText from "../styles.css?inline";

export type Tab = "dashboard" | "recipients" | "settings";

/**
 * 静态脚本一律带内容哈希版本号，配合 `/assets/:name` 的 `immutable` 一年缓存：
 * 签到链接是每天打开一次的，而原先的 `max-age=3600` 短于这个间隔，等于每次都要重下 52KB 的 htmx。
 */
const versioned = (src: string) => `${src}?v=${__ASSET_VERSION__}`;

const HREFS: Record<Tab, string> = {
  dashboard: "/admin",
  recipients: "/admin/recipients",
  settings: "/admin/settings",
};

const LABELS: Record<Tab, string> = { dashboard: "仪表盘", recipients: "接收人", settings: "设置" };

const stroke = {
  width: 21,
  height: 21,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function TabIcon({ tab }: { tab: Tab }): ReturnType<FC> {
  if (tab === "dashboard")
    return (
      <svg {...stroke}>
        <path d="M3 12h3l2-5 3 10 2-5h3" />
        <path d="M18 12h3" />
        <rect x="2.5" y="3.5" width="19" height="17" rx="3" />
      </svg>
    );
  if (tab === "recipients")
    return (
      <svg {...stroke}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <path d="M16.2 6.4a3 3 0 0 1 0 5.6M18 19a5.4 5.4 0 0 0-1.6-3.8" />
      </svg>
    );
  return (
    <svg {...stroke}>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6" />
    </svg>
  );
}

export type Flash = { tone: "ok" | "warn" | "danger" | "info"; text: string } | null;

const FLASH_CLASS: Record<string, string> = {
  ok: "text-ok border-ok/30 bg-ok/8",
  warn: "text-warn border-warn/30 bg-warn/8",
  danger: "text-danger border-danger/30 bg-danger/8",
  info: "text-primary-ink border-primary/25 bg-primary/6",
};

export function Shell(props: {
  title: string;
  children: Child;
  /** public = Shell A 签到落地页：无 NavBar 返回、无 TabBar（docs/mobile-ui.md §1.1） */
  shell: "public" | "admin";
  tab?: Tab;
  /** cron 异常时仪表盘 Tab 挂红点 */
  tabAlert?: boolean;
  navTitle?: string;
  backHref?: string;
  flash?: Flash;
  htmx?: boolean;
  /** 不渲染后台顶栏：登录这类自带品牌块的单屏页，顶栏只会多出一条无意义的色带 */
  bare?: boolean;
  /** 同源 module script（CSP script-src 'self'，因此不用内联脚本） */
  scripts?: string[];
  actions?: Child;
}): ReturnType<FC> {
  const { shell, tab, backHref, navTitle, title } = props;
  const showHeader = shell === "admin" && !props.bare;
  return (
    <html lang="zh">
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1"
        />
        <title>{title}</title>
        <meta name="theme-color" content="#070b12" />
        <meta name="format-detection" content="telephone=no" />
        <style>{raw(styleText)}</style>
        {props.htmx ? <script src={versioned("/assets/htmx.min.js")} defer /> : null}
        {(props.scripts ?? []).map((src) => (
          <script key={src} type="module" src={versioned(src)} />
        ))}
      </head>
      <body>
        {/* 根容器：width:100% 不可省，否则各 Tab 宽度随内容收缩（P1-4） */}
        <div class="relative z-10 w-full max-w-[430px] mx-auto min-h-screen flex flex-col">
          {showHeader ? (
            <header class="pt-safe appbar sticky top-0 z-30">
              <div class="h-13 px-4 flex items-center gap-2.5">
                {backHref ? (
                  <a
                    href={backHref}
                    class="tap-target -ml-2 flex items-center justify-center rounded-field text-ink/75 active:bg-ink/5"
                    aria-label="返回"
                  >
                    <svg {...stroke} width={20} height={20}>
                      <path d="M14.5 5.5 8 12l6.5 6.5" />
                    </svg>
                  </a>
                ) : (
                  <span class="w-11 -ml-2" aria-hidden="true"></span>
                )}
                <div class="flex-1 min-w-0">
                  <div class="micro leading-none mb-0.5">SILEMA</div>
                  <h1 class="truncate text-sub font-semibold leading-tight tracking-tight">
                    {navTitle ?? "死了吗 · 后台"}
                  </h1>
                </div>
                <span class="flex items-center gap-1 shrink-0">{props.actions}</span>
                {tab ? null : <span class="w-11" aria-hidden="true"></span>}
              </div>
              <div class="h-px bg-gradient-to-r from-transparent via-ink/10 to-transparent"></div>
            </header>
          ) : null}

          <main class="relative flex-1 overflow-y-auto">
            {props.flash ? (
              <div
                class={`mx-4 mt-4 px-3.5 py-2.5 rounded-field border text-body flex items-start gap-2 ${FLASH_CLASS[props.flash.tone]}`}
                role="status"
              >
                <span class="led mt-1.5 shrink-0"></span>
                <span class="flex-1">{props.flash.text}</span>
              </div>
            ) : null}
            {props.children}
          </main>

          {shell === "admin" && tab ? <TabBar current={tab} alert={props.tabAlert} /> : null}
        </div>
      </body>
    </html>
  );
}

/** flex 列布局让 TabBar 与内容等宽；禁止 position:fixed（viewport 居中 ≠ 容器居中）。 */
function TabBar(props: { current: Tab; alert?: boolean }): ReturnType<FC> {
  return (
    <nav
      class="appbar relative z-20 flex-shrink-0 flex border-t border-ink/8 pb-safe"
      role="navigation"
      aria-label="主导航"
    >
      {(["dashboard", "recipients", "settings"] as Tab[]).map((t) => {
        const active = t === props.current;
        return (
          <a
            key={t}
            href={HREFS[t]}
            aria-current={active ? "page" : undefined}
            class={`relative flex-1 h-15 flex flex-col items-center justify-center gap-1 transition-colors ${
              active ? "text-primary" : "text-ink/45 active:text-ink/70"
            }`}
          >
            {active ? (
              <span class="absolute top-0 h-2 w-9 -mt-px rounded-b-full bg-primary"></span>
            ) : null}
            <span class="relative">
              <TabIcon tab={t} />
              {t === "dashboard" && props.alert ? (
                <span class="absolute -top-0.5 -right-1.5 w-2 h-2 rounded-full bg-danger ring-2 ring-canvas"></span>
              ) : null}
            </span>
            <span class={`text-label leading-none ${active ? "font-semibold" : ""}`}>{LABELS[t]}</span>
          </a>
        );
      })}
    </nav>
  );
}
