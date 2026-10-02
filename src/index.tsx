import { app } from "./app";
import { parseCron, ping, runDaily } from "./lib/cron";
import { setCronHealth } from "./lib/db";
import type { Env } from "./lib/send";

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),

  /** 唯一那条 cron 跑完整的每日任务（判定 → 发送）；对不上的表达式记错误并跳过（§2）。 */
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    if (!parseCron(controller.cron)) {
      console.error(`[cron] 未识别的 cron 表达式：${controller.cron}`);
      return;
    }
    try {
      const { judge, send } = await runDaily(env);
      for (const r of [judge, send]) {
        console.log(`[${r.job}]`, r.ran ? "ran" : `skipped: ${r.skipped ?? ""}`, r.detail, r.error ?? "");
      }
    } catch (err) {
      // runDaily 已按阶段兜住异常，走到这里说明连合并健康写入都炸了。不兜住的话，
      // 一次 D1 抖动会同时让缺席计数、后台健康与外部告警失明（任务静默失败、无人知道）。
      const msg = `[daily] 未捕获异常：${String(err instanceof Error ? err.message : err).slice(0, 300)}`;
      console.error(msg, err);
      try {
        await setCronHealth(env.DB, Date.now(), "error", msg);
      } catch {
        /* 连健康槽位都写不进去时，失败心跳照发 */
      }
      await ping(env, "judge", false);
      await ping(env, "send", false);
    }
  },
};
