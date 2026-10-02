<h1 align="center">死了吗 · silema</h1>

<p align="center">每天只有一条链接能证明你还活着 · Cloudflare Workers 上的每日确认系统（dead-man's switch）</p>

<p align="center">
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare%20Workers-workerd-8759ff?logo=cloudflareworkers&logoColor=fff">
  <img alt="D1" src="https://img.shields.io/badge/D1-SQLite-6849ff?logo=sqlite&logoColor=fff">
  <img alt="Hono" src="https://img.shields.io/badge/Hono-4.13.12-e36002?logo=hono&logoColor=fff">
  <img alt="htmx" src="https://img.shields.io/badge/htmx-2.0.11-3366ff?logo=htmx&logoColor=fff">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind%20CSS-4.3.3-38bdf8?logo=tailwindcss&logoColor=fff">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=fff">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=fff">
  <img alt="Node" src="https://img.shields.io/badge/Node-20.19%2B-3c873a?logo=node.js&logoColor=fff">
</p>

<p align="center">
  <a href="#它每天怎么运转">它每天怎么运转</a> ·
  <a href="#使用前必须知道的边界">边界</a> ·
  <a href="#功能特性">功能特性</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#端点">端点</a> ·
  <a href="#环境变量">环境变量</a> ·
  <a href="#部署到-cloudflare">部署</a> ·
  <a href="#通知通道">通知通道</a> ·
  <a href="#已知取舍">已知取舍</a>
</p>

<p align="center">线上地址 <a href="https://slm.liejiu.top">slm.liejiu.top</a></p>

---

**所有消息只在每天 12:00 发**（24:00 你在睡觉），每天严格一条；24:00 只做判定与作废当日链接，一条都不发。连续缺席到第 3 天判定为锁死，紧急联系人次日 12:00 收到预设的最终消息，再次日 12:00 收到最后一条，之后**彻底静默**。只有 owner 再次签到才能恢复。

规格文档：

- [`docs/backend.md`](docs/backend.md) — 状态机、两条 cron、API 表、完整 DDL
- [`docs/mobile-ui.md`](docs/mobile-ui.md) — 4 flows / 13 屏的 SSR 规格与「维生监护仪 · 夜视」视觉系统

## 它每天怎么运转

| 时刻（北京） | 任务 | 做什么 |
|---|---|---|
| 12:00 | `send` | **唯一的发送窗口，每天只发一条**。normal 态：物理删除全部旧链接 → 铸造当日链接 → **无条件**发给所有「日常提醒」通道（当天已签到也发）；缺席期这一条自动换成「未签到提醒」文案，用的还是当日同一条链接。locked 态：投递最终消息 |
| 24:00 | `judge` | **一条都不发**：本周期签到过 → 缺席计数归零；没签 → 缺席 +1，并作废已到期的当日链接 |
| 缺席第 3 天 24:00 | `judge` | **锁死**（静默，不做任何投递） |
| 缺席第 4 天 12:00 | `send` | 第一条最终消息，附一条 7 天有效的恢复链接 |
| 缺席第 5 天 12:00 | `send` | 第二条、也是最后一条。**发满两条后系统不再发送任何消息** |
| 之后 | 两个任务 | 只推进时间戳、照常喂心跳 |
| 再次签到 | — | 立即恢复 `normal`、缺席归零，同时撤销还没发出的那一条。已发出的最终消息**不可撤回** |

两条固定 cron 写在 `wrangler.jsonc` 的 `triggers.crons`（UTC `0 4` / `0 16`）。改时间 = 改这里并重新部署，后台没有签到时限类设置。

**为什么投递全压在 12:00**：24:00 是睡觉时间，那时发的提醒你不会看到，而它还要多占一条活链接。代价是紧急联系人比「锁死那一刻」晚约 12 小时才知道。这段窗口里你手里没有任何链接（当日链接刚被判定作废，锁定期又不铸新的），所以它不是「还能撤销」的缓冲——只是把打扰从半夜挪到中午。

**「失败不消耗名额」**：名额按**送达**计。第一条整条失败时，次日 12:00 那次算补发而不是第二条，之后每天 12:00 继续重试，直到至少一个通道成功；成功后第二天 12:00 才发最后一条。所以紧急联系人最多收到两条，而通道临时故障不会让消息永久丢失。

## 使用前必须知道的边界

- **全站共用一条链接**，任何持有者都能替你签到续命。**不要把每日链接发到共享群 / 公共频道**，否则这个开关提供的保证为零。
- **后台没有签到按钮，也不存在 `POST /api/checkin`**。这是刻意的：「已签到」必须等价于「今天真的收到并点开了链接」，不能退化成登录后台点一下就算活着。
- `GET /c/:token` 只渲染确认页，长按确认才 `POST /c/:token/do`。邮件网关的自动抓取与 Safe Links 不会替你续命。
- **链接没送到 = 当天无法签到**，缺席期那条提醒就是当日链接本身（不是额外的第二条），连着两天没点开、第 3 天就会误锁死。唯一的补救是后台「重发今日链接」（`POST /api/cron/resend`），它重发的仍是同一条当日令牌，不算签到。
- **锁死后系统不再主动给你任何链接**：日常链接在 locked 态一律不发（当日链接已在 24:00 被判定作废），「重发今日链接」也被拒。恢复只能点最终消息里那条 7 天有效的链接——它在锁死后的**次日 12:00** 才发出，所以那半天你手里一条链接都没有。**链接过期即无从签到**，这是刻意的：过了这个窗口就认为你确实出事了。
- 不落签到流水、不落投递记录（唯一例外是 `owner.final_sent_at` / `final_second_at` 这两个送达时间戳，它们决定最终消息还欠几条）。**没有签到日历和趋势图**，这是刻意的存储面收敛。
- `recipients.config_json` 明文存 D1（除 `email` 外的通道凭据只能按接收人存）。GET 一律脱敏，机密性依赖 D1 的账号级访问控制。

---

## 功能特性

### 签到与状态机

