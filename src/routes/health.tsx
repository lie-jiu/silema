import type { Child } from "hono/jsx";
import type { FC } from "hono/jsx";
import type { OwnerRow } from "../lib/db";
import { LIMITS, type Health, type Level } from "../lib/health";
import { fmtAgo, fmtClock } from "../lib/time";
import { Card, Label, Led, Notice } from "../ui/kit";
import { Shell, type Flash } from "../ui/shell";

export function HealthPage(props: { owner: OwnerRow | null; health: Health; flash?: Flash; now: number }): ReturnType<FC> {
  const o = props.owner;
  const tz = o?.timezone ?? "Asia/Shanghai";
  return (
    <Shell
      title="巡检健康"
      shell="admin"
      tab="settings"
      htmx
      navTitle="巡检健康"
      backHref="/admin/settings"
      flash={props.flash}
      scripts={["/assets/dialog.js"]}
    >
      <div class="p-4 flex flex-col gap-3.5">
        <details class="panel px-4 py-1 rise" open>
          <summary class="flex items-center gap-2 py-3 min-h-12 cursor-pointer text-body font-semibold select-none">
            健康是怎么判定的
            <span class="ml-auto text-label opacity-45">展开</span>
          </summary>
          <div class="pb-3.5">
            <Notice tone="info">
              看时间戳，不看最后一次 cron 的结果。owner 行只有一个 <code class="readout">last_cron_error</code>{" "}
              槽位，同一次运行里判定与发送的错误合并写进这一格、下一次运行又整格覆盖，所以后台直接用{" "}
              <code class="readout">now − last_send_at &gt; {LIMITS.SEND_LIMIT_H}h</code> 与{" "}
              <code class="readout">now − last_judge_at &gt; {LIMITS.JUDGE_LIMIT_H}h</code> 判红。
            </Notice>
          </div>
        </details>

        <Card flush class="rise">
          <div class="px-4 pt-3.5 pb-1">
            <Label>任务时间戳</Label>
          </div>
          <Line
            label="最近发送 · 12:00（唯一的投递窗口）"
            level={o ? props.health.send.level : "unknown"}
            value={o?.last_send_at == null ? "从未" : `${fmtClock(tz, o.last_send_at)}`}
            meta={o?.last_send_at == null ? "—" : fmtAgo(o.last_send_at, props.now)}
            note={props.health.send.note}
          />
          <Line
            label="最近判定 · 12:00 发送之前（不发任何消息）"
            level={o ? props.health.judge.level : "unknown"}
            value={o ? fmtClock(tz, o.last_judge_at) : "读不到数据"}
            meta={o ? fmtAgo(o.last_judge_at, props.now) : "—"}
            note={props.health.judge.note}
          />
          <div class="h-px bg-ink/6"></div>
          <div class="px-4 pt-3.5 pb-1">
            <Label>外部心跳（两个 check，由同一次 12:00 运行分别喂）</Label>
          </div>
          <Line
            label="heartbeat · send"
            level={props.health.send.level}
            value={props.health.send.hours == null ? "无数据" : `失联 ${Math.round(props.health.send.hours)}h`}
            meta={`阈值 ${LIMITS.SEND_LIMIT_H}h`}
          />
          <Line
            label="heartbeat · judge"
            level={props.health.judge.level}
            value={props.health.judge.hours == null ? "无数据" : `失联 ${Math.round(props.health.judge.hours)}h`}
            meta={`阈值 ${LIMITS.JUDGE_LIMIT_H}h`}
          />
          <div class="h-px bg-ink/6"></div>
          <Line
            label="最近一次 cron"
            level={o?.last_cron_status === "error" ? "warn" : "ok"}
            value={o?.last_cron_at == null ? "从未运行" : (o.last_cron_status ?? "—")}
            meta={o?.last_cron_at == null ? "—" : fmtAgo(o.last_cron_at, props.now)}
          />
        </Card>

        {o?.last_cron_error ? (
          <Card tone="danger" class="rise">
            <Label>
              <span class="text-danger">最近错误原文</span>
            </Label>
            <pre class="readout text-label whitespace-pre-wrap break-all select-all leading-relaxed">
              {o.last_cron_error}
            </pre>
            <div class="mt-2.5 text-label opacity-60">
              前缀 <code class="readout">[send]</code> / <code class="readout">[judge]</code> 标明是哪个阶段。
            </div>
          </Card>
        ) : null}

        <Card class="rise">
          <Label>告警接收方</Label>
          <div class="text-label opacity-60 leading-relaxed">
            心跳兜底的前提是所有者已失联，所以告警必须至少指向一名「紧急联系人」——只通知本人的告警等于没有。
          </div>
        </Card>
      </div>
    </Shell>
  );
}

const LEVEL_LABEL: Record<Level, string> = { ok: "正常", warn: "注意", error: "异常", unknown: "未知" };

function Line(props: { label: string; level: Level; value: Child; meta?: Child; note?: string | null }): ReturnType<FC> {
  const tone = props.level === "ok" ? "ok" : props.level === "warn" ? "warn" : "danger";
  return (
    <div class="row items-start">
      <span class="mt-1.5">
        <Led tone={tone} live={props.level === "ok"} />
      </span>
      <span class="flex-1 min-w-0">
        <span class="block text-label opacity-55">{props.label}</span>
        <span class="block mt-1 text-body readout truncate">{props.value}</span>
        {props.note ? <span class="block mt-1 text-label text-danger">{props.note}</span> : null}
      </span>
      <span class="shrink-0 text-right">
        <span class={`block text-label font-semibold ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-danger"}`}>
          {LEVEL_LABEL[props.level]}
        </span>
        {props.meta ? <span class="block mt-1 text-label opacity-50 readout">{props.meta}</span> : null}
      </span>
    </div>
  );
}
