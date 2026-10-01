import type { OwnerRow } from "./db";
import { hoursSince } from "./time";

export type Level = "ok" | "warn" | "error" | "unknown";

export type Health = {
  send: { level: Level; hours: number | null; note: string | null };
  judge: { level: Level; hours: number | null; note: string | null };
  /** 任一为 error/unknown 即仪表盘 Tab 挂红点 */
  bad: boolean;
  summary: string;
};

const SEND_LIMIT_H = 13;
const JUDGE_LIMIT_H = 25;

/**
 * 后台健康判定不读 `last_cron_*`——那个槽位只有一份，judge 记的 error 会被 12 小时后一次
 * 正常的 send 覆盖。健康直接看时间戳（docs/backend.md §7）。
 *
 * 假阴性红线：取不到数据时返回 unknown 并由 UI 标红，绝不默认绿。
 */
export function healthOf(owner: OwnerRow | null, now: number): Health {
  if (!owner) {
    return {
      send: { level: "unknown", hours: null, note: "读不到 owner 行" },
      judge: { level: "unknown", hours: null, note: "读不到 owner 行" },
      bad: true,
      summary: "状态未知",
    };
  }

  const sendHours = hoursSince(owner.last_send_at, now);
  const judgeHours = hoursSince(owner.last_judge_at, now);

  let send: Health["send"];
  if (owner.state === "locked") {
    send = { level: "ok", hours: sendHours, note: "锁死期间不发送，属正常" };
  } else if (sendHours == null) {
    send = { level: "unknown", hours: null, note: "从未发出过链接" };
  } else if (sendHours > SEND_LIMIT_H) {
    send = { level: "error", hours: sendHours, note: `超过 ${SEND_LIMIT_H}h 未发送` };
  } else {
    send = { level: "ok", hours: sendHours, note: null };
  }

  const judge: Health["judge"] =
    judgeHours == null
      ? { level: "unknown", hours: null, note: "从未判定" }
      : judgeHours > JUDGE_LIMIT_H
        ? { level: "error", hours: judgeHours, note: `超过 ${JUDGE_LIMIT_H}h 未判定` }
        : { level: "ok", hours: judgeHours, note: null };

  const bad = [send, judge].some((x) => x.level === "error" || x.level === "unknown");
  return {
    send,
    judge,
    bad,
    summary: bad ? "巡检异常" : "巡检正常",
  };
}

export const LIMITS = { SEND_LIMIT_H, JUDGE_LIMIT_H };
