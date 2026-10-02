export type EventType = "prompt" | "reminder" | "final";

export type TemplateVars = {
  site: string;
  label: string;
  checkin_url: string | null;
  last_checkin?: string;
  missed_days?: number;
  reminder_index?: number;
  time?: string;
};

export const PLACEHOLDERS: Record<EventType, Array<{ key: string; desc: string }>> = {
  prompt: [
    { key: "{checkin_url}", desc: "签到链接（拿不到链接时这条消息不会发出）" },
    { key: "{site}", desc: "站点地址" },
    { key: "{label}", desc: "接收人名称" },
  ],
  reminder: [
    { key: "{checkin_url}", desc: "签到链接（拿不到链接时这条消息不会发出）" },
    { key: "{site}", desc: "站点地址" },
    { key: "{label}", desc: "接收人名称" },
    { key: "{last_checkin}", desc: "上次确认时间" },
    { key: "{missed_days}", desc: "连续未确认天数" },
    { key: "{reminder_index}", desc: "第几次提醒（1-2）" },
  ],
  final: [
    { key: "{checkin_url}", desc: "恢复链接（7 天有效）" },
    { key: "{site}", desc: "站点地址" },
    { key: "{label}", desc: "接收人名称" },
    { key: "{last_checkin}", desc: "上次确认时间" },
    { key: "{missed_days}", desc: "连续未确认天数" },
    { key: "{time}", desc: "锁死时刻" },
  ],
};

export const DEFAULTS: Record<EventType, string> = {
  prompt: `今日签到链接\n{site} 的每日确认链接已发出，今天 24:00 前点此确认：\n{checkin_url}`,
  // 缺席期间 12:00 的那一条换成这段文案——同一条链接、同一天只发这一条。
  reminder: `未确认提醒（第 {reminder_index}/2 次）\n已连续 {missed_days} 天没有确认，上次确认是 {last_checkin}。今天 24:00 前点此确认：\n{checkin_url}`,
  final: `【重要】长时间未确认\n{label}，系统已连续 {missed_days} 天未能确认我的状态，最后一次的确认时间是 {last_checkin}（锁定于 {time}）。\n如果这条消息出现了，请设法联系我确认我是否安全。\n我仍可凭此链接撤销锁定：\n{checkin_url}`,
};

export type Rendered = { title: string; body: string };

/**
 * 首行 = 标题。`{checkin_url}` 取不到时返回 null 而不是回退站点地址——
 * 回退等于让接收人收到一条看着正常、点了没反应的链接，静默制造缺席（README「通知通道」）。
 */
export function render(
  template: string | null | undefined,
  event: EventType,
  vars: TemplateVars,
): Rendered | null {
  const src = (template ?? "").trim() ? (template as string) : DEFAULTS[event];
  if (src.includes("{checkin_url}") && !vars.checkin_url) return null;

  const text = src
    .replace(/\{checkin_url\}/g, vars.checkin_url ?? "")
    .replace(/\{site\}/g, vars.site)
    .replace(/\{label\}/g, vars.label)
    .replace(/\{last_checkin\}/g, vars.last_checkin ?? "从未")
    .replace(/\{missed_days\}/g, String(vars.missed_days ?? 0))
    .replace(/\{reminder_index\}/g, String(vars.reminder_index ?? 0))
    .replace(/\{time\}/g, vars.time ?? "");

  const [title, ...rest] = text.split(/\r?\n/);
  return { title: (title ?? "死了吗").trim() || "死了吗", body: rest.join("\n").trim() || text };
}
