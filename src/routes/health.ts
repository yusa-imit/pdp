import { json } from "../lib/response";
import { getAllJobs } from "../services/scheduler";
import type { AppContext } from "../types";

export async function handleHealth(ctx: AppContext): Promise<Response> {
  const all = getAllJobs(ctx);
  return json({
    status: "ok",
    jobs: all.length,
    running: all.filter((j) => j.isRunning).length,
    maxParallelJobs: ctx.maxParallelJobs,
  });
}
