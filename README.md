# 死了吗 · silema

> 每天只有一条链接能证明你还活着。

Cloudflare Workers 上的每日确认系统（dead-man's switch）：每天 12:00 向通道发一条**当日一次性**签到链接，连续缺席到第 4 天就向紧急联系人发出预设的最终消息。任意一次签到即恢复正常。

线上地址 <https://slm.liejiu.top>。规格文档：

- [`docs/backend.md`](docs/backend.md) — 状态机、两条 cron、API 表、完整 DDL
- [`docs/mobile-ui.md`](docs/mobile-ui.md) — 4 flows / 13 屏的 SSR 规格与「维生监护仪 · 夜视」视觉系统

---

## 它每天怎么运转

| 时刻（北京） | 任务 | 做什么 |
|---|---|---|
| 12:00 | `send` | 物理删除全部旧链接 → 铸造当日链接 → **无条件**发给所有「日常提醒」通道（当天已签到也发） |
| 24:00 | `judge` | 本周期签到过 → 缺席计数归零；没签 → 缺席 +1，第 1–3 天各发一次未签到提醒 |
| 缺席第 4 天 | `judge` | **锁死**：向所有「紧急联系人」通道发最终消息，附一条 7 天有效的恢复链接 |
| 任意签到 | — | 立即恢复 `normal`、缺席归零。最终消息一经发出**不可撤回** |

两条固定 cron 写在 `wrangler.jsonc` 的 `triggers.crons`（UTC `0 4` / `0 16`）。改时间 = 改这里并重新部署，后台没有签到时限类设置。

## ⚠️ 使用前必须知道的边界

- **全站共用一条链接**，任何持有者都能替你签到续命。**不要把每日链接发到共享群 / 公共频道**，否则这个开关提供的保证为零。
- **后台没有签到按钮，也不存在 `POST /api/checkin`**。这是刻意的：「已签到」必须等价于「今天真的收到并点开了链接」，不能退化成登录后台点一下就算活着。
- `GET /c/:token` 只渲染确认页，长按确认才 `POST /c/:token/do`。邮件网关的自动抓取与 Safe Links 不会替你续命。
- **链接没送到 = 当天无法签到**，连吃 3 天提醒后第 4 天会误锁死。唯一的补救是后台「重发今日链接」（`POST /api/cron/resend`），它重发的仍是同一条当日令牌，不算签到。
- 不落签到流水、不落投递记录（唯一例外是 `owner.final_sent_at`，它驱动锁死期的逐日重发）。**没有签到日历和趋势图**，这是刻意的存储面收敛。
- `recipients.config_json` 明文存 D1（除 `email` 外的通道凭据只能按接收人存）。GET 一律脱敏，机密性依赖 D1 的账号级访问控制。

---

## 本地预览

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
| `miss1` / `miss2` / `miss3` | 连续缺席 1 / 2 / 3 天（第 3 天即最后警告） |
| `locked` | 已锁死且最终消息已送达 |
| `locked-pending` | 已锁死但最终消息发送失败，每日重试 |
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

---

## 部署到 Cloudflare

`wrangler.jsonc` 里有两处**必须在部署前改**：

1. `d1_databases[0].database_id` 现在是占位值 `"silema-local"`，只有本地开发能用。
2. 没有 `routes` 条目 —— 部署完不会自动接管 `slm.liejiu.top`。

```bash
npx wrangler login
npx wrangler d1 create silema                    # 把返回的 database_id 填进 wrangler.jsonc
npx wrangler d1 migrations apply silema --remote # 应用 migrations/0001_init.sql

# 生成口令哈希与会话密钥，逐条 wrangler secret put
node -e "require('./scripts/_local.cjs').hashPassword(process.argv[1]).then(console.log)" '你的管理员口令'
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"

npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD_HASH      # 上面那条命令输出的 pbkdf2$… 整串
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CRON_SECRET
npx wrangler secret put EMAIL_API_KEY            # 用邮件通道才需要
npx wrangler secret put EMAIL_FROM
# 可选：npx wrangler secret put HEARTBEAT_SEND_URL / HEARTBEAT_JUDGE_URL

node scripts/init-owner.cjs --remote             # 写 owner 行 + 生成 TOTP，屏幕上会打印 otpauth:// 二维码内容
npm run deploy
```

`init-owner.cjs` 用 `INSERT … ON CONFLICT DO NOTHING`，重跑不会碰业务状态；只有 `--reset-totp` 会换掉密钥、清空恢复码并 bump `session_epoch`。

### 域名切流（这个仓库的地雷）

`slm.liejiu.top` 目前绑在**旧版** Worker `si-le-ma`（D1 为 `d1-db`）上，而新版叫 `silema`（D1 也叫 `silema`）——四个名字全不一样，部署只会新建、不会覆盖。切流量要**先把 custom domain 从旧 Worker 解绑，再绑到新 Worker**，否则冲突：

