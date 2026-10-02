import { app } from "./app";
import { parseCron, ping, runJudge, runSend } from "./lib/cron";
import { setCronHealth } from "./lib/db";
import type { Env } from "./lib/send";

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),

  /** 两条 cron 精确映射到 send / judge；对不上的表达式记错误并跳过，不执行任何任务（§2）。 */
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    const job = parseCron(controller.cron);
    if (!job) {
      console.error(`[cron] 未识别的 cron 表达式：${controller.cron}`);
      return;
    }
    try {
      const res = job === "send" ? await runSend(env) : await runJudge(env);
      console.log(`[${job}]`, res.ran ? "ran" : `skipped: ${res.skipped ?? ""}`, res.detail, res.error ?? "");
    } catch (err) {
      // 不兜住的话，一次 D1 抖动会同时让缺席计数、后台健康与外部告警失明（任务静默失败、无人知道）。
      const msg = `[${job}] 未捕获异常：${String(err instanceof Error ? err.message : err).slice(0, 300)}`;
      console.error(msg, err);
      try {
        await setCronHealth(env.DB, Date.now(), "error", msg);
      } catch {
        /* 连健康槽位都写不进去时，失败心跳照发 */
      }
      await ping(env, job, false);
    }
  },
};
