import { CHANNELS } from "./channels";
import { configOf, type RecipientRow } from "./recipients";
import { deliver, describeTarget, type Env } from "./send";
import { fmtClock } from "./time";

const BUDGET_MS = 6_000;

export type NoticeOutcome = "none" | "ok" | "partial" | "fail";

/** 通道 + 脱敏后的投递目标，用于变更文案里让人一眼看出「接收对象被换掉了」。 */
export function targetBrief(row: Pick<RecipientRow, "channel_type" | "config_json">): string {
  const name = CHANNELS[row.channel_type]?.name ?? row.channel_type;
  try {
    return `${name} · ${describeTarget(row.channel_type, configOf(row))}`;
  } catch {
    return name;
  }
}

/** 掩码哨兵会把未改动的字段还原成原值，所以两边的键值完全一致就是「没换接收方式」。 */
export function configsDiffer(prevJson: string, nextJson: string): boolean {
  const norm = (json: string) => {
    const obj = configOf({ config_json: json });
    return JSON.stringify(Object.keys(obj).sort().map((k) => [k, obj[k]]));
  };
  return norm(prevJson) !== norm(nextJson);
}

/**
 * 紧急联系人名单变更告知（README「通知通道」）。
 *
 * 只发给**变更前**的 on_final 名单、且用各自的**旧配置**投递：被移除那位本人正是最需要知道的人，
 * 而被改过通道那位也只有旧配置才指向真实的人——账号被盗的第一步就是悄悄换掉联系人，
 * 换完之后再通知新目标等于没有通知。
 */
export async function notifyContactChange(
  env: Env,
  targets: RecipientRow[],
  change: string,
  timezone: string,
  now: number,
): Promise<NoticeOutcome> {
  if (targets.length === 0) return "none";

  const title = "死了吗 · 紧急联系人名单已变更";
  const stamp = fmtClock(timezone, now);
  const work = targets.map((row) =>
    deliver(
      env,
      row.channel_type,
      configOf(row),
      title,
      [
        `${row.label}，你在「${env.SITE_URL}」登记的紧急联系人名单发生了变化：`,
        "",
        change,
        "",
        `变更时间：${stamp}`,
        "",
        "这条告知只在名单或接收方式变动时发出，用来发现「账号被盗后第一步就是换掉联系人」这种情况。",
        "如果不是所有者本人的操作，请换一条途径立即联系 TA。",
      ].join("\n"),
    ),
  );

  const settled = await Promise.race([
    Promise.allSettled(work),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), BUDGET_MS)),
  ]);

  if (!settled) {
    console.error(`[contact-change] 超出 ${BUDGET_MS / 1000}s 预算，${targets.length} 条告知按失败计`);
    return "fail";
  }
  const ok = settled.filter((r) => r.status === "fulfilled" && r.value.ok).length;
  for (const r of settled) {
    if (r.status === "rejected") console.error("[contact-change] 告知抛出异常", r.reason);
    else if (!r.value.ok) console.error(`[contact-change] 告知失败：${r.value.detail}`);
  }
  if (ok === targets.length) return "ok";
  return ok > 0 ? "partial" : "fail";
}
