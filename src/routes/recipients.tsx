import type { Child } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { ChannelType } from "../lib/channels";
import { CHANNELS, CHANNEL_TYPES, maskValue } from "../lib/channels";
import type { RecipientRow } from "../lib/recipients";
import { Button, Card, ConfirmDialog, Field, Notice, OpenDialog, Switch } from "../ui/kit";
import { Shell, type Flash } from "../ui/shell";

export function recipientBrief(row: RecipientRow): { type: ChannelType; shown: string } {
  let config: Record<string, string> = {};
  try {
    config = JSON.parse(row.config_json);
  } catch {
    config = {};
  }
  const id =
    config.chatId ?? config.to ?? config.topic ?? config.key ?? config.sendKey ?? config.url ?? "";
  return { type: row.channel_type, shown: String(id).slice(-18) };
}

function ChannelGlyph({ type }: { type: ChannelType }): ReturnType<FC> {
  const p = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7 };
  const paths: Record<ChannelType, unknown> = {
    email: <path d="M3 6h18v12H3zM3 7l9 6 9-6" />,
    telegram: <path d="M3 11l17-7-4 16-6-4-3 3-1-5z" />,
    bark: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12h8M12 8v8" />,
    ntfy: <path d="M4 9v6h4l6 4V5L8 9zM17 9a4 4 0 0 1 0 6" />,
    serverchan: <path d="M6 4h12v14H6zM9 8h6M9 12h6M9 16h3" />,
    serverchan3: <path d="M4 7h16v10H4zM8 7V4M16 7V4M9 12h6" />,
    webhook: <path d="M10 13a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.7-5.7L12 6M14 11a4 4 0 0 0-6-.5l-3 3A4 4 0 0 0 10.7 19L12 18" />,
  };
  return (
    <span class="w-9 h-9 shrink-0 rounded-field bg-primary/5 text-primary flex items-center justify-center">
      <svg {...p}>{paths[type]}</svg>
    </span>
  );
}