- **一天严格一条**：12:00 是唯一投递窗口，24:00 只判定与作废链接
- **签到只有链接一个入口**：`performCheckin` 的唯一调用方是 `POST /c/:token/do`
- **GET 只渲染、POST 才消费**：防邮件网关自动抓取替所有者续命
- **缺席自动换文案**：`missed_streak` 1~2 时次日那一条改用「未签到提醒」模板，用的还是当日同一条令牌——缺席期不存在第二条活链接
- **连续缺席 3 天锁死**（`LOCK_AT = 3`），锁死当次静默，最终消息由次日 12:00 的 `send` 投递
- **最终消息最多两条**（`FINAL_MAX = 2`），按**送达**计而非按尝试计，发满后两个任务只推进时间戳
- **两条最终消息之间有一道 12 小时护栏**：`final_sent_at` 距今不足 12h 就跳过第二条，否则连点两次 `/__cron` 会把相隔一天的两条塌进同一小时——而第二条存在的意义正是给你一整个白天去撤销第一条
- **任何时刻最多一条业务链接**：新链接原地物理删除全部旧链接；到期时刻取**固定墙钟** 24:00（不是 `created_at + 12h`），cron 晚触发几分钟也不会让令牌活过自己的判定窗口
- **签到无冷却**，同日重复点击显示「今日已签到」而不重复计数；确认页严格区分**待确认 / 今日已签到 / 已失效**三态

### 通知与文案

