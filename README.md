# 死了吗（SiLeMa）— 签到通知系统

> 每天问自己一句：死了吗？没死就签个到。失联太久，系统替你把话说完。

所有者每日签到；超过时限未签到时，系统先向所有者发送最后警告，警告期过后仍未确认，则自动向全部已验证订阅者群发预设消息。

托管于 Cloudflare Workers，无需服务器。

```
                   签到（JWT）
        ┌──────────────────────────────┐
        │                              ▼
     normal ──超过签到时限──▶ warning ─────────────▶ normal
                                 │
                                 │ 警告期满仍未处理（每5分钟检查）
                                 ▼
                             triggered ──签到──▶ normal
                              │ (向订阅者群发一次 → 停止)
```

> 恢复只有一条路径：**签到**。警告期与触发后签到都不受冷却限制，会同时恢复
> normal、取消未投递的排队消息、重新计时并在日历留下记录。没有独立的「复位」接口。

## 功能特性

- **状态机**：normal → warning（发最后警告）→ triggered（群发一次）；Cron 每 5 分钟自动推进，投递失败自动重试（最多 3 次、间隔 10 分钟）；状态推进为**条件更新 + 队列唯一索引**双重保护，定时触发与手动 `/__cron` 并发也不会重复群发
- **单一恢复路径**：只有签到能恢复到 normal，且**在 warning / triggered 状态下不受冷却限制**；没有独立的「复位」接口
- **签到**：冷却期 = 签到时限的一半（上限 12 小时），避免时限调短后出现「已超时但签到仍被锁」；月度日历视图；按所有者 IANA 时区计算边界
- **多通道通知**：Email（Resend 或 Cloudflare 原生 Email Routing）/ Telegram / Bark / ntfy / Server酱(Turbo) / Server酱³ / Webhook
- **通知接收人（管理员手动管理）**：后台独立页面管理接收人并指定通道，每人独立勾选「警告开始」与「警告结束」两个事件，**勾选哪个事件就必须填写该事件要发送的内容**（内容随接收人走，首行=标题）；无公开订阅入口，杜绝被恶意订阅
- **消息内容变量**：内容里可插入占位符，发送时自动替换，后台提供一键插入按钮。完整列表见下节
- **快速签到链接**：`{checkin_url}` 会生成一条限时的一次性链接，**点开即完成签到**，无需登录
- **可观测性（死人开关的自监控）**：
  - **投递审计**：每一条消息的送达结果（成功 / 失败 / 重试次数 / 失败原因）都落库并在后台「最近投递」可见；签到时用**取消**而非删除，失败原因不会被抹掉
  - **警告也纳入审计**：警告发送失败同样留痕——它是所有者避免触发的最后机会，静默失败会导致无人察觉地直接触发群发
  - **Cron 心跳**：每次巡检记录成败，超过 15 分钟未巡检会在后台告警；可选配置外部监控（Healthchecks.io / Uptime Kuma），**仅在状态翻转时 ping**，不会产生 5 分钟一次的告警风暴
  - **横幅如实汇报**：「已触发」横幅按真实投递结果显示，全部失败时会明确告知「消息可能无人收到」，而非固定声称已发送
- **安全模型**：
  - 登录 = 用户名 + 密码 + TOTP，凭据来自 CF 机密变量（`ADMIN_USERNAME` / `ADMIN_PASSWORD`），不落库；JWT 有效期 **12 小时**
  - **单会话**：新登录立即吊销所有旧 token（session epoch）
  - 所有业务接口仅验证 Bearer Token，无额外验证头
   - 限流：登录 10 次/15 分钟（D1 固定窗口，单语句原子计数）
   - SSRF 防护：自建服务地址强制 HTTPS + 私网/云元数据黑名单 + 禁重定向；IPv4 侧归一化十进制/十六进制/八进制/inet_aton 变体，IPv6 侧解包 `::ffff:` 映射地址与 NAT64 前缀并覆盖 ULA / 链路本地 / 未指定地址；**写入时与发送时各校验一次**
   - 凭据比较先做 SHA-256 再常量时间比较（不泄露长度）；管理页输出全量转义防 XSS
   - 通道凭据（bot token / SendKey / Webhook 鉴权头）在**服务端**脱敏后才下发，浏览器端永远拿不到明文
   - 已知取舍：TOTP 未记录已消耗的时间片，同一验证码在 ±30 秒容差窗口内可重复使用（单管理员场景风险可接受；如需严格防重放可自行恢复 `last_totp_counter` 字段）

