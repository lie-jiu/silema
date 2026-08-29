import type { Message } from "./types";

/* Built-in fallbacks for legacy rows created before per-recipient content
 * existed (their *_content columns are empty). */
export const DEFAULT_WARNING_TITLE = "⚠️ 死了吗 — 你还好吗";
export const DEFAULT_WARNING_BODY =
  "你已超过签到时限未签到。若在 {deadline} 之前仍未确认，系统将向所有订阅者发送你的预设消息。\n\n点此一键签到：{checkin_url}\n\n（链接有效期有限，也可登录 {site} 手动签到）";
export const DEFAULT_TRIGGER_TITLE = "死了吗：主人失联了";
export const DEFAULT_TRIGGER_BODY =
  "所有者已超过设定时限未签到，于 {time} 触发本条预设消息。\n\n最后一次签到：{last_checkin}（已过去 {hours} 小时）";

export interface SplitMsg {
  title?: string;
  body: string;
}

// First line = title, remainder = body. A single-line text is used as both.
export function splitMessage(content: string): SplitMsg {
  const idx = content.indexOf("\n");
  if (idx === -1) return { body: content };
  const first = content.slice(0, idx).trim();
  const rest = content.slice(idx + 1).trim();
  return first ? { title: first, body: rest || first } : { body: rest };
}

// Replace {placeholder} tokens; unknown names are left untouched so typos
// stay visible instead of silently vanishing from the message.
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k]! : m));
}

/* ---------------- 占位符注册表 ----------------
 *
 * 单一事实来源：后台 UI 的提示文案与插入按钮、服务端实际替换用的变量表，
 * 全部由这里派生。此前 {time}/{deadline} 的知识散落在 admin.ts 的两处
 * label 里硬编码，加一个占位符要改三个地方还容易漏 —— 现在只改这里。
 */

export type VarScope = "warning" | "trigger";

export interface PlaceholderDef {
  name: string;
  desc: string;
  /** 省略表示两类消息都可用。 */
  scope?: VarScope[];
}

export const PLACEHOLDERS: PlaceholderDef[] = [
  { name: "checkin_url", desc: "一键签到链接" },
  { name: "time", desc: "触发时刻", scope: ["trigger"] },
  { name: "deadline", desc: "确认截止时间", scope: ["warning"] },
  { name: "last_checkin", desc: "上次签到时间" },
  { name: "hours", desc: "距上次签到的小时数" },
  { name: "label", desc: "接收人名称" },
  { name: "site", desc: "站点地址" },
  { name: "expiry_hours", desc: "签到时限（小时）" },
  { name: "warning_hours", desc: "警告窗口（小时）" },
];

/** 供后台 UI 渲染提示。返回的是纯数据，前端再决定怎么展示。 */
export function placeholdersFor(scope: VarScope): { name: string; desc: string }[] {
  return PLACEHOLDERS.filter((p) => !p.scope || p.scope.includes(scope)).map((p) => ({
    name: p.name,
    desc: p.desc,
  }));
}

export interface MessageContext {
  purpose: VarScope;
  /** 所有者时区，用于格式化所有时间。 */
  tz: string;
  site: string;
  checkinUrl: string;
  /** 触发群发的时刻；警告消息里没有这个概念，留空即可。 */
  time?: string;
  /** 警告窗口的截止时刻；触发消息里留空。 */
  deadline?: string;
  lastCheckin?: string;
  hours?: string;
  label?: string;
  expiryHours?: number;
  warningHours?: number;
}

/**
 * 生成替换用的完整变量表。所有消息类型共用这一份构造，避免出现
 * 「警告消息支持 {checkin_url}、触发消息却忘了」这类漏配。
 *
 * {checkin_url} 拿不到时回退成站点地址：消息里至少要有一个能点进去
 * 手动签到的链接，留空会让人以为系统坏了。
 */
export function buildVars(ctx: MessageContext): Record<string, string> {
  return {
    checkin_url: ctx.checkinUrl || ctx.site,
    time: ctx.time ?? "",
    deadline: ctx.deadline ?? "",
    last_checkin: ctx.lastCheckin ?? "",
    hours: ctx.hours ?? "",
    label: ctx.label ?? "",
    site: ctx.site,
    expiry_hours: ctx.expiryHours != null ? String(ctx.expiryHours) : "",
    warning_hours: ctx.warningHours != null ? String(ctx.warningHours) : "",
  };
}

// Assemble one recipient's outbound message from their stored content, falling
// back to the built-in defaults when the row predates per-recipient content.
export function buildMessage(
  content: string,
  defaults: { title: string; body: string },
  vars: Record<string, string>
): Message {
  const m = splitMessage(content?.trim() || defaults.body);
  return {
    title: fillTemplate(m.title || defaults.title, vars),
    body: fillTemplate(m.body, vars),
  };
}
