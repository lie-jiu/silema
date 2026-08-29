import type { Bindings } from "./types";
import { handleCron } from "./cron";

const HEARTBEAT_TIMEOUT_MS = 5000;

// 连续失败时每隔多少次再提醒一次（12 次 × 5 分钟 ≈ 每小时一次），
// 否则 cron 每 5 分钟失败会带来一天 288 次告警风暴。
const FAIL_REMINDER_EVERY = 12;

const K_LAST_AT = "cron_last_at";
const K_LAST_STATUS = "cron_last_status";
const K_LAST_ERROR = "cron_last_error";
const K_FAIL_STREAK = "cron_fail_streak";

export interface CronHealth {
  lastAt: number | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  failStreak: number;
}

export async function readCronHealth(env: Bindings): Promise<CronHealth> {
  try {
    const { results } = await env.DB.prepare(
      "SELECT key, value FROM system_state WHERE key IN (?, ?, ?, ?)"
    ).bind(K_LAST_AT, K_LAST_STATUS, K_LAST_ERROR, K_FAIL_STREAK).all<{ key: string; value: string }>();

    const m = new Map(results.map((r) => [r.key, r.value]));
    const lastAt = m.has(K_LAST_AT) ? Number(m.get(K_LAST_AT)) : NaN;
    const streak = Number(m.get(K_FAIL_STREAK) ?? 0);
    return {
      lastAt: Number.isFinite(lastAt) ? lastAt : null,
      lastStatus: (m.get(K_LAST_STATUS) as "ok" | "error") ?? null,
      lastError: m.get(K_LAST_ERROR) ?? null,
      failStreak: Number.isFinite(streak) ? streak : 0,
    };
  } catch (err) {
    // 健康读数失败不该让状态页挂掉。
    console.error("[health] read failed:", err);
    return { lastAt: null, lastStatus: null, lastError: null, failStreak: 0 };
  }
}

function upsertStmt(env: Bindings, key: string, value: string): D1PreparedStatement {
  const now = Math.floor(Date.now() / 1000);
  return env.DB.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?`
  ).bind(key, value, now, value, now);
}

// 递增连续失败计数并直接返回新值，省掉一次先读后写的往返。
async function bumpFailStreak(env: Bindings): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `INSERT INTO system_state (key, value, updated_at) VALUES (?, '1', ?)
     ON CONFLICT(key) DO UPDATE SET
       value = CAST(COALESCE(CAST(system_state.value AS INTEGER), 0) + 1 AS TEXT),
       updated_at = ?
     RETURNING value`
  ).bind(K_FAIL_STREAK, now, now).first<{ value: string }>();
  const n = Number(row?.value ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function ping(url: string): Promise<void> {
  await fetch(url, { method: "GET", signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS) });
}

// 只在状态翻转时 ping，其余时候保持安静。
//   成功且此前正常 → 不 ping：Healthchecks.io 这类服务靠「超时未收到」判断故障，
//                     每 5 分钟一次的成功 ping 纯属噪音。
//   成功且刚从故障恢复 → ping，告知已恢复。
//   失败首次 / 之后每 12 次 → ping 失败端点。
async function pingHeartbeat(env: Bindings, ok: boolean, prevStreak: number, streak: number): Promise<void> {
  if (!env.HEARTBEAT_URL && !env.HEARTBEAT_FAIL_URL) return;

  if (ok) {
    if (prevStreak > 0 && env.HEARTBEAT_URL) await ping(env.HEARTBEAT_URL);
    return;
  }
  if (streak !== 1 && streak % FAIL_REMINDER_EVERY !== 0) return;

  // 未单独配失败端点时回退到 HEARTBEAT_URL + "/fail"（Healthchecks.io 约定）。
  const url =
    env.HEARTBEAT_FAIL_URL ||
    (env.HEARTBEAT_URL ? env.HEARTBEAT_URL.replace(/\/+$/, "") + "/fail" : null);
  if (url) await ping(url);
}

/**
 * 推进状态机，并记录本次巡检的成败。
 *
 * 遥测是「关于监控系统本身的监控」，因此它绝不能反过来拖垮被监控的流程：
 * 所有写库与心跳都单独包在 try/catch 里，异常只记日志后吞掉。主流程的
 * 状态机逻辑不依赖任何遥测结果，失败也照常向外抛出，交给调用方处理
 * （scheduled 记日志，/__cron 返回 500）。
 */
export async function runCron(env: Bindings): Promise<void> {
  let ok = true;
  let message = "";
  try {
    await handleCron(env);
  } catch (err) {
    ok = false;
    message = String((err as Error)?.message || err);
    console.error("[cron] run failed:", err);
  }

  let prevStreak = 0;
  let streak = 0;
  try {
    const prev = await env.DB.prepare("SELECT value FROM system_state WHERE key = ?")
      .bind(K_FAIL_STREAK).first<{ value: string }>();
    prevStreak = Number(prev?.value ?? 0) || 0;

    const statements: D1PreparedStatement[] = [
      upsertStmt(env, K_LAST_AT, String(Math.floor(Date.now() / 1000))),
      upsertStmt(env, K_LAST_STATUS, ok ? "ok" : "error"),
    ];
    if (ok) {
      statements.push(upsertStmt(env, K_FAIL_STREAK, "0"));
      streak = 0;
    } else {
      statements.push(upsertStmt(env, K_LAST_ERROR, message.slice(0, 500)));
      streak = await bumpFailStreak(env);
    }
    await env.DB.batch(statements);
  } catch (err) {
    console.error("[cron] telemetry write failed:", err);
  }

  try {
    await pingHeartbeat(env, ok, prevStreak, streak);
  } catch (err) {
    console.error("[cron] heartbeat failed:", err);
  }

  if (!ok) throw new Error(message);
}