```jsonc
// wrangler.jsonc
"routes": [{ "pattern": "slm.liejiu.top", "custom_domain": true }]
```

重写**不迁移任何旧数据**，旧库的签到日历与投递历史明知会丢。旧通道凭据与文案已备份在仓库外（见 `docs/backend.md` §4 的字段映射说明）。

---

## 环境变量

Secret 用 `wrangler secret put`，本地放 `.dev.vars`（已 gitignore，`db:seed` 会自动生成）。

| 名称 | 必需 | 缺失后果 |
|---|---|---|
| `ADMIN_USERNAME` | ✅ | `/api/auth/*` 与全部需登录接口一律 503（fail-closed，不放行） |
| `ADMIN_PASSWORD_HASH` | ✅ | 同上。格式 `pbkdf2$<轮数>$<saltB64>$<hashB64>`，见下 |
| `SESSION_SECRET` | ✅ | 同上。会话是 httpOnly cookie，签名里带 `session_epoch` |
| `CRON_SECRET` | ✅ | `POST /__cron` 一律 403。生产要靠它做手动触发与失败重发 |
| `SITE_URL` | ✅（vars） | 消息里的签到链接前缀，写在 `wrangler.jsonc` 的 `vars` |
| `EMAIL_API_KEY` / `EMAIL_FROM` | 用邮件通道时 | **只让 email 通道失败并记 cron error**，其余通道不受影响 |
| `HEARTBEAT_SEND_URL` / `HEARTBEAT_JUDGE_URL` | 建议 | 跳过外部心跳（不影响功能，但失去失联兜底） |
| `MOCK_SEND` | — | `1` = 所有发送只记录不触网，仅限本地 |
| `DEV_HELPER` | — | `1` = 开启 `/dev/totp` 与 `/dev/outbox`，**生产绝对不要设** |

口令哈希用 **WebCrypto PBKDF2-SHA256（300k 轮）**而不是 bcrypt/argon2id：Workers 没有原生实现，纯 JS 的 bcrypt 会打爆 CPU 配额。格式自带算法与轮数前缀，将来换 argon2id（WASM）不用改调用方。

---

## 通知通道

`email`（Resend HTTP API）· `telegram` · `bark` · `ntfy` · `serverchan` · `serverchan3` · `webhook`，共 7 种，字段 schema 集中在 `src/lib/channels.ts`，同时驱动服务端渲染的动态字段与保存校验（7 套 schema 不下发到前端）。

- **每个接收人各自订阅两类事件**：`on_prompt`（12:00 链接 + 24:00 未签到提醒）与 `on_final`（最终消息）。**至少保留一位紧急联系人**，否则删除/退订会被 409 拒绝。
- **名单变动会告知变更前的所有人**（含被移除那位本人，用各自的旧配置投递）——账号被盗的第一步就是悄悄换联系人。
- `email` 是唯一凭据不入库的通道：`EMAIL_API_KEY` / `EMAIL_FROM` 是部署级 Secret，接收人配置里只有一个 `to`。正文同时发 `text` 与 `html`，**`text` 是权威版本**。
- Resend 对 **QQ邮箱 / 163 等大陆邮箱投递一般**，可能进垃圾箱。选它是因为免费 3000 封/月，且 `liejiu.top` 的 DNS 已在 Cloudflare 上，DKIM 三条记录一键加完。要更好的送达率就换 Postmark（免费仅 100 封/月）或腾讯云 SES（对大陆邮箱最好，但要手写 TC3-HMAC-SHA256 签名）。
- 文案占位符：`{checkin_url}` `{site}` `{label}` `{last_checkin}` `{missed_days}` `{reminder_index}` `{time}`。**`{checkin_url}` 取不到令牌时该条消息直接不发**（不回退站点地址，那等于静默制造缺席）。

---

## 忘记口令 / 丢了验证器

优先级从高到低：

1. **恢复码**：`/admin/security` 生成 10 个一次性恢复码（明文只显示这一次，库里只存哈希）。登录时填在「验证码」那一格即可，用过即从数组移除。
2. **吊销所有设备**：`POST /api/auth/logout-all`（bump `session_epoch`），怀疑 cookie 泄露时用。
3. **重置 TOTP**（最后手段）：`node scripts/init-owner.cjs --remote --reset-totp`。这会清空恢复码并强制所有设备重新登录。

登录限流 10 次 / 15 分钟按 IP；失败响应不区分「用户名不存在」与「密码错误」；TOTP 允许 ±1 步时钟漂移，但已用步数入库、不可重复使用。

---

## 自监控