## 技术栈

| 组件 | 选型 |
|---|---|
| 运行时 | Cloudflare Workers（Hono 框架） |
| 数据库 | Cloudflare D1（SQLite） |
| 定时任务 | Cron Triggers（`*/5 * * * *`） |
| 邮件 | Resend HTTP API / Cloudflare Email Routing（`send_email` 绑定，二者皆可，自动选择） |

## 线上地址

- 自定义域名：**https://slm.liejiu.top**（后台：/admin）
- 备用：si-le-ma.liejiunb666.workers.dev

## 快速开始（全新部署）

```bash
npm install

# 1. 创建资源（如已有可跳过，并把 id 填入 wrangler.toml）
npx wrangler d1 create d1-db

# 2. 应用数据库迁移
npx wrangler d1 migrations apply d1-db --remote

# 3. 初始化所有者账户（生成 TOTP 密钥，只显示一次！同时写出 seed.sql）
node scripts/init-owner.cjs
npx wrangler d1 execute d1-db --remote --file seed.sql

# 4. 设置必需密钥
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))" | npx wrangler secret put JWT_SECRET
npx wrangler secret put ADMIN_USERNAME    # 输入你的管理员用户名
npx wrangler secret put ADMIN_PASSWORD    # 输入你的管理员密码

# 5. 部署
npx wrangler deploy
```

