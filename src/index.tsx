import { app } from "./app";
import { parseCron, runJudge, runSend } from "./lib/cron";
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
    const res = job === "send" ? await runSend(env) : await runJudge(env);
    console.log(`[${job}]`, res.ran ? "ran" : `skipped: ${res.skipped ?? ""}`, res.detail, res.error ?? "");
  },
};