- **后台健康**（`/admin/health`）不看 `last_cron_*`（那个槽位只有一份，会被下一次成功的 cron 覆盖），直接看时间戳：`now - last_send_at > 13h`（locked 态豁免）或 `now - last_judge_at > 25h` 即标红。取不到数据一律显示「未知」并标红，**绝不默认绿**。
- **外部心跳按 job 拆成两个独立 check**：`HEARTBEAT_SEND_URL` 阈值 13h、`HEARTBEAT_JUDGE_URL` 阈值 25h，各自 POST `<URL>/pass` 或 `<URL>/fail`。共用一个 check 时 12:00 的 send 会把 judge 静默不跑也一起喂掉，永远不会告警。
- 心跳监控的是「调度器跑到没有」，不是「消息发出去没有」：locked 不发日常链接、12h 幂等守卫拦下重跑这些**按设计跳过**的分支同样喂狗。
- **心跳的告警接收方必须独立于所有者本人**——这套兜底的前提就是你已经失联了，只通知你自己的告警等于没有。

---

## 目录结构

```
src/
  index.tsx          Worker 入口：fetch + scheduled（cron 表达式精确映射）
  app.tsx            路由：公共页 / 签到 / 认证 / 后台，全部 SSR + htmx
  lib/               db · cron · checkin · tokens · channels · send · messages
                     session · password · totp · backup-codes · rate-limit
                     security（CSRF / 安全头 / 会话拦截）· health · time
                     contact-change（名单变更告知）
  routes/            页面组件（规格里的 13 屏分布在这 6 个文件内）：
                     checkin · login · dashboard · health · recipients · settings
  ui/                kit.tsx（Panel / Field / Switch / ConfirmDialog / Notice …）· shell.tsx
  client/            hold-button.js · dialog.js · chips.js（三个 type=module 小文件）
  styles.css         Tailwind v4 @theme + 「维生监护仪 · 夜视」组件层
scripts/
  seed-local.cjs     本地捏数据（9 个场景）+ 生成 .dev.vars
  init-owner.cjs     生产 owner 行初始化 / --reset-totp
  _local.cjs         共用：wrangler D1 调用、北京墙钟、PBKDF2、TOTP
migrations/          单个 0001_init.sql（全新建库，无迁移包袱）
docs/                backend.md · mobile-ui.md
```

安全相关的几条硬约定（改代码前先读 `docs/backend.md` §7）：

- CSP `script-src 'self'`，所以 htmx **不用 `hx-on` 内联属性**，需要脚本的地方写成同源 `type="module"` 小文件；内联 SVG 走 data-URI，不引外部字体与图片。
- Hono JSX 会转义 `<style>` 子节点，注入内联 CSS 必须 `<style>{raw(css)}</style>`（`raw` 从 `hono/utils/html` 导入，`hono/jsx` 不导出它）。
- 所有状态变更一律 POST。会话是 httpOnly cookie，所以 CSRF 三重防护：`SameSite=Lax` + 只接受 POST + 校验 `HX-Request`；htmx 请求会话失效要回 `HX-Redirect`，不能回 401 JSON。
- SSR 渲染 `label` 与自定义文案时必须转义（htmx 把服务端 HTML 直接 swap 进 DOM，漏一处就是存储型 XSS）。
- D1 **只对只读查询自动重试**，写入路径的状态变更靠自带的幂等条件写入 + `writeWithRetry`。

## 技术栈

TypeScript（strict）· Cloudflare Workers + D1 · Vite 8 + `@cloudflare/vite-plugin` · Hono 4 + `hono/jsx` SSR · htmx 2 · Tailwind CSS 4 · Zod 4 · `otpauth` · wrangler（`wrangler.jsonc`）。

不用 ORM（签到 UPDATE 依赖 SQLite 的 `CASE` 与「右侧取旧值」语义，query builder 表达不了）、不用 SPA（签到页必须首屏即终态、无 JS 也能读懂）、不用 better-auth（D1 上只能走 drizzleAdapter，会连带引入 Drizzle 与 8 张表）。理由都写在 `docs/backend.md` §0。

## 已知取舍

| 取舍 | 代价 |
|---|---|
| 每日无条件发链接、发新链接时物理删除全部旧链接 | 任何时候最多一条有效链接，没有「已使用」审计 |
| 签到只能走当日链接 | 链接没送到就是当天签不了，可能误锁死；补偿只有重发 |
| 锁死后任意签到自动恢复 | 撤销不了已发出的最终消息 |
| 只有两条固定 cron | 非北京时区的用户看到的是本地 12:00/24:00 之外的时刻 |
| 无签到历史 / 无投递记录 | 排查只能靠 cron 健康、心跳与 owner 行时间戳 |

## 仓库状态

当前重写在分支 **`rewrite`** 上，是一个**孤立根 commit**（与 `master` 的旧实现无共同祖先）。因此 `rewrite → master` 的 PR 不会给出可用 diff，合并需要 `--allow-unrelated-histories`。`master` 保留旧版实现，作为回滚参照。

## 许可

还没有 LICENSE 文件。作为个人 OSS 项目公开前补一个。