- **7 种通道**：`email`（Resend HTTP API）· `telegram` · `bark` · `ntfy` · `serverchan` · `serverchan3` · `webhook`，字段 schema 集中在 `src/lib/channels.ts`
- **每个接收人各自订阅两类事件**：`on_prompt`（每天 12:00 那唯一的一条）与 `on_final`（最终消息）
- **三类消息各自支持接收人级自定义文案**（首行 = 标题），未填写用内置默认兜底；7 个占位符见[通知通道](#通知通道)
- **填了内容却不含 `{checkin_url}` 的自定义文案拒绝保存**：缺席那天那条就是当天唯一的签到入口，锁死后那条是唯一的自救链接，少个占位符等于静默发出一条「看着正常、点了没反应」的消息
- **`{checkin_url}` 取不到令牌时该条直接不发**（不回退站点地址，那等于静默制造缺席）
- **名单变更会告知变更前的所有人**（含被移除那位本人，用各自的旧配置投递）——账号被盗的第一步就是悄悄换联系人
- **至少保留一位紧急联系人**：更新退订与删除会让 `on_final` 归零时 409 拒绝，并发下由条件写入兜第二道
- **测试发送**：`[测试]` 前缀 + 一条 TTL 5 分钟、点击不执行签到的链接

### 后台（SSR + htmx，无 SPA）

- 5 个页面：仪表盘 / 健康详情 / 接收人（列表 · 新增 · 编辑）/ 设置 / 安全
- **切换通道时字段由服务端渲染片段**（`POST /api/recipients/fields`），7 套 schema 一个都不下发前端
- **凭据脱敏 + 掩码哨兵**：GET 只回 `****1234`，回写时字段缺省或值等于掩码 = 保留原值。缺这条的话一次正常提交就会把 `botToken` 写成掩码，此后所有发送静默失败
- **重发今日链接**：全通道失败后的唯一恢复路径，锁定期 409
- 全站动效**纯 CSS**（`@keyframes` + `--i` stagger），没有引入任何动画库

### 安全

- **登录 = 口令 + TOTP**（或一个未使用的恢复码），两者缺一不可；失败响应不区分「用户名不存在」与「密码错误」
- **口令哈希 PBKDF2-SHA256 / 10 万轮**，自描述格式 `pbkdf2$<轮数>$<saltB64>$<hashB64>`（10 万轮是 workerd 硬上限，见[环境变量](#环境变量)）
- **httpOnly cookie 会话 12h** + `session_epoch` 单会话吊销；不是 localStorage 里的 JWT——这个后台存着所有通道凭据
- **CSRF 四信号取任一成立**：`Sec-Fetch-Site: same-origin` → `HX-Request` → `Origin` 同源 → `Referer` 同源。**不能只靠 Origin**：iOS WebKit（含微信内置浏览器）对同源表单导航 POST 根本不发 Origin，所以 `Referrer-Policy` 也不能设 `no-referrer`（否则 Referer 兜底是死代码）
- **CSP `script-src 'self'`**：htmx 不用 `hx-on` 内联属性，需要脚本的地方写成同源 `type="module"` 小文件；图标走内联 SVG / data-URI，不引外部字体与图片
- **SSRF 防护**：webhook 回调地址不得指向本站（自激循环，限流拦不住）或内网/环回
- **限流**：登录 10 次/15 分钟、`/__cron` 10 次/15 分钟、签到链接 GET 60 次/小时、POST 30 次/小时（均按 IP）
- **fail-closed**：`ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` / `SESSION_SECRET` 任一缺失 → `/api/auth/*` 与全部需登录接口 503 并列出缺哪几个；`CRON_SECRET` 未配置 → `/__cron` 一律 403（不与空串比较，定长比较）
- **TOTP 步数入库防重放**：允许 ±1 步时钟漂移，但同一步数不可重复使用；恢复码一次性、库里只存哈希
- **SSR 渲染 `label` 与自定义文案一律转义**：htmx 把服务端 HTML 直接 swap 进 DOM，漏一处就是存储型 XSS

### 自监控与运维

- **后台健康不看 `last_cron_*`**（那个槽位只有一份，会被下一次成功的 cron 覆盖），直接看时间戳：`now - last_send_at > 13h`（locked 态豁免）或 `now - last_judge_at > 25h` 即标红；取不到数据一律显示「未知」并标红，**绝不默认绿**
- **外部心跳按 job 拆成两个独立 check**：`HEARTBEAT_SEND_URL` 阈值 13h、`HEARTBEAT_JUDGE_URL` 阈值 25h，各自 POST `<URL>/pass` 或 `<URL>/fail`
- **按设计跳过的分支同样喂狗**（locked 不发日常链接、12h 幂等守卫拦下重跑、两条已发满的静默期）：心跳监控的是「调度器跑到没有」，不是「消息发出去没有」
- **`scheduled` 兜住未捕获异常**：写 cron error + 发失败心跳，否则一次 D1 抖动会让缺席计数、后台健康与外部告警同时失明
- **Workers Cache 已开**（`wrangler.jsonc` 的 `cache.enabled`），所以全局中间件把**所有**响应压成 `Cache-Control: no-store`——开启后任何 200 的 GET 即使不带 Cache-Control 也会被边缘缓存 2 小时，而绕过条件只认 `Set-Cookie` 响应头与 `Authorization` 请求头，**Cookie 不算**，`/admin` 与 `/c/:token` 会被原样吐给下一个请求同一 URL 的人。唯一放行长缓存的是内容寻址过的 `/assets/*`
- **静态资源内容寻址**：`/assets/<name>?v=<哈希>`，版本号取自 4 个源文件内容的 SHA-256（换行先归一成 LF，否则 `core.autocrlf` 一次 checkout 就换掉版本号），所以能挂 `immutable` 一年。签到链接每天才打开一次，缓存期短于这个间隔等于每天重下一遍 52KB 的 htmx
- **D1 只对只读查询自动重试**，写入路径靠自带的幂等条件写入 + `writeWithRetry`

---

## 技术栈

| 层 | 选型 | 版本 | 备注 |
|---|---|---|---|
| 运行时 | Cloudflare Workers（workerd） | — | `nodejs_compat` 已开；`observability.enabled` 已开 |
| 数据层 | Cloudflare D1 | — | 裸 SQL（`env.DB.batch()`），4 张表，无 ORM |
| 后端框架 | Hono + `hono/jsx` SSR | 4.13.12 | 全部页面服务端渲染 |
| 前端形态 | SSR HTML + htmx 2 | 2.0.11 | 唯一前端运行时依赖；无 SPA、无客户端路由 |
| 样式 | Tailwind CSS（`@tailwindcss/vite`） | 4.3.3 | v4 CSS-first，设计 token 写在 `@theme` |
| 语言 | TypeScript（strict） | 7.0.2 | TS 7 是原生编译器；`npx tsc --noEmit` 做类型门禁 |
| 构建 / 本地 | Vite + `@cloudflare/vite-plugin` | 8.3.1 / 1.62.3 | 插件同时接管 dev server 与构建 |
| 校验 | Zod + `@hono/zod-validator` | 4.6.5 / 0.9.1 | |
| 认证 | 手写 + `otpauth`（TOTP） | 9.5.2 | 零依赖，见[安全](#安全) |
| 部署 | wrangler + `wrangler.jsonc` | 4.145.0 | D1 绑定 / custom_domain / 两条 cron / vars |
| 测试 | Vitest | 5.0.3 | 已接线但**当前跑不起来**，见[开发与构建](#开发与构建) |

不用 ORM（签到 UPDATE 依赖 SQLite 的 `CASE` 与「右侧表达式取旧值」语义，query builder 表达不了）、不用 SPA（签到页必须首屏即终态、无 JS 也能读懂，它可能在别人的手机上被打开）、不用 better-auth（D1 上只能走 drizzleAdapter，会连带引入 Drizzle 与 8 张表）。理由都写在 `docs/backend.md` §0。

---

## 项目结构

```
silema/
├── src/
│   ├── index.tsx       # Worker 入口：fetch + scheduled（cron 表达式精确映射到 send / judge）
│   ├── app.tsx         # 全部路由：公共页 / 签到 / 认证 / 后台，SSR + htmx
│   ├── lib/            # 18 个无 UI 模块：cron · checkin · tokens · channels · send · messages …
│   ├── routes/         # 6 个页面组件（规格里的 13 屏分布在其中）
│   ├── ui/             # kit.tsx（Panel / Field / Switch / ConfirmDialog / Notice …）· shell.tsx
│   ├── client/         # 3 个 type=module 小文件：hold-button · dialog · chips
│   └── styles.css      # Tailwind v4 @theme +「维生监护仪 · 夜视」组件层 + 全站纯 CSS 动效
├── scripts/            # seed-local · migrate · init-owner · hash-password(.cjs/.ps1) · _local
├── migrations/         # 0001_init.sql（4 张表）+ 0002_final_second_message.sql
├── docs/               # backend.md（状态机 / cron / API / DDL）· mobile-ui.md（13 屏规格）
└── wrangler.jsonc      # D1 绑定 · custom_domain · 两条 cron · vars · Workers Cache
```

<details>
<summary><b>完整目录树</b></summary>

```
silema/
├── src/
│   ├── index.tsx           # 默认导出 { fetch, scheduled }；scheduled 用 event.cron 精确映射，
│   │                       #   对不上的表达式记错误并跳过（不执行任何任务），异常兜住后写 cron error + 失败心跳
│   ├── app.tsx             # Hono 实例与全部路由；全局中间件下发安全头 + 全站 no-store
│   ├── globals.d.ts        # 声明构建期注入的 __ASSET_VERSION__
│   ├── lib/
│   │   ├── cron.ts         # runSend / runJudge / parseCron / ping：LOCK_AT=3、FINAL_MAX=2、
│   │   │                   #   12h 幂等守卫、20s 时间预算、并发保护的条件写入
│   │   ├── checkin.ts      # resolveView / viewOf / performCheckin：确认页三态 + 单 batch 消费令牌并更新 owner
│   │   ├── tokens.ts       # 256 位随机令牌：rollDailyPrompt（清链 + 铸新）、voidDayLinks（只删已到期的）、
│   │   │                   #   ensureRecoveryToken（7 天恢复链接复用）、housekeeping
│   │   ├── channels.ts     # 7 套通道 schema：字段定义 / 校验 / 脱敏 / 掩码哨兵 mergeConfig / SSRF 判定
│   │   ├── send.ts         # Env 类型、deliver（各通道 HTTP 调用）、deliverWithRetry（≤3 次）、
│   │   │                   #   MOCK_SEND 假投递与内存 outbox（环形 50 条）
│   │   ├── messages.ts     # 三类消息的默认文案与占位符渲染；{checkin_url} 缺失即返回 null（调用方跳过该条）
│   │   ├── recipients.ts   # 接收人 CRUD、configOf、promptRecipients / finalRecipients / countFinal
│   │   ├── contact-change.ts # 名单变更告知：向变更前的 on_final 名单用旧配置并发投递，回 ok|partial|fail
│   │   ├── db.ts           # getOwner / checkedThisCycle / setCronHealth / writeWithRetry（D1 不自动重试写）
│   │   ├── health.ts       # healthOf：13h / 25h 阈值判定，locked 豁免 send，取不到数据一律「未知」+ 标红
│   │   ├── session.ts      # HMAC-SHA256 签名的 httpOnly cookie 会话（12h）+ session_epoch
│   │   ├── password.ts     # PBKDF2-SHA256 100k 的 hash / verify（自描述格式，按串里的轮数校验）
│   │   ├── totp.ts         # otpauth 封装：currentTotp / verifyTotp（±1 步漂移 + 步数防重放）
│   │   ├── backup-codes.ts # 10 个一次性恢复码：生成 / 哈希 / 匹配 / 移除 / 计数
│   │   ├── security.ts     # missingSecrets / securityHeaders / csrfGuard / requireAuth / wantsHtmx / fragStatus
│   │   ├── rate-limit.ts   # per-key 固定窗口（登录 / cron / 链接 GET / 链接 POST）
│   │   ├── time.ts         # SCHEDULE_TZ=Asia/Shanghai、墙钟换算、当日 24:00 到期、各种格式化
│   │   └── util.ts         # b64url / constantTimeEqual 等
│   ├── routes/
│   │   ├── checkin.tsx     # 确认页三态 + 长按按钮 + 成功态（最高频、最不能错的一屏）
│   │   ├── login.tsx       # 登录页（口令 + 验证码同格，验证码位可填恢复码）
│   │   ├── dashboard.tsx   # 仪表盘：状态灯 / 连续天数 / 健康摘要 / 重发今日链接
│   │   ├── health.tsx      # 健康详情：两条 cron 的时间戳读数与阈值
│   │   ├── recipients.tsx  # 接收人列表 / 编辑 / ChannelFields（服务端渲染的通道字段片段）
│   │   └── settings.tsx    # 设置（时区）+ 安全页（恢复码 / 注销所有设备 / TOTP 恢复指引）
│   ├── ui/
│   │   ├── kit.tsx         # Panel / Field / Switch / ConfirmDialog / Notice / OpenDialog …
│   │   └── shell.tsx       # 页面外壳：三种 shell、TabBar、versioned() 给静态脚本挂内容哈希
│   ├── client/
│   │   ├── hold-button.js  # 长按确认：按钮外释放与键盘路径都算取消，reset 时摘掉 document 监听
│   │   ├── dialog.js       # 确认弹窗（代替 window.confirm，守住 CSP）
│   │   └── chips.js        # 通道类型切换等小交互
│   └── styles.css          # @theme token +「维生监护仪 · 夜视」组件层 + @keyframes（led/sweep/rise/roll/swapIn）
├── scripts/
│   ├── seed-local.cjs      # 本地捏数据（9 个场景）+ 顺带跑 migrations + 生成 .dev.vars
│   ├── migrate.cjs         # 按序执行 migrations/*.sql（--remote 打到线上）
│   ├── init-owner.cjs      # 生产 owner 行初始化 / --reset-totp；INSERT … ON CONFLICT DO NOTHING
│   ├── hash-password.ps1   # Windows：问两次口令 → 打印哈希并复制到剪贴板（-Hidden / -Apply / -Rotate / -Key / -NoPause）
│   ├── hash-password.cjs   # 跨平台：读 stdin（口令绝不进 argv），--apply --yes 写 .secrets.json 并重新部署
│   └── _local.cjs          # 共用：wrangler D1 调用、北京墙钟、PBKDF2、TOTP
├── migrations/
│   ├── 0001_init.sql       # owner / checkin_tokens / recipients / rate_limits
│   └── 0002_final_second_message.sql  # owner.final_second_at
├── docs/
│   ├── backend.md          # 设计定稿：技术栈选型理由、状态机、两条 cron、链接生命周期、API、DDL、安全要点
│   └── mobile-ui.md        # H5 规格：导航架构、视觉规范、手势、每屏五态矩阵、13 屏逐屏规格、文案总表
├── wrangler.jsonc          # name / main / compatibility_date / nodejs_compat / observability /
│                           #   cache.enabled / D1 绑定 / custom_domain route / 两条 cron / vars
└── vite.config.ts          # cloudflare() + tailwindcss()、@ 别名、__ASSET_VERSION__ 内容哈希
```

</details>

安全相关的几条硬约定（改代码前先读 `docs/backend.md` §7）：

- CSP `script-src 'self'`，所以 htmx **不用 `hx-on` 内联属性**，需要脚本的地方写成同源 `type="module"` 小文件。
- Hono JSX 会转义 `<style>` 子节点，注入内联 CSS 必须 `<style>{raw(css)}</style>`（`raw` 从 `hono/utils/html` 导入，`hono/jsx` 不导出它）。
- 所有状态变更一律 POST。会话是 httpOnly cookie，所以 CSRF 三重防护：`SameSite=Lax` + 只接受 POST + 校验同源信号；htmx 请求会话失效要回 `HX-Redirect`，不能回 401 JSON。
- **`requireAuth` 必须注册在受保护 handler 之前**：Hono 按注册顺序执行匹配链，先命中的 handler 一旦返回响应，后注册的 `app.use` 对该路径根本不会执行（已实测）。
- **htmx 2 不会 swap 任何 4xx/5xx 响应**，所以带错误文案的片段一律经 `fragStatus()` 降级成 200（非 htmx 客户端仍拿真实状态码），否则用户看到的是「点了没反应」。
- 加新路由时记得全局 `no-store` 这个前提（Workers Cache 已开），只有内容寻址过的资源才显式放行长缓存。

---

## 快速开始

需要 Node `^20.19 || >=22.12`（Vite 8 的要求）。

```bash
npm install
npm run db:seed          # 重建本地 D1 → 建表 → 捏一个场景的数据 → 生成 .dev.vars
npm run dev              # http://localhost:5173
```

登录：`/admin/login`，用户名 `admin`、口令 `preview`，验证码开 **`/dev/totp`**（每 5 秒自动刷新）。这个辅助页只在 `DEV_HELPER=1` 时存在，生产一律 404。TOTP 的同步数不可复用，刚被消耗过的那一步要用下一个码。

`db:seed` 会覆盖 `.dev.vars`；口令可换：`npm run db:seed -- --password=yourpw`。

换场景捏数据（`--scenario=`）：

| 场景 | 状态 |
|---|---|
| `today` | 今天还没签（默认） |
| `healthy` | 今天已签，连续 12 天 |
| `miss1` / `miss2` | 连续缺席 1 / 2 天（次日 12:00 那条改用提醒文案，第 2 天即最后警告） |
| `locked` | 已锁死，第一条已送达，等次日 12:00 的最后一条 |
| `locked-pending` | 已锁死但还没发出第一条，等下一个 12:00 起每日重试 |
| `locked-silent` | 两条已发满，系统彻底静默 |
| `sendfail` | 发送全通道失败，后台标红 |
| `fresh` | 全新库，没有任何接收人与链接 |

签到页三态的预览链接由 seed 打印出来（`/c/preview-live` 待确认 · `/c/preview-used` 今日已签 · `/c/deadbeefnotatoken` 已失效）。`MOCK_SEND=1` 下所有发送只记录不触网，开 **`/dev/outbox`** 看发出去了什么。

本地手动触发 cron：

```bash
curl -X POST "http://localhost:5173/__cron?job=send&force=1" -H "X-Cron-Secret: local-cron-secret"
# 或用平台自带的路由（走真实的 scheduled handler 与表达式映射）：
curl "http://localhost:5173/cdn-cgi/local/scheduled?cron=0+4+*+*+*"
```

> **别在 dev server 运行时跑 `db:seed` 或 `wrangler d1 execute`**：本地 D1 是同一个 SQLite 文件，两个进程同时打开会让 workerd 直接 `SQLITE_BUSY` 崩掉。先停服务器，再重建数据。

## 开发与构建

```bash
npm run dev              # vite dev server（5173），@cloudflare/vite-plugin 接管 binding 与本地 D1
npm run build            # vite build → dist/
npm run preview          # build + wrangler dev，最接近线上的本地验证
npx tsc --noEmit         # 类型检查（package.json 里没有对应 script）
```

> **`npm test` 目前是坏的**：vitest 复用 `vite.config.ts`，`@cloudflare/vite-plugin` 会报 `There is already a server associated with the config.`；而且仓库里还没有任何测试文件。要跑测试得先给 vitest 单独一份不含 cloudflare 插件的配置。当前唯一的自动化门禁是 `npx tsc --noEmit`。

---

## 端点

### 公共（无鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 公开状态页 HTML（只给日期，不给精确时刻） |
| GET | `/api/status` | 公开状态 JSON：`state` / `streak` / `missedStreak` / `checkedToday` / `lastCheckinDate` / `timezone`；owner 未初始化返回 503 `not_initialized` |
| GET | `/c/:token` | 签到确认页（只渲染，不改状态）；按 IP 限流 60 次/小时 |
| POST | `/c/:token/do` | **全站唯一签到入口**；htmx 请求回片段、其余回整页；按 IP 限流 30 次/小时 |
| POST | `/__cron?job=send\|judge` | 手动触发 cron，需 `X-Cron-Secret` 头，`&force=1` 跳过 12h 幂等守卫（`send` 复用当日已存在的令牌，不重新清链） |
| GET | `/assets/:name` | htmx + 三个同源小脚本；`?v=<内容哈希>`，`Cache-Control: public, max-age=31536000, immutable` |

公开响应**不含任何接收人信息、也不给精确时间戳**，否则任何人都能推算出触发时刻。

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/login` | 登录页；缺 Secret 直接 503 并列出缺哪几个 |
| POST | `/api/auth/login` | 表单 `username` / `password` / `totpCode` / `next`；`totpCode` 位可填 6 位动态码**或**一个未使用的恢复码。成功下发 httpOnly 会话 cookie，**响应体不含 token**；htmx 走 `HX-Redirect` + 204 |
| POST | `/api/auth/logout` | 清本机会话 cookie |
| POST | `/api/auth/logout-all` | 需登录；bump `session_epoch`，吊销所有设备 |
| POST | `/api/auth/backup-codes` | 需登录；生成 10 个一次性恢复码，**明文只在这一次响应里出现**，库里只存哈希，旧的 10 个全部失效 |

`next` 只接受 `/admin` 前缀或 `/`，其余一律回落 `/admin`（防开放重定向）。

### 需登录（httpOnly 会话 cookie）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin` | 仪表盘 |
| GET | `/admin/health` | 健康详情（两条 cron 的时间戳读数与阈值） |
| GET | `/admin/settings` | 设置（时区） |
| GET | `/admin/security` | 恢复码 / 会话到期 / TOTP 恢复指引 |
| GET | `/admin/recipients`、`/admin/recipients/new`、`/admin/recipients/:id` | 接收人列表 / 新增 / 编辑（凭据服务端脱敏） |
| POST | `/api/settings` | 表单 `timezone`；用 `Intl.DateTimeFormat` 校验，非法值 400 并保留原值 |
| POST | `/api/cron/resend` | 重发今日链接，等价于 `/__cron?job=send&force=1`；**locked 态 409**（它重发的「今日链接」在锁定期不存在） |
| POST | `/api/recipients/fields` | 切换通道时由服务端渲染该通道的字段片段 |
| POST | `/api/recipients` | 新增接收人，成功 302 回列表并带 `flash` / `notice` |
| POST · PUT | `/api/recipients/:id/save` · `/api/recipients/:id` | 更新，同一个 handler（HTML 表单只能 POST，REST 面保留 PUT） |
| POST · DELETE | `/api/recipients/:id/delete` · `/api/recipients/:id` | 删除，同一个 handler；会让紧急联系人归零时 409 |
| POST | `/api/recipients/:id/test` | 测试发送：`[测试]` 前缀 + 一条 `purpose='test'`、TTL 5 分钟的链接，点击不执行签到 |

> **刻意不提供签到接口**：登录态能改配置、能重发链接，但**不能直接替自己签到**（没有 `POST /api/checkin`）。签到只有 `POST /c/:token/do` 一条路径。

### 本地预览辅助（`DEV_HELPER=1` 才存在，生产一律 404）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/dev/totp` | 当前 6 位动态码 + 剩余秒数，页面 5 秒自动重载 |
| GET | `/dev/outbox` | 本 isolate 的投递记录（内存环形队列，最多 50 条，重启即失） |

---

## 环境变量

Secret 一律通过 `.secrets.json` + `wrangler deploy --secrets-file` 写入（见[部署](#部署到-cloudflare)；`wrangler secret put` 在本项目上会被平台拒掉）；本地放 `.dev.vars`（已 gitignore，`db:seed` 会自动生成，模板见 `.dev.vars.example`）。

| 名称 | 必需 | 缺失后果 |
|---|---|---|
| `ADMIN_USERNAME` | 是 | `/api/auth/*` 与全部需登录接口一律 503（fail-closed，不放行） |
| `ADMIN_PASSWORD_HASH` | 是 | 同上。格式 `pbkdf2$<轮数>$<saltB64>$<hashB64>`，见下 |
| `SESSION_SECRET` | 是 | 同上。会话是 httpOnly cookie，签名里带 `session_epoch` |
| `CRON_SECRET` | 是 | `POST /__cron` 一律 403。生产要靠它做手动触发与失败重发 |
| `SITE_URL` | 是（`vars`） | 消息里的签到链接前缀，写在 `wrangler.jsonc` 的 `vars`，不是 Secret |
| `EMAIL_API_KEY` / `EMAIL_FROM` | 用邮件通道时 | **只让 email 通道失败并记 cron error**，其余通道不受影响（邮件可能只是备用通道，不做全局 fail-closed） |
| `HEARTBEAT_SEND_URL` / `HEARTBEAT_JUDGE_URL` | 建议 | 跳过外部心跳（不影响功能，但失去失联兜底） |
| `MOCK_SEND` | — | `1` = 所有发送只记录不触网，仅限本地 |
| `DEV_HELPER` | — | `1` = 开启 `/dev/totp` 与 `/dev/outbox`，**生产绝对不要设** |

<details>
<summary><b>为什么口令哈希是 PBKDF2-SHA256 / 10 万轮</b></summary>

用 **WebCrypto PBKDF2-SHA256（100k 轮）**而不是 bcrypt/argon2id：Workers 没有原生实现，纯 JS 的 bcrypt 会打爆 CPU 配额。**10 万轮是 workerd 的硬上限**，超过就直接抛 `iteration counts above 100000 are not supported`——本地 miniflare 用的是 Node 的 WebCrypto 没有这个限制，所以这个雷只在真机上炸。

10 万轮低于 OWASP 当前建议，补偿是这道口令从不单独生效：必须同时有 TOTP（或恢复码），且登录按 IP 限流 10 次/15 分钟。格式自带算法与轮数前缀，`verifyPassword` 按串里的轮数校验，所以将来换 argon2id（WASM）或平台放宽上限都不用改调用方。

</details>

<details>
<summary><b>限流与健康阈值</b></summary>

| 对象 | 限额 / 阈值 | 超出后 |
|---|---|---|
| 登录（per-IP） | 10 次 / 15 分钟 | 拒绝并提示重试时间；登录成功即清空该 IP 的计数 |
| `/__cron`（per-IP） | 10 次 / 15 分钟 | 429 |
| `GET /c/:token`（per-IP） | 60 次 / 小时 | 429 页面 |
| `POST /c/:token/do`（per-IP） | 30 次 / 小时 | 429 |
| `send` 心跳 / 后台健康 | `now - last_send_at > 13h` | 标红 + 失败心跳（locked 态豁免） |
| `judge` 心跳 / 后台健康 | `now - last_judge_at > 25h` | 标红 + 失败心跳 |
| 单通道发送超时 | 5s | 该通道失败，即时重试 ≤3 次（间隔 400ms 递增） |
| 整个 cron 时间预算 | 20s | 超预算全部按失败计（Workers 墙钟/子请求上限） |
| 名单变更告知预算 | 6s | 单通道不重试，只把 `ok\|partial\|fail` 回给后台横幅 |

</details>

---

## 部署到 Cloudflare

本仓库已经按 `slm.liejiu.top` 配好了（生产 D1 的 `database_id` 与 `routes` 都在 `wrangler.jsonc` 里）。换成你自己的域名/库时改这两处即可。**没有放一键部署按钮**，正是因为这两个值是本站专用的：别人一键部署会指向我的库和我的域名。

```bash
npx wrangler login
npx wrangler d1 create silema                    # 把返回的 database_id 填进 wrangler.jsonc
npx wrangler d1 migrations apply silema --remote # 按序应用 migrations/*.sql
.\scripts\hash-password.ps1                        # 问两次口令 → 打印 pbkdf2$100000$… 哈希
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"   # 随机密钥来两把
```

把 5～6 个密钥写进 **gitignored** 的 `.secrets.json`（格式同 `wrangler secret bulk`，JSON 或 `.env` 都行）：

```json
{
  "ADMIN_USERNAME": "admin",
  "ADMIN_PASSWORD_HASH": "pbkdf2$100000$…",
  "SESSION_SECRET": "…32 字节 hex…",
  "CRON_SECRET": "…32 字节 hex…",
  "EMAIL_API_KEY": "re_…",
  "EMAIL_FROM": "silema@mail.liejiu.top"
}
```

```bash
npm run deploy -- --secrets-file .secrets.json   # 代码 + 密钥一次上传，只产生一个版本
node scripts/init-owner.cjs --remote             # 写 owner 行 + 生成 TOTP，屏幕上打印 otpauth:// 内容
```

`.secrets.json` **留在本地别提交也别删**（`.gitignore` 已经收了）：它是后续改密钥的唯一底本 —— 值一旦写进 Worker 就再也读不回来，没有这个文件你只能全部重新生成。

`init-owner.cjs` 用 `INSERT … ON CONFLICT DO NOTHING`，重跑不会碰业务状态；只有 `--reset-totp` 会换掉密钥、清空恢复码并 bump `session_epoch`。

### 改管理员口令

Windows 上用 PowerShell 脚本（不依赖 Node 的交互输入）：

```powershell
.\scripts\hash-password.ps1            # 问两次（明文可见）→ 打印哈希并复制到剪贴板
.\scripts\hash-password.ps1 -Hidden    # 改成隐藏输入（SecureString）
.\scripts\hash-password.ps1 -Apply     # 顺手写进 .secrets.json 并重新部署，一步生效
.\scripts\hash-password.ps1 -Key EMAIL_FROM -Apply
```

末尾会等你按回车才关窗（`-NoPause` 跳过），出错也是打红字而不是闪退 —— 双击运行最容易什么都看不见。**哈希会占用剪贴板**（这正是它的方便之处，但跑之前重要的剪贴板内容先挪走，或者事后按 `Win + V` 从历史找回）。口令不进命令行参数，用完把 `$first` / `$feed` 变量清掉。

非 Windows 直接把两行口令喂给 Node 脚本：

```bash
read -rs p && printf '%s\n%s\n' "$p" "$p" | node scripts/hash-password.cjs
```

`-Apply` / `--apply` 会**立即重新部署线上 Worker**（Node 侧还得多带 `--yes`）。新口令立刻生效、旧口令作废；已登录的会话不会掉（cookie 由 `SESSION_SECRET` 签名），要吊销所有设备就去后台「安全 → 注销所有设备」。它不校验旧口令，忘了也能这么救回来。口令**绝不走命令行参数** —— argv 会进 shell 历史与系统进程列表。

哈希必须由服务端 `verifyPassword` 能认的算法产出（PBKDF2-**SHA256**、10 万轮、base64url 无填充），所以这两个脚本都复用 `scripts/_local.cjs` 里那份实现：Windows PowerShell 5.1 自带的 `Rfc2898DeriveBytes` 只有 SHA-1，自己手写很容易做成「哈希看着对、登录却 401」。

### 旋转机器生成的密钥

```powershell
.\scripts\hash-password.ps1 -Rotate -Key SESSION_SECRET -Apply
.\scripts\hash-password.ps1 -Rotate -Key CRON_SECRET   -Apply
```

随机 32 字节 hex → 写进 `.secrets.json` → 重新部署，全程不用你输入或复制任何东西。

- **`SESSION_SECRET`** 一旋转，所有已登录会话立刻失效（怀疑 cookie 泄露时这就是那把刀；后台的「注销所有设备」走 `session_epoch`，效果相同且不用部署）。
- **`CRON_SECRET`** 旋转后手动触发 `/__cron` 要用新值；本地 `.dev.vars` 里那个只是开发用的，两者互不影响。
- `-Rotate` 对 `ADMIN_PASSWORD_HASH` 会直接拒绝 —— 口令必须由你自己定，随机出来的口令没人记得住。

<details>
<summary><b>密钥的几条语义（官方 <code>workers/configuration/secrets</code> + 实测）</b></summary>

- `--secrets-file` 里没列出的密钥会**从上一个版本保留**，所以后续只改代码时直接 `npm run deploy` 不会丢密钥；`wrangler deploy` 也永远不会删密钥。
- 反过来，`vars` 以 `wrangler.jsonc` 为准：**在控制台改过的明文变量会在下次 deploy 时被覆盖**，别在控制台改 `SITE_URL`。
- **`wrangler secret put` 在本项目上用不了**（实测 2026-10-02）：Vite 插件部署时会上传多个版本，`secret put` 因此认定「the latest version of your Worker isn't currently deployed」并拒绝写入。改单个值就走上面的 `--apply`，或者去控制台的 Variables and Secrets。
- 还有一个 `secrets.required` 配置项（2026-03-24 新增）能让 deploy 前校验密钥齐不齐。**本仓库刻意不用**：一旦声明，`vite dev` 只会从 `.dev.vars` 加载列在里面的键，`SITE_URL` / `MOCK_SEND` / `DEV_HELPER` 会被排除，本地预览的链接就会指向生产域名。缺密钥时应用本身已经 fail-closed（`/api/auth/*` 与全部需登录接口 503 并列出缺哪几个），够用了。
- 新值全球传播要几秒钟，刚部署完立刻拿旧值试可能还是通的，别据此判断没生效。

</details>

<details>
<summary><b>域名（2026-10-01 实测：全新落地，没有要解绑的东西）</b></summary>

账号里当时**既没有旧版 Worker `si-le-ma`、也没有 `silema`，没有 D1 `silema`，zone `liejiu.top` 里也没有任何 `slm` 记录**——`slm.liejiu.top` 是空的。所以不存在「先解绑再绑」的冲突，加上 `routes` 就行：

```jsonc
// wrangler.jsonc
"routes": [{ "pattern": "slm.liejiu.top", "custom_domain": true }]
```

`custom_domain` 由 Cloudflare 自动创建那条 `AAAA 100::` 记录并签发证书（zone 里 `dav` / `60s` / `sub` 三个都是这么来的），**不需要 DNS 写权限，需要的是 `Workers Routes: Write`**（官方授权文档：加/改/删 Route 与 Custom Domain 要 Worker 的 Editor + 每个受影响 zone 的 Workers Routes Write）。不加 `routes` 的话只有 `silema.liejiunb666.workers.dev` 可用，此时 `vars.SITE_URL` 必须跟着改成实际对外地址，否则消息里的签到链接指向错的域。

> Custom Domain **不能建在已有 CNAME 记录的主机名上**。`slm` 当时没有任何记录，所以不冲突。

遗留资产：旧库 D1 `d1-db`（id `d95e62c2-2d62-4a15-9f46-5b2026070421`）还在账号里，确认新版跑通后可以自行清理。邮件通道的 Resend DKIM（`resend._domainkey.mail.liejiu.top`）已经在 zone 里，所以 `EMAIL_FROM` 用 `…@mail.liejiu.top` 不需要再加 DNS。

</details>

---

## 通知通道

`email`（Resend HTTP API）· `telegram` · `bark` · `ntfy` · `serverchan` · `serverchan3` · `webhook`，共 7 种，字段 schema 集中在 `src/lib/channels.ts`，同时驱动服务端渲染的动态字段与保存校验（7 套 schema 不下发到前端）。

- **每个接收人各自订阅两类事件**：`on_prompt`（每天 12:00 那唯一的一条，缺席期改用未签到提醒文案）与 `on_final`（最终消息）。**至少保留一位紧急联系人**，否则删除/退订会被 409 拒绝。
- **名单变动会告知变更前的所有人**（含被移除那位本人，用各自的旧配置投递）——账号被盗的第一步就是悄悄换联系人。
- `email` 是唯一凭据不入库的通道：`EMAIL_API_KEY` / `EMAIL_FROM` 是部署级 Secret，接收人配置里只有一个 `to`。正文同时发 `text` 与 `html`，**`text` 是权威版本**。
- Resend 对 **QQ邮箱 / 163 等大陆邮箱投递一般**，可能进垃圾箱。选它是因为免费 3000 封/月，且 `liejiu.top` 的 DNS 已在 Cloudflare 上，DKIM 三条记录一键加完。要更好的送达率就换 Postmark（免费仅 100 封/月）或腾讯云 SES（对大陆邮箱最好，但要手写 TC3-HMAC-SHA256 签名）。
- 文案占位符：`{checkin_url}` `{site}` `{label}` `{last_checkin}` `{missed_days}` `{reminder_index}` `{time}`。**`{checkin_url}` 取不到令牌时该条消息直接不发**（不回退站点地址，那等于静默制造缺席）。
- **心跳监控的告警接收方必须独立于所有者本人**——这套兜底的前提就是你已经失联了，只通知你自己的告警等于没有。

## 忘记口令 / 丢了验证器

优先级从高到低：

1. **恢复码**：`/admin/security` 生成 10 个一次性恢复码（明文只显示这一次，库里只存哈希）。登录时填在「验证码」那一格即可，用过即从数组移除。
2. **吊销所有设备**：`POST /api/auth/logout-all`（bump `session_epoch`），怀疑 cookie 泄露时用。
3. **重置 TOTP**（最后手段）：`node scripts/init-owner.cjs --remote --reset-totp`。这会清空恢复码并强制所有设备重新登录。

登录限流 10 次 / 15 分钟按 IP；失败响应不区分「用户名不存在」与「密码错误」；TOTP 允许 ±1 步时钟漂移，但已用步数入库、不可重复使用。

## 数据模型

4 张表，全量 schema = `migrations/0001_init.sql` + `0002_final_second_message.sql`（按文件名顺序执行；本地 `db:seed` 与 `node scripts/migrate.cjs` 都跑全量，生产走 `wrangler d1 migrations apply`）。

| 表 | 关键字段 | 说明 |
|---|---|---|
| `owner` | `state` / `streak` / `missed_streak` / `locked_at` / `final_sent_at` / `final_second_at` / `last_checkin_at` / `last_send_at` / `last_judge_at` / `last_cron_*` / `timezone` / `totp_secret` / `totp_last_step` / `backup_codes` / `session_epoch` | 单行（`CHECK (id = 1)`）；状态机、幂等标记、巡检遥测全部收敛在此 |
| `checkin_tokens` | `token` / `purpose`(prompt\|reminder\|final\|test) / `created_at` / `expires_at` / `used_at` | 一次性签到链接，每日清链，库里最多滞留 2 条 |
| `recipients` | `label` / `channel_type` / `config_json` / `on_prompt` / `on_final` / 三类 `*_content` | 通知通道 |
| `rate_limits` | `key` / `count` / `window_start` | 限流（安全设施，非业务数据） |

- **无签到流水**：连续天数与「本周期是否已签」由 `last_checkin_at >= last_judge_at` + `streak` 推导，系统不提供签到日历/历史。
- **无投递记录**：发送即时完成、不落日志；失败可见性走 cron 健康 + 心跳。唯一例外是两个 `final_*_at` 送达时间戳——必须有它们才能区分「还欠一条」和「已发满两条」。
- 巡检状态直接存 owner 行（`last_cron_*`），只有一份槽位，所以 error 文本带 `[send]` / `[judge]` 前缀，且后台健康判定不依赖它。
- 签到的 owner 更新是一个 D1 batch 里的纯 SQL（SQLite 的 UPDATE 右侧表达式一律取旧值，赋值顺序无关），所以 `streak` / `last_judge_at` 的推进不需要读-改-写。

## 已知取舍

| 取舍 | 代价 |
|---|---|
| 每日无条件发链接、发新链接时物理删除全部旧链接 | 任何时候最多一条有效链接，没有「已使用」审计 |
| 签到只能走当日链接 | 链接没送到就是当天签不了，可能误锁死；补偿只有重发 |
| 最终消息最多两条，之后彻底静默 | 误锁死时紧急联系人只会被打扰两次，但错过窗口的人只能靠那条 7 天恢复链接自救 |
| 锁死后只有恢复链接能自救 | 撤销不了已发出的最终消息；链接过期即无从签到，只能重建库 |
| 只有两条固定 cron | 非北京时区的用户看到的是本地 12:00/24:00 之外的时刻 |
| 无签到历史 / 无投递记录 | 排查只能靠 cron 健康、心跳与 owner 行时间戳 |
| `recipients.config_json` 明文存 D1 | 通道凭据的机密性依赖 D1 的账号级访问控制；GET 一律脱敏 |
| 没有自动化测试 | 唯一门禁是 `npx tsc --noEmit`；`npm test` 与 cloudflare vite 插件冲突（见[开发与构建](#开发与构建)） |

## 仓库状态

当前重写在分支 **`rewrite`** 上，是一个**孤立根 commit**（与 `master` 的旧实现无共同祖先）。因此 `rewrite → master` 的 PR 不会给出可用 diff，合并需要 `--allow-unrelated-histories`。`master` 保留旧版实现，作为回滚参照。

## 许可

还没有 LICENSE 文件。作为个人 OSS 项目公开前补一个。