export function RecipientsPage(props: {
  rows: RecipientRow[];
  flash?: Flash;
  now: number;
}): ReturnType<FC> {
  const finalCount = props.rows.filter((r) => r.on_final === 1).length;
  const promptCount = props.rows.filter((r) => r.on_prompt === 1).length;

  return (
    <Shell
      title="接收人"
      shell="admin"
      tab="recipients"
      htmx
      scripts={["/assets/dialog.js"]}
      navTitle="接收人"
      flash={props.flash}
      actions={
        <a href="/admin/recipients/new" class="tap-target px-2 flex items-center justify-center text-primary" aria-label="新增接收人">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </a>
      }
    >
      <div class="p-4 flex flex-col gap-3">
        <Notice tone={finalCount === 0 ? "danger" : finalCount === 1 ? "warn" : "neutral"}>
          紧急联系人 <b class="tabular-nums">{finalCount}</b> 人 · 日常提醒{" "}
          <b class="tabular-nums">{promptCount}</b> 人
          {finalCount === 0
            ? "：还没有紧急联系人，锁死时不会有任何人收到最终消息 —— 这套开关目前等于没有兜底。"
            : finalCount === 1
              ? "：只剩 1 位紧急联系人，删除或退订前需要先指定另一位。"
              : ""}
        </Notice>

        {props.rows.length === 0 ? (
          <Card class="rise !pt-8 !pb-9 text-center">
            <div class="mx-auto w-14 h-14 rounded-full bg-primary/6 border border-primary/15 flex items-center justify-center text-primary">
              <ChannelGlyph type="webhook" />
            </div>
            <div class="mt-4 text-num font-semibold tracking-tight">还没有接收人</div>
            <div class="mt-2 text-label opacity-60">锁死时没有人会收到通知</div>
            <div class="mt-4">
              <Button href="/admin/recipients/new">添加第一个接收人</Button>
            </div>
          </Card>
        ) : (
          <ul class="panel divide-y divide-ink/6 overflow-hidden rise">
            {props.rows.map((row) => {
              const brief = recipientBrief(row);
              return (
                <li key={row.id} class="row !px-3.5 !py-2">
                  <a
                    href={`/admin/recipients/${row.id}`}
                    class="flex-1 flex items-center gap-3 py-3 min-h-14 active:bg-ink/3"
                    aria-label={`编辑 ${row.label}`}
                  >
                    <ChannelGlyph type={brief.type} />
                    <span class="flex-1 min-w-0">
                      <span class="block text-body font-semibold truncate">{row.label}</span>
                      <span class="block text-label opacity-60 truncate mt-0.5 tabular-nums">
                        {CHANNELS[brief.type].name} · {brief.shown ? maskValue(brief.shown) : "未配置"}
                      </span>
                    </span>
                  </a>
                  <span class="flex gap-1 shrink-0">
                    {row.on_prompt === 1 ? (
                      <span class="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-label font-semibold">日常</span>
                    ) : null}
                    {row.on_final === 1 ? (
                      <span class="px-1.5 py-0.5 rounded bg-danger/10 text-danger text-label font-semibold">紧急</span>
                    ) : null}
                  </span>
                  <OpenDialog
                    target={`del-${row.id}`}
                    class="tap-target w-11 flex items-center justify-center text-danger opacity-70"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                    </svg>
                  </OpenDialog>
                </li>
              );
            })}
          </ul>
        )}

        {/* 左滑删除降级为行内删除按钮 + <dialog>：不为手势牺牲可用性（docs/mobile-ui.md §1.5） */}
        {props.rows.map((row) => (
          <ConfirmDialog
            key={row.id}
            id={`del-${row.id}`}
            title={`删除「${row.label}」？`}
            body={
              row.on_final === 1 && finalCount === 1
              ? "至少需要保留一位紧急联系人。要删除这一位，请先指定另一位接收「最终消息」。"
              : row.on_final === 1
                ? "该通道将不再收到任何通知。删除后会向 TA 本人以及其余紧急联系人发出一条变更告知。"
                : "该通道将不再收到任何通知。"
            }
            confirmText={row.on_final === 1 && finalCount === 1 ? "知道了" : "删除"}
            post={row.on_final === 1 && finalCount === 1 ? undefined : `/api/recipients/${row.id}/delete`}
            go="/admin/recipients?flash=deleted"
          />
        ))}
      </div>
    </Shell>
  );
}

