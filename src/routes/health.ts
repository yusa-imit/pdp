import { json } from "../lib/response";
import { getAllJobs } from "../services/scheduler";
import { getDailyUsage } from "../services/usage";
import type { AppContext } from "../types";

export async function handleHealth(ctx: AppContext): Promise<Response> {
  const all = getAllJobs(ctx);
  const dailyUsage = await getDailyUsage(ctx);
  return json({
    status: "ok",
    jobs: all.length,
    running: all.filter((j) => j.isRunning).length,
    dailyUsage,
  });
}
