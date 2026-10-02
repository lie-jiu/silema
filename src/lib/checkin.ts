import { getOwner, writeWithRetry, type OwnerRow } from "./db";
import { findToken, isLive, type TokenRow } from "./tokens";

/**
 * 签到确认页三态（docs/backend.md §2.3）：
 * 「已使用」= 本周期已经记到一次确认，系统是安全的，不给补救入口；
 * 「已失效」= 当天无从签到，必须给后台入口。两者绝不能共用一句文案。
 */
export type CheckinView =
  | { kind: "confirm"; token: TokenRow; owner: OwnerRow }
  | { kind: "checked"; owner: OwnerRow }
  | { kind: "invalid"; owner: OwnerRow };

export async function resolveView(db: D1Database, rawToken: string, now = Date.now()): Promise<CheckinView> {
  const owner = await getOwner(db);
  if (!owner) return { kind: "invalid", owner: missingOwner(now) };
  const token = await findToken(db, rawToken);
  if (token && token.used_at != null && token.used_at >= owner.last_judge_at) {
    return { kind: "checked", owner };
  }
  if (token && isLive(token, now)) return { kind: "confirm", token, owner };
  return { kind: "invalid", owner };
}

/** 令牌 256 位随机；确认页只渲染，签到只在 POST 时发生（防邮件网关自动抓取）。 */
export type CheckinResult =
  | { ok: true; kind: "checked"; streak: number; wasLocked: boolean; owner: OwnerRow }
  | { ok: true; kind: "test"; owner: OwnerRow }
  | { ok: false; reason: "used" | "invalid" };

/**
 * 全站唯一的签到入口，只由 `POST /c/:token/do` 调用——不存在后台签到接口（docs/backend.md §3）。
 *
 * 一个 batch 里两条语句：先条件消费令牌，再用 `EXISTS(used_at = now)` 让 owner 更新以「这次真的消费
 * 成功了」为条件。batch 中途无法在 JS 里读值分支，而 SQLite 的 UPDATE 右侧表达式一律取旧值，
 * 所以 streak / last_judge_at 的推进写成纯 SQL。
 */
export async function performCheckin(
  db: D1Database,
  rawToken: string,
  now = Date.now(),
): Promise<CheckinResult> {
  const token = await findToken(db, rawToken);
  if (!token || token.used_at != null || token.expires_at <= now) {
    return { ok: false, reason: token && token.used_at != null ? "used" : "invalid" };
  }

  const before = await getOwner(db);
  const wasLocked = before?.state === "locked";

  await writeWithRetry("签到", () =>
    db.batch([
      db
        .prepare(
          "UPDATE checkin_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL AND expires_at > ?",
        )
        .bind(now, rawToken, now),
      db
        .prepare(
          `UPDATE owner SET
             state           = 'normal',
             missed_streak   = 0,
             locked_at       = NULL,
             last_judge_at   = CASE WHEN state = 'locked' THEN ? ELSE last_judge_at END,
             streak          = CASE WHEN last_checkin_at >= last_judge_at THEN streak ELSE streak + 1 END,
             last_checkin_at = ?
           WHERE id = 1
             AND EXISTS (
               SELECT 1 FROM checkin_tokens
               WHERE token = ? AND used_at = ? AND purpose <> 'test'
             )`,
        )
        .bind(now, now, rawToken, now),
    ]),
  );

  const owner = (await getOwner(db)) ?? missingOwner(now);
  if (token.purpose === "test") return { ok: true, kind: "test", owner };
  return { ok: true, kind: "checked", streak: owner.streak, wasLocked, owner };
}

/** owner 行缺失只可能出现在未跑 init-owner 的库上，用一个中性值兜住渲染，不让页面 500。 */
function missingOwner(now: number): OwnerRow {
  return {
    id: 1,
    totp_secret: "",
    totp_last_step: 0,
    backup_codes: null,
    session_epoch: 1,
    timezone: "Asia/Shanghai",
    state: "normal",
    streak: 0,
    missed_streak: 0,
    last_checkin_at: null,
    locked_at: null,
    final_sent_at: null,
    final_second_at: null,
    last_send_at: null,
    last_judge_at: now,
    last_cron_at: null,
    last_cron_status: null,
    last_cron_error: null,
  };
}