/** 动态凭据字段片段：7 套 schema 不下发到前端，切换通道时由服务端渲染回来。 */
export function ChannelFields(props: {
  type: ChannelType;
  config: Record<string, string>;
  masked: boolean;
  errors: string[];
}): ReturnType<FC> {
  const def = CHANNELS[props.type];
  return (
    <div class="flex flex-col gap-3">
      {def.fields.map((f) => {
        const raw = props.config[f.key] ?? "";
        const value = props.masked && f.secret ? maskValue(raw) : raw;
        return (
          <Field
            key={f.key}
            label={f.label}
            name={`config[${f.key}]`}
            value={value}
            type={f.kind === "url" ? "url" : f.kind === "email" ? "email" : "text"}
            inputmode={f.kind === "numeric" ? "numeric" : undefined}
            required={!f.optional}
            hint={f.hint}
            secret={f.secret && props.masked && raw ? maskValue(raw) : undefined}
          />
        );
      })}
      {props.errors.length > 0 ? (
        <Notice tone="danger" title="字段有问题">
          <ul class="list-disc pl-4">
            {props.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  );
}

export function RecipientEditPage(props: {
  row: RecipientRow | null;
  type: ChannelType;
  config: Record<string, string>;
  masked: boolean;
  values: {
    label: string;
    onPrompt: boolean;
    onFinal: boolean;
    promptContent: string;
    reminderContent: string;
    finalContent: string;
  };
  errors: string[];
  fieldErrors: Record<string, string>;
}): ReturnType<FC> {
  const row = props.row;
  const isNew = row == null;
  const action = row ? `/api/recipients/${row.id}/save` : "/api/recipients";
  const banner = props.errors.length > 0;

  return (
    <Shell
      title={isNew ? "新增接收人" : "编辑接收人"}
      shell="admin"
      tab="recipients"
      htmx
      scripts={["/assets/dialog.js", "/assets/chips.js"]}
      navTitle={row ? row.label : "新增接收人"}
      backHref="/admin/recipients"
    >
      {/* 主表单用原生 POST + 302：不依赖 JS 也能保存，校验失败由服务端整页回显 */}
      <form method="post" action={action} id="recipient-form" class="pb-24">
        <input type="hidden" name="editingId" value={row ? String(row.id) : "0"} />
        {banner ? (
          <div class="px-4 pt-4">
            <Notice tone="danger" title="没有保存">
              <ul class="list-disc pl-4">
                {props.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Notice>
          </div>
        ) : null}

        <div class="p-4 flex flex-col gap-4">
          <Card>
            <div class="micro mb-3">基本信息</div>
            <Field label="名称" name="label" value={props.values.label} maxlength={40} required hint="会渲染进消息与页面，后端负责转义" />
            {props.fieldErrors.label ? <div class="mt-1 text-label text-danger">{props.fieldErrors.label}</div> : null}
          </Card>

          <Card>
            <div class="micro mb-3">通知通道</div>
            <div class="grid grid-cols-2 gap-2 mb-4">
              {CHANNEL_TYPES.map((t) => (
                /* 高亮必须由 :checked 驱动，不能由服务端写死的 class 驱动：
                   点选只会改原生 radio 的状态，class 不重渲染，选中框会留在旧卡片上。 */
                <label
                  key={t}
                  class="flex items-center gap-2 px-3 py-2.5 rounded-field border border-ink/12 bg-panel/60 opacity-75 text-body cursor-pointer min-h-12 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/6 has-[:checked]:text-primary-ink has-[:checked]:font-semibold has-[:checked]:shadow-brand has-[:checked]:opacity-100"
                >
                  <input
                    type="radio"
                    name="channelType"
                    value={t}
                    checked={t === props.type}
                    class="w-4 h-4"
                  />
                  {CHANNELS[t].name}
                </label>
              ))}
            </div>
            <div class="mb-2 text-label opacity-60">
              换通道后需要点一次「载入该通道的字段」——字段由服务端渲染，不把 7 套 schema 打包到前端。
            </div>
            <button
              type="button"
              hx-post="/api/recipients/fields"
              hx-include="#recipient-form"
              hx-target="#channel-fields"
              hx-swap="innerHTML settle:240ms"
              class="btn btn-ghost h-11 px-4 text-body"
            >
              载入该通道的字段
            </button>
            <div id="channel-fields" class="mt-4">
              <ChannelFields
                type={props.type}
                config={props.config}
                masked={props.masked}
                errors={props.errors.filter((e) => e.startsWith("field:"))}
              />
            </div>
          </Card>

          <Card>
            <div class="micro mb-2">事件订阅</div>
            <Switch name="onPrompt" checked={props.values.onPrompt} label="日常提醒" desc="每天 12:00 唯一的那条消息；24:00 判定为缺席后，次日这条自动换成未签到提醒" />
            <Switch name="onFinal" checked={props.values.onFinal} label="紧急联系人" desc="锁死时接收最终消息；名单或接收方式变动时会告知变更前的所有人" />
          </Card>

          <Card class="flex flex-col gap-4">
            <div class="micro">消息文案 · 留空用内置默认，首行为标题</div>
            <MessageBlock
              id="promptContent"
              name="promptContent"
              label="日常签到链接"
              value={props.values.promptContent}
              event="prompt"
              needed={props.values.onPrompt}
              error={props.fieldErrors.promptContent}
            />
            <MessageBlock
              id="reminderContent"
              name="reminderContent"
              label="未签到提醒（缺席期替换当日那条，仍是同一天唯一的一条消息）"
              value={props.values.reminderContent}
              event="reminder"
              needed={props.values.onPrompt}
              error={props.fieldErrors.reminderContent}
            />
            <MessageBlock
              id="finalContent"
              name="finalContent"
              label="最终消息"
              value={props.values.finalContent}
              event="final"
              needed={props.values.onFinal}
              error={props.fieldErrors.finalContent}
            />
          </Card>

          {!isNew ? (
            <Card>
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="text-body font-semibold">测试发送</div>
                  <div class="text-label opacity-60 mt-1">用已保存的配置真实发一条，带 [测试] 前缀</div>
                </div>
                <OpenDialog target="test-dialog" class="btn btn-ghost h-11 px-4 text-body">
                  测试
                </OpenDialog>
              </div>
            </Card>
          ) : null}
        </div>

        {/* 长表单：主按钮吸底但不跟随键盘上移（docs/mobile-ui.md §1.4） */}
        <div class="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] px-4 py-3 pb-safe bg-canvas/88 backdrop-blur-xl border-t border-ink/8 flex gap-2.5">
          <a href="/admin/recipients" class="btn btn-flat flex-1">
            取消
          </a>
          <button type="submit" class="btn btn-primary flex-1">
            保存
          </button>
        </div>
      </form>

      {props.row ? (
        <dialog id="test-dialog" class="w-full max-w-[380px] rounded-dialog p-0 backdrop:bg-canvas/82">
          <div class="panel p-5 flex flex-col gap-3">
            <h3 class="text-sub font-semibold">测试发送</h3>
            <Notice tone="neutral">
              会真实发送到该通道，消息带 <b>[测试]</b> 前缀，并附一条 5 分钟短效链接。
            </Notice>
            <Notice tone="warn">这条测试链接点开不会记为签到。</Notice>
            <div id="test-result"></div>
            <div class="flex gap-2">
              <button type="button" data-close-dialog class="btn btn-flat flex-1 h-11 text-body">
                关闭
              </button>
              <button
                type="button"
                hx-post={`/api/recipients/${props.row.id}/test`}
                hx-target="#test-result"
                hx-swap="innerHTML settle:240ms"
                class="btn btn-primary flex-1 h-11 text-body"
              >
                发送
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </Shell>
  );
}

function MessageBlock(props: {
  id: string;
  name: string;
  label: string;
  value: string;
  event: "prompt" | "reminder" | "final";
  needed: boolean;
  error?: string;
}): ReturnType<FC> {
  const chips: Record<string, string[]> = {
    prompt: ["{checkin_url}", "{site}", "{label}"],
    reminder: ["{checkin_url}", "{site}", "{label}", "{last_checkin}", "{missed_days}", "{reminder_index}"],
    final: ["{checkin_url}", "{site}", "{label}", "{last_checkin}", "{missed_days}", "{time}"],
  };
  return (
    <div>
      <label for={props.id} class="block text-label opacity-60 mb-1">
        {props.label}
        {props.needed ? <span class="opacity-50">（留空则用内置默认文案）</span> : <span class="opacity-50">（未勾选对应事件，可留空）</span>}
      </label>
      <div class="flex flex-wrap gap-1 mb-2">
        {chips[props.event].map((c) => (
          <button
            key={c}
            type="button"
            data-chip={c}
            data-chip-into={props.id}
            class="px-2 py-1 rounded bg-ink/5 text-label font-mono min-h-11"
          >
            {c}
          </button>
        ))}
      </div>
      <textarea
        id={props.id}
        name={props.name}
        rows={4}
        class="w-full px-3 py-2 rounded-field border border-ink/15 bg-panel text-body leading-relaxed"
      >
        {props.value}
      </textarea>
      {props.error ? <div class="mt-1 text-label text-danger">{props.error}</div> : null}
    </div>
  );
}
