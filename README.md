# 死了吗 · silema

> 每天只有一条链接能证明你还活着。

Cloudflare Workers 上的每日确认系统（dead-man's switch）：每天 12:00 向通道发一条**当日一次性**签到链接，连续缺席到第 3 天就向紧急联系人发出预设的最终消息，次日 12:00 再发最后一条，之后**彻底静默**。只有 owner 再次签到才能恢复。

线上地址 <https://slm.liejiu.top>。规格文档：

- [`docs/backend.md`](docs/backend.md) — 状态机、两条 cron、API 表、完整 DDL
- [`docs/mobile-ui.md`](docs/mobile-ui.md) — 4 flows / 13 屏的 SSR 规格与「维生监护仪 · 夜视」视觉系统

---

## 它每天怎么运转

| 时刻（北京） | 任务 | 做什么 |
|---|---|---|
| 12:00 | `send` | normal 态：物理删除全部旧链接 → 铸造当日链接 → **无条件**发给所有「日常提醒」通道（当天已签到也发）。locked 态：发第二条、也是最后一条最终消息 |
| 24:00 | `judge` | 本周期签到过 → 缺席计数归零；没签 → 缺席 +1，第 1–2 天各发一次未签到提醒 |
| 缺席第 3 天 24:00 | `judge` | **锁死**：向所有「紧急联系人」通道发第一条最终消息，附一条 7 天有效的恢复链接 |
| 缺席第 4 天 12:00 | `send` | 发第二条最终消息。**发满两条后系统不再发送任何消息** |
| 之后 | 两个任务 | 只推进时间戳、照常喂心跳，一条消息都不发 |
| 再次签到 | — | 立即恢复 `normal`、缺席归零，同时撤销还没发出的那一条。已发出的最终消息**不可撤回** |

两条固定 cron 写在 `wrangler.jsonc` 的 `triggers.crons`（UTC `0 4` / `0 16`）。改时间 = 改这里并重新部署，后台没有签到时限类设置。

**「失败不消耗名额」**：名额按**送达**计。第一条整条失败时，次日 12:00 那次算补发而不是第二条，之后每天 12:00 继续重试，直到至少一个通道成功；成功后第二天 12:00 才发最后一条。所以紧急联系人最多收到两条，而通道临时故障不会让消息永久丢失。

## ⚠️ 使用前必须知道的边界

- **全站共用一条链接**，任何持有者都能替你签到续命。**不要把每日链接发到共享群 / 公共频道**，否则这个开关提供的保证为零。
- **后台没有签到按钮，也不存在 `POST /api/checkin`**。这是刻意的：「已签到」必须等价于「今天真的收到并点开了链接」，不能退化成登录后台点一下就算活着。
- `GET /c/:token` 只渲染确认页，长按确认才 `POST /c/:token/do`。邮件网关的自动抓取与 Safe Links 不会替你续命。
- **链接没送到 = 当天无法签到**，连吃 2 天提醒后第 3 天会误锁死。唯一的补救是后台「重发今日链接」（`POST /api/cron/resend`），它重发的仍是同一条当日令牌，不算签到。
- **锁死后系统不再主动给你任何链接**：日常链接在 locked 态一律不发，「重发今日链接」也被拒。恢复只能点最终消息里那条 7 天有效的链接——**过期即无从签到**，这是刻意的：过了这个窗口就认为你确实出事了。
- 不落签到流水、不落投递记录（唯一例外是 `owner.final_sent_at` / `final_second_at` 这两个送达时间戳，它们决定最终消息还欠几条）。**没有签到日历和趋势图**，这是刻意的存储面收敛。
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
| `miss1` / `miss2` | 连续缺席 1 / 2 天（第 2 天即最后警告） |
| `locked` | 已锁死，第一条已送达，等次日 12:00 的最后一条 |
| `locked-pending` | 已锁死但一条都没送达，每日 12:00 重试 |
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

---

## 部署到 Cloudflare

本仓库已经按 `slm.liejiu.top` 配好了（生产 D1 的 `database_id` 与 `routes` 都在 `wrangler.jsonc` 里）。换成你自己的域名/库时改这两处即可：

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

`wrangler secret put` 在本项目上会被平台拒绝（见上），所以旋转只能走「写 `.secrets.json` + 重新部署」这条路。新值全球传播要几秒钟，刚部署完立刻拿旧值试可能还是通的，别据此判断没生效。

关于密钥的几条语义（官方 `workers/configuration/secrets` + 实测）：

