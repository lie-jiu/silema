# React Bits — Project Profile

_Auto-maintained by motion-apply skill. Edit manually to override._

本项目**不是 React**（Hono JSX SSR），React Bits 组件路径长期不可用 → 所有动效走「直接写 CSS/JS」。

## Stack

- Variant: TS（`tsconfig.json` strict + `verbatimModuleSyntax: true`）
- Framework: Hono 4 JSX SSR + htmx 2.0.11 + Tailwind CSS 4.3.3 + Vite 8 + Cloudflare Workers
- Animation engine: 无第三方引擎，纯 CSS keyframes/transition + rAF（`src/client/hold-button.js`）
- CSP: `script-src 'self'` → 禁止内联 `onclick` / `hx-on`，需要脚本就加一个 `src/client/*.js` 并在 `Shell scripts=[]` 注册
- CSS 以 Vite `?inline` 注入 `<style>`：改 Tailwind 工具类依赖的 `@property` 初值必须手工补回（见 styles.css 顶部注释）

## Scene

- Detected: DASHBOARD（后台 3 Tab + 公开签到页），source = `flow-mobile.json`
- Intensity ceiling: subtle/functional
- 上游硬约束（**优先于本 skill 的默认审美**）：
  - `docs/mobile-ui.md` §9：禁止 confetti/粒子 —— 「今天我还活着」不是成就解锁
  - §1.5 `mobile_rules.forbidden`：hover / tooltip / 双击 / pinch → **不得写任何 hover 门控动效**
  - §1.2 动效行：签到填充 0.4s ease-out、按压内盘下沉 3%、数字翻滚 0.3s

## Tonality（inferred from src/styles.css）

- Style: 维生监护仪 · 夜视（restrained / 仪器感，confidence 0.9）
- Color: 近黑蓝底 `#070b12` + 磷光信号色（ok `#2fd39a` / warn `#f2a63b` / danger `#ff5f5f` / primary `#4d8dff`）
- Font: 系统等宽栈做读数（`tabular-nums`），正文系统 sans
- Radius: card 14 / field 10 / dialog 18
- Signature easing: `cubic-bezier(0.22, 1, 0.36, 1)`；duration palette micro 0.14–0.2s / standard 0.24s / entrance 0.42–0.5s；stagger 70ms
- 层次表达靠「描边 + 辉光」而非阴影（暗底阴影不可见）

## Existing motion inventory（新增前先查这里，避免重复造）

| 类 | 位置 | 作用 |
|---|---|---|
| `.rise` + `--i` | styles.css | 面板上电序入场 0.5s |
| `.roll` | styles.css | 数字读数翻滚 0.42s |
| `.led-live` | styles.css | 状态灯呼吸（2.4s infinite，属仪器常态） |
| `.ecg-live` | styles.css | 心电走线平移（9s infinite，仪器常态） |
| `.skeleton` / `.btn-spinner` | styles.css | 加载态，均由 htmx 状态门类门控 |
| `.hx-swapping` | styles.css | htmx 换出压暗 |
| `.dial-host:active` | styles.css | 长按圆按压下沉 3% |
| hold 进度环 + 200ms 回弹 | client/hold-button.js | rAF 驱动 |

## History

- 2026-10-02: 补上 dialog 开合、后台上电序、htmx 换入入场 + 危险条一次描边（全部保留）
  - 试过 `Card i={n}` prop 管线 → **自己撤回**：条件卡（LOCKDOWN / 发送失败 / 初始化）缺席时显式索引会留 210ms 空洞，改用 `.p-4 > .rise:nth-child()` 自动补位

## Preferences（derived）

- Lean: 一次性/状态门控动效、与既有 easing 一致、纯 CSS 优先
- Avoid: confetti/粒子、hover 门控、持续循环背景动效、新增动画库、prop 管线能省则省

## 陷阱（下次别再重新发现）

1. **Hono JSX 给数字 style 值补 px**：`style={{ "--i": 2 }}` → `--i: 2px` → `calc(2px * 70ms)` 非法 → delay 静默回落 0s。CSS 变量一律传字符串 `"2"`。（2026-10-02 实测：login 与签到页的 stagger 因此从未生效）
2. **`.htmx-added` 只活 `settleDelay`（默认 20ms）**：想在换入瞬间跑 CSS 动画，`hx-swap` 必须带 `settle:240ms` 之类的值，且动画时长 < settle。
3. **`display:contents` 元素不生成盒子**：`#checkin-stage`（htmx swap 锚点）自身不能动画，选择器要打到它的子节点。
4. **`animation` 是 shorthand，两条规则会互相覆盖而非叠加**：给同一元素同时安排「入场」和「报警描边」时，把其中一个放到 `::after` 上。
5. **`prefers-reduced-motion` 全局块的 `*::before/::after` 覆盖不到 `::backdrop`**，遮罩过渡要单列选择器。
