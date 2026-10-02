import { writeWithRetry, type OwnerRow } from "./db";
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

/**
 * 三态判定本身是纯函数：`resolveView` 与 `POST /c/:token/do` 共用它，后者已经手里有令牌与
 * 签到后的 owner，不必为了渲染同一页再查一次库。
 */
export function viewOf(token: TokenRow | null, owner: OwnerRow, now: number): CheckinView {
  if (token && token.used_at != null && token.used_at >= owner.last_judge_at) {
    return { kind: "checked", owner };
  }
  if (token && isLive(token, now)) return { kind: "confirm", token, owner };
  return { kind: "invalid", owner };
}

export async function resolveView(db: D1Database, rawToken: string, now = Date.now()): Promise<CheckinView> {
  // 两次读互不依赖，合成一个 batch：打开签到链接是全站延迟最敏感的一次交互
  const [ownerRes, tokenRes] = await db.batch<OwnerRow | TokenRow>([
    db.prepare("SELECT * FROM owner WHERE id = 1"),
    db.prepare("SELECT * FROM checkin_tokens WHERE token = ?").bind(rawToken),
  ]);
  const owner = (ownerRes?.results?.[0] as OwnerRow | undefined) ?? null;
  if (!owner) return { kind: "invalid", owner: missingOwner(now) };
  const token = (tokenRes?.results?.[0] as TokenRow | undefined) ?? null;
  return viewOf(token, owner, now);
}

/** 令牌 256 位随机；确认页只渲染，签到只在 POST 时发生（防邮件网关自动抓取）。 */
export type CheckinResult =
  | { ok: true; kind: "checked"; streak: number; wasLocked: boolean; owner: OwnerRow; token: TokenRow }
  | { ok: true; kind: "test"; owner: OwnerRow; token: TokenRow }
  | { ok: false; reason: "used" | "invalid" };

/**
 * 全站唯一的签到入口，只由 `POST /c/:token/do` 调用——不存在后台签到接口（docs/backend.md §3）。
 *
 * 一个 batch 里四条语句：锁死前的状态快照、条件消费令牌、条件更新 owner、签到后的新状态。
 * batch 中途无法在 JS 里读值分支，而 SQLite 的 UPDATE 右侧表达式一律取旧值，所以
 * streak / last_judge_at 的推进写成纯 SQL；`wasLocked` 则由排在 UPDATE **之前**的那条快照给出。
 * 首尾两条 SELECT 顶掉了原先前后各一次的 `getOwner` 往返。
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

  // 快照只认第一次尝试：writeWithRetry 重试意味着第一次其实已经写成功了（state 已是 normal），
  // 若按最后一次的快照判定，从锁死态恢复的那次签到就会丢掉「最终消息已发出且不可撤回」这段文案。
  let lockedSnapshot: OwnerRow["state"] | undefined;
  const results = await writeWithRetry("签到", async () => {
    const r = await db.batch([
      db.prepare("SELECT state FROM owner WHERE id = 1"),
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
      db.prepare("SELECT * FROM owner WHERE id = 1"),
    ]);
    lockedSnapshot ??= (r[0]?.results?.[0] as { state: OwnerRow["state"] } | undefined)?.state;
    return r;
  });

  const wasLocked = lockedSnapshot === "locked";
  const owner = (results[3]?.results?.[0] as OwnerRow | undefined) ?? missingOwner(now);
  // 令牌行是消费前读的那份，`used_at` 补成这次的时刻，调用方才能直接用它渲染「已确认」
  const consumed: TokenRow = { ...token, used_at: now };
  if (token.purpose === "test") return { ok: true, kind: "test", owner, token: consumed };
  return { ok: true, kind: "checked", streak: owner.streak, wasLocked, owner, token: consumed };
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