- `--secrets-file` 里没列出的密钥会**从上一个版本保留**，所以后续只改代码时直接 `npm run deploy` 不会丢密钥；`wrangler deploy` 也永远不会删密钥。
- 反过来，`vars` 以 `wrangler.jsonc` 为准：**在控制台改过的明文变量会在下次 deploy 时被覆盖**，别在控制台改 `SITE_URL`。
- **`wrangler secret put` 在本项目上用不了**（实测 2026-10-02）：Vite 插件部署时会上传多个版本，`secret put` 因此认定「the latest version of your Worker isn't currently deployed」并拒绝写入。改单个值就走上面的 `--apply`，或者去控制台的 Variables and Secrets。
- 还有一个 `secrets.required` 配置项（2026-03-24 新增）能让 deploy 前校验密钥齐不齐。**本仓库刻意不用**：一旦声明，`vite dev` 只会从 `.dev.vars` 加载列在里面的键，`SITE_URL` / `MOCK_SEND` / `DEV_HELPER` 会被排除，本地预览的链接就会指向生产域名。缺密钥时应用本身已经 fail-closed（`/api/auth/*` 与全部需登录接口 503 并列出缺哪几个），够用了。

`init-owner.cjs` 用 `INSERT … ON CONFLICT DO NOTHING`，重跑不会碰业务状态；只有 `--reset-totp` 会换掉密钥、清空恢复码并 bump `session_epoch`。

### 域名（2026-10-01 实测：全新落地，没有要解绑的东西）

账号里现在**既没有旧版 Worker `si-le-ma`、也没有 `silema`，没有 D1 `silema`，zone `liejiu.top` 里也没有任何 `slm` 记录**——`slm.liejiu.top` 目前是空的。所以不存在「先解绑再绑」的冲突，加上 `routes` 就行：

```jsonc
// wrangler.jsonc
"routes": [{ "pattern": "slm.liejiu.top", "custom_domain": true }]
```

`custom_domain` 由 Cloudflare 自动创建那条 `AAAA 100::` 记录并签发证书（zone 里 `dav` / `60s` / `sub` 三个都是这么来的），**不需要 DNS 写权限，需要的是 `Workers Routes: Write`**（官方授权文档：加/改/删 Route 与 Custom Domain 要 Worker 的 Editor + 每个受影响 zone 的 Workers Routes Write）。不加 `routes` 的话只有 `silema.liejiunb666.workers.dev` 可用，此时 `vars.SITE_URL` 必须跟着改成实际对外地址，否则消息里的签到链接指向错的域。

> Custom Domain **不能建在已有 CNAME 记录的主机名上**。`slm` 目前没有任何记录，所以不冲突。

遗留资产：旧库 D1 `d1-db`（id `d95e62c2-2d62-4a15-9f46-5b2026070421`）还在账号里，确认新版跑通后可以自行清理。邮件通道的 Resend DKIM（`resend._domainkey.mail.liejiu.top`）已经在 zone 里，所以 `EMAIL_FROM` 用 `…@mail.liejiu.top` 不需要再加 DNS。

---

## 环境变量

Secret 一律通过 `.secrets.json` + `wrangler deploy --secrets-file` 写入（见上；`wrangler secret put` 在本项目上会被平台拒掉）；本地放 `.dev.vars`（已 gitignore，`db:seed` 会自动生成）。

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

口令哈希用 **WebCrypto PBKDF2-SHA256（100k 轮）**而不是 bcrypt/argon2id：Workers 没有原生实现，纯 JS 的 bcrypt 会打爆 CPU 配额。**10 万轮是 workerd 的硬上限**，超过就直接抛 `iteration counts above 100000 are not supported`——本地 miniflare 用的是 Node 的 WebCrypto 没有这个限制，所以这个雷只在真机上炸。10 万轮低于 OWASP 当前建议，补偿是这道口令从不单独生效：必须同时有 TOTP（或恢复码），且登录按 IP 限流 10 次/15 分钟。格式自带算法与轮数前缀，所以将来换 argon2id（WASM）或平台放宽上限都不用改调用方。

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
  migrate.cjs        按序执行 migrations/*.sql（`--remote` 打到线上）；本地路径由 db:seed 顺带跑
  init-owner.cjs     生产 owner 行初始化 / --reset-totp
  _local.cjs         共用：wrangler D1 调用、北京墙钟、PBKDF2、TOTP
migrations/          0001_init.sql 建表 + 0002_final_second_message.sql 加 final_second_at
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
| 最终消息最多两条，之后彻底静默 | 误锁死时紧急联系人只会被打扰两次，但错过窗口的人只能靠那条 7 天恢复链接自救 |
| 锁死后只有恢复链接能自救 | 撤销不了已发出的最终消息；链接过期即无从签到，只能重建库 |
| 只有两条固定 cron | 非北京时区的用户看到的是本地 12:00/24:00 之外的时刻 |
| 无签到历史 / 无投递记录 | 排查只能靠 cron 健康、心跳与 owner 行时间戳 |

## 仓库状态

当前重写在分支 **`rewrite`** 上，是一个**孤立根 commit**（与 `master` 的旧实现无共同祖先）。因此 `rewrite → master` 的 PR 不会给出可用 diff，合并需要 `--allow-unrelated-histories`。`master` 保留旧版实现，作为回滚参照。

## 许可

还没有 LICENSE 文件。作为个人 OSS 项目公开前补一个。