部署完成后，到后台侧边栏「**通知接收人**」添加联系人：勾选要通知的事件（警告开始/警告结束）并填写对应内容（配置方法见下文 [通知渠道配置](#通知渠道配置)）。

> ⚠️ `credentials.txt` 与 `seed.sql` 含敏感信息，用后即删（两者已被 `.gitignore` 排除，但删除才是最稳妥的做法）。

### 本地开发

```bash
echo "JWT_SECRET=local-dev-secret" > .dev.vars
echo "ADMIN_USERNAME=admin" >> .dev.vars
echo "ADMIN_PASSWORD=local-dev-password" >> .dev.vars
npx wrangler d1 migrations apply d1-db          # 本地迁移
node scripts/init-owner.cjs                     # 生成本地种子数据（TOTP）
npx wrangler d1 execute d1-db --local --file seed.sql
npx wrangler dev                                # http://localhost:8787
```

本地触发 Cron：`curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"`

## 配置

### Secrets（`wrangler secret put <NAME>`）

| 名称 | 必需 | 说明 |
|---|---|---|
| `JWT_SECRET` | ✅ | JWT 签名密钥 |
| `ADMIN_USERNAME` | ✅ | 管理员用户名（登录凭据，不落库） |
| `ADMIN_PASSWORD` | ✅ | 管理员密码（登录凭据，不落库） |
| `MAIL_FROM` | — | 发件人地址（CF 原生邮件模式必需；Resend 模式可选） |
| `RESEND_API_KEY` | — | 启用 Resend 邮件后端（优先于 CF 原生） |
| `CRON_SECRET` | — | 启用手动触发：`POST /__cron`（请求头 `X-Cron-Secret`） |
| `HEARTBEAT_URL` | — | 外部存活监控端点，从故障恢复时 ping（如 `https://hc-ping.com/<uuid>`） |
| `HEARTBEAT_FAIL_URL` | — | 巡检失败时 ping；**留空则回退到 `HEARTBEAT_URL` + `/fail`** |

### Vars（wrangler.toml `[vars]`）

| 名称 | 说明 |
|---|---|
| `APP_BASE_URL` | 自定义域名时填写；留空自动取请求 Origin（邮件/退订链接的基底） |

### 外部存活监控（可选，但强烈建议）

死人开关最致命的失败是**它自己悄悄坏了**：Cron 停了、D1 连不上、通道全挂，而所有人都以为它在工作。
后台会显示「上次巡检时间」并在超过 15 分钟未巡检时告警，但这仍要求你主动打开页面。要真正闭环，
配一个外部监控服务，让它在这个 Worker 不再 ping 时来通知你：

```bash
# Healthchecks.io（免费额度足够）：新建一个 check，把它的 ping URL 填进来
npx wrangler secret put HEARTBEAT_URL      # https://hc-ping.com/<uuid>
# 失败端点留空即可，会自动回退到 HEARTBEAT_URL + "/fail"
```

用 Uptime Kuma 等其他服务时，可单独指定失败端点：

```bash
npx wrangler secret put HEARTBEAT_FAIL_URL # https://kuma.example/api/push/xxx?status=down
```

ping 时机刻意做了节流，**只在状态翻转时发**，避免每 5 分钟一次的告警风暴：

| 情况 | 行为 |
|---|---|
| 巡检成功，且此前一直正常 | **不 ping** —— 外部服务靠「超时未收到」判断存活，持续 ping 只是噪音 |
| 巡检成功，且刚从故障恢复 | ping 成功端点 |
| 巡检失败，首次 | ping 失败端点 |
| 巡检失败，之后每隔 12 次（约每小时） | ping 失败端点 |
| 失败次数的中间态 | 不 ping |

> 心跳与遥测写库都包在独立的 `try/catch` 里，异常只记日志后吞掉 —— 监控逻辑永远不会反过来拖垮被监控的状态机。

## 页面

| 路径 | 说明 |
|---|---|
| `/` | 公开状态页：未签到小时数 + 绿/黄/红/灰 四级指示，60 秒自动刷新 |
| `/admin` | 管理后台：仪表盘、签到日历、通知接收人、设置（时区 / 签到周期） |
| `/c/<token>` | 快速签到页：由 `{checkin_url}` 生成，点开即完成签到，无需登录 |

## 消息内容变量

内容里写 `{占位符}`，发送时自动替换。**所有消息类型（警告开始 / 警告结束 / 测试发送）都支持全部变量**，后台编辑框下方有一排按钮，点击即可插入到光标处。时间类变量一律按所有者时区格式化。

| 占位符 | 替换为 | 备注 |
|---|---|---|
| `{checkin_url}` | 限时快速签到链接 | 见下节 |
| `{time}` | 触发时刻 | 仅「警告结束」有意义 |
| `{deadline}` | 确认截止时间 | 仅「警告开始」有意义 |
| `{last_checkin}` | 上次签到时间 | 无记录时为「尚无记录」 |
| `{hours}` | 距上次签到的小时数 | 保留一位小数 |
| `{label}` | 接收人备注名称 | |
| `{site}` | 站点地址 | `APP_BASE_URL` |
| `{expiry_hours}` | 签到时限（小时） | |
| `{warning_hours}` | 警告窗口（小时） | |

未知占位符会**原样保留**而不是被清空——拼错的时候能一眼看出来。

## 快速签到链接

`{checkin_url}` 会生成一条 `https://<你的域名>/c/<随机令牌>` 链接，**在浏览器里点开即完成签到**，不必登录后台。

- **令牌是 256 位随机串，存在 D1 里**（不是自签名 JWT）：可以查到每条链接何时生成、被点了几次，怀疑泄露时删表即可全部作废
- **一次事件只生成一条链接**：警告 / 触发时按事件（cycle）预先生成一条，所有频道的 `{checkin_url}` 都指向它。配了 N 个警告通道，你收到的 N 条消息里就是同一个入口，而不是 N 条互不相干、点过一条其余全废的链接；重试时按 cycle 查回同一条，不会每重试一次换一个入口
- **有效期**：警告消息 = 警告窗口 + 6 小时；触发消息 = 7 天；测试消息 = 1 小时
- **一次性**：首次成功签到后立即作废，再次打开显示「此链接已使用」。可重复链接意味着泄露后被他人持续续命，且「签到链接」语义上本就应是一次性；为免「我到底签上没有」的疑虑，作废后仍明确告知已签到，而非笼统报错

> **为什么不是点开链接的那一次 GET 直接签到？**
> 邮件里的链接会被机器抓：企业邮件网关的链接扫描、IMAP 客户端预取、微信 / Slack 的链接预览都会自动 GET 一遍。若 GET 本身就算签到，机器人会替所有者续命，**死人开关直接失去意义**。
> 所以 `GET /c/<token>` 只返回一个页面，页面加载时由脚本完成签到；不执行脚本的扫描器抓了也不会签到。对真人而言仍然是点开即完成，一步不多。脚本被禁用时页面会给出一个手动按钮兜底。

**关于「警告结束」里的签到链接**：放进去意味着**收到消息的人可以代你签到**——误报时联系人能帮你解除，但也等于把「撤销警报」的权力交了出去。请只对可信联系人使用。内置默认文案因此在「警告结束」里**不含**该变量，需要的话自己加。

## 通知渠道配置

通知对象完全由管理员在后台「**通知接收人**」页面手动管理，**没有公开订阅入口**。

每个接收人 = 备注名称 + 通道类型 + 通道配置（JSON）+ 两个独立事件开关，且**内容跟着接收人走**：

- **警告开始**：进入 warning 状态时收到提醒 → 必须填写「警告开始」内容
- **警告结束**：警告期满未确认、正式触发时收到预设消息 → 必须填写「警告结束」内容

两个内容框都支持上文的[全部变量](#消息内容变量)。

内容的**第一行自动作为消息标题**，其余为正文。添加后建议先点行内 **测试** 按钮——它会按该接收人已配置的真实内容各发一条（带 `[测试]` 前缀）。七个字段说明如下。

### Email（两种发送后端，自动选择）

| 后端 | 启用条件 | 特点 |
|---|---|---|
| Cloudflare 原生（send_email 绑定） | 已开启 Email Routing + 设置 `MAIL_FROM` | 免费、无第三方；**收件人必须先在 CF 验证** |
| Resend | 设置 `RESEND_API_KEY` | 任意收件人；需域名验证；免费 100 封/天 |

两个都配置时**优先走 Resend**。

```json
{ "email": "you@example.com" }
```

**Cloudflare 原生模式配置步骤：**

1. CF 控制台 → 你的域名 → **Email Routing → Destination addresses** → 添加收件人邮箱并点击验证邮件中的确认链接（每个收件人一次即可）
2. 设置发件人密钥：
   ```bash
   npx wrangler secret put MAIL_FROM
   # 内容示例：dms@example.com 或 "DMS <dms@example.com>"
   # 地址必须是已开启 Email Routing 的域名下的
   ```
3. 完成——wrangler.toml 中的 `[[send_email]]` 绑定已在部署时生效

**Resend 模式配置步骤：**

```bash
npx wrangler secret put RESEND_API_KEY   # resend.com 创建
npx wrangler secret put MAIL_FROM        # 如 "DMS <dms@your-verified-domain.com>"
```

- 正文按 HTML 渲染；未验证域名时 Resend 只能用测试发件人 `onboarding@resend.dev`（仅能发给自己账号邮箱）

### Telegram

向 [@BotFather](https://t.me/BotFather) 发送 `/newbot` 创建机器人获得 **Bot Token**（格式 `数字:字母串`）；向新机器人随便发一条消息后访问 `https://api.telegram.org/bot<token>/getUpdates`，在返回的 `message.chat.id` 中读取 **Chat ID**（群聊为负数）。

```json
{ "chatId": "123456789", "botToken": "<BOT_TOKEN>" }
```

- 消息以 HTML parse_mode 发送，标题加粗
- 通知由**该 bot** 发出到指定 chat，即接收人提供自己的 bot token 与自己的 chat id

### Bark（iOS）

App Store 安装 [Bark](https://apps.apple.com/app/bark-customed-notifications/id1403753865)，打开 App 复制到的 URL 中 `https://api.day.app/` 后面那段即为 **Key**。

```json
{ "key": "qmpHjcbYrG9aXwTteybC3S" }
```

自建服务器时额外传 `server`（必须 HTTPS 且非内网地址）：

```json
{ "key": "qmpHjcbYrG9aXwTteybC3S", "server": "https://bark.example.com" }
```

### ntfy

无需注册：在 ntfy App / [ntfy.sh](https://ntfy.sh) 中自定义一个足够随机的 **topic** 名即可（知道名字就能收，务必防猜）。支持自建服务器。

```json
{ "server": "https://ntfy.sh", "topic": "dms-alert-x7k2p9" }
```

- `server` 可省略（默认 `https://ntfy.sh`）；topic 仅允许字母/数字/`_`/`-`，长度 1–64
- 消息以 Markdown、高优先级、骷髅标签推送

### Server酱³

登录 [sct.ftqq.com](https://sct.ftqq.com) 获取 **SendKey**（格式 `SCT` 开头的字母数字串），并在官网「消息通道」页面完成微信/企业微信等通道绑定。

```json
{ "sendKey": "SCT123456Taxxxxxxxxxxxxxxxx" }
```

可选参数（对应官方 API 的同名参数）：

| 字段 | 说明 |
|---|---|
| `channel` | 临时指定消息通道，最多两个用 `\|` 分隔，如 `"9\|66"`（方糖服务号=9、企业微信应用=66、Bark iOS=8 等） |
| `openid` | 抄送接收人（仅测试号/企业微信应用通道支持），多个用 `,` 或 `\|` 分隔 |
| `noip` | 设为 `"1"` 隐藏调用 IP |

```json
{ "sendKey": "SCT123456Taxxxxxxxxxxxxxxxx", "channel": "9|66", "noip": "1" }
```

- 消息以 Markdown 推送；标题超 32 字符自动截断，正文上限 32KB
- 官方为**异步队列**推送：接口返回成功仅代表入队，实际到达有数秒延迟
- 若测试提示 `[AUTH] 错误的Key` → SendKey 不对；若入队成功但微信收不到 → 去官网检查「消息通道」是否已绑定并保存

### Server酱³（ft07.com，APP 推送）

> 注意：Server酱³ 与上面的 Server酱 Turbo 是**两个独立服务**，用户系统和 SendKey 不通用。
> ³ 专注手机 APP 推送；要推微信请用 Turbo 版。

登录 [sc3.ft07.com/sendkey](https://sc3.ft07.com/sendkey) 获取 **SendKey** 并安装官方 App。Key 形如 `sctp<uid>tXXXX…`，**uid 会自动从 Key 中提取**：

```json
{ "sendKey": "sctp12345tabcdefgh12345" }
```

若 Key 不是 `sctp` 开头（无法自动提取 uid），需显式提供页面上的数字 uid：

```json
{ "sendKey": "abcdefgh12345678", "uid": "12345" }
```

可选字段：`tags`（标签，竖线分隔）、`short`（消息卡片简述，≤64 字符）。

- 正文支持 Markdown（APP 内展示）；标题超长自动截断
- 无微信每日 5 条限制，适合高频测试

### Webhook

收到 POST 请求时，系统发送如下 JSON：

```json
{
  "title": "Dead Man's Switch Triggered",
  "body": "正文内容",
  "imageUrl": null,
  "time": "2026-08-25T12:00:00.000Z"
}
```

```json
{
  "url": "https://hooks.example.com/dms",
  "method": "POST",
  "headers": { "Authorization": "Bearer xxxxx", "X-Custom": "value" }
}
```

- `url` 必须 HTTPS 且禁止内网/环回/云元数据地址，禁跟随重定向
- `method` 可选 `POST`（默认）/ `PUT`；`headers` 可省略
- 企业微信/钉钉/飞书机器人等场景可在 `headers` 里放各自的鉴权头

### 通用规则与建议

1. 所有 `server` / `url` 类字段强制 HTTPS，且拒绝私网段（127.x / 10.x / 172.16-31.x / 192.168.x / 169.254.x 等）
2. 配置保存前服务端会做格式校验，不合法直接拒绝并提示原因
3. 添加接收人后，先用行内 **测试** 按钮（按已配置内容真实发送）确认链路通畅，再依赖它做最后警告
4. 每个接收人各自携带要发送的内容：勾选「警告开始」/「警告结束」时必须填写对应内容（首行=标题），可随时点行内铅笔按钮修改。Email 为 HTML、ntfy/Server酱为 Markdown、Telegram 为受限 HTML（仅 `<b>`/`<i>`/`<u>`/`<s>`/`<a>`/`<code>`/`<pre>` 会被保留，其余 `<` `&` 自动转义，不会因内容里的尖括号导致整条发送失败）、Bark 为纯文本；正文里可直接粘贴外部图片链接

## API 一览

### 公开
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/status` | `{hoursSinceCheckin, state, level, ratio, cooldownSec, timezone}`，level: green/yellow/red/dark |

### 认证（Bearer Token）
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{username, password, totpCode}` → `{token}`，凭据对照 CF 机密变量，签发同时吊销旧会话 |
| POST | `/api/checkin` | 签到：恢复 normal、取消未投递的排队消息、重新计时并写入日历。**冷却期为签到时限的一半（上限 12h），且仅在 normal 状态生效**——warning / triggered 下随时可签到；冷却中返回 429 + `nextCheckinAt` |
| GET | `/api/checkin/list?y=&m=` | 月度签到列表（按所有者时区） |
| GET/PUT | `/api/settings` | 时区 / 签到时限 / 警告期 / 上次签到时间 |
| GET/POST | `/api/recipients` · PUT/DELETE `/api/recipients/:id` | 通知接收人管理（label / channelType / config / onWarning / onTrigger / warningContent / triggerContent，勾选的事件内容必填） |
| POST | `/api/recipients/:id/test` | 按该接收人已配置的真实内容发送测试；删除时自动取消其排队消息 |
| GET | `/api/deliveries?limit=50` | 投递审计日志（最近优先）+ 最新一轮群发的成败统计 `summary` |
| POST | `/__cron` | 手动触发状态机（需 `X-Cron-Secret`） |

## 项目结构

```
src/
├── index.ts        # 路由装配、scheduled 导出、公开状态接口
├── guard.ts        # JWT 签发/校验、单会话 epoch、鉴权中间件
├── auth.ts         # 登录（用户名+密码+TOTP）+ 登录限流
├── checkin.ts      # 签到（冷却推导）+ 月历（时区感知）
├── cron.ts         # 状态机推进、警告下发与投递、警告落库、保留期清理
├── health.ts       # cron 遥测（成败记录、连续失败计数、外部心跳）
├── recipients.ts   # 通知接收人 CRUD + 按人内容 + 凭据脱敏 + 测试发送
├── adapters.ts     # 七通道适配器 + SSRF 防护 + Resend / CF 邮件
├── messages.ts     # 消息切分 + 占位符注册表 + 变量构造（所有消息共用一套）
├── token.ts        # 快速签到令牌：按事件统一签发、校验、一次性消费、过期清理
├── ratelimit.ts    # D1 固定窗口限流
├── crypto.ts       # 常量时间字符串比较（先哈希归一化长度）
├── totp.ts         # RFC 6238 TOTP（WebCrypto 实现）
├── time.ts         # IANA 时区工具
└── pages/          # 内联前端页面（admin / public / checkin）
migrations/         # D1 schema 迁移（0001-0012；0001-0004 含已被后续迁移取代的历史
                    #  表，按序执行即可。messages 表自 0008 起不再被读取，仅为存量用户
                    #  保留。0010 新增 system_state 与 deliveries.purpose，0011 把幂等
                    #  唯一索引扩为 (recipient_id, cycle, purpose)，0012 新增
                    #  checkin_tokens 表）
scripts/init-owner.cjs  # 所有者 TOTP 与种子 SQL 生成器
```

## 安全须知

- 初始化输出的 TOTP 密钥**只显示一次**，请存入密码管理器
- 管理员用户名 / 密码由 CF 机密变量管理：`npx wrangler secret put ADMIN_USERNAME` / `ADMIN_PASSWORD`，修改即时生效、无需重新部署
- 忘记 TOTP 无法登录时：用 CLI 生成新密钥并更新数据库 totp_secret 字段即可重新绑定验证器
- 新设备登录会使其他设备会话立即失效（单会话设计）
- 若怀疑凭据泄露：`wrangler secret put ADMIN_PASSWORD` 立即轮换密码；必要时重跑 `init-owner.cjs` 更换整行 owner 记录（含 TOTP）
- 接收人的通道配置（如 bot token）仅管理员可见：`GET /api/recipients` 在**服务端**就已对凭据脱敏，浏览器拿不到明文（后台列表只是二次展示）。因此通道配置属于「只写」字段——要更换凭据请删除后重新添加
- 测试发送按来源 IP 限流（20 次/小时），避免误触 Server酱 等渠道的每日免费额度

## 开源协议

本项目基于 [GPL-3.0](./LICENSE) 协议开源。
