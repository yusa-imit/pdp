import type { AppContext, CronJob } from "../types";

export async function getDailyUsage(ctx: AppContext): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const row = await ctx.db.get<{ total: number }>(
    "SELECT COALESCE(SUM(cost_usd), 0)::DOUBLE as total FROM runs WHERE started_at >= ? AND cost_usd IS NOT NULL",
    today.toISOString()
  );
  return row?.total ?? 0;
}

export async function shouldSkipForUsage(ctx: AppContext, job: CronJob): Promise<{ skip: boolean; reason?: string }> {
  if (job.dailyBudgetUsd === null || job.dailyBudgetUsd === undefined) {
    return { skip: false };
  }

  const dailyUsage = await getDailyUsage(ctx);
  const threshold = job.sessionLimitThreshold / 100;
  const limit = job.dailyBudgetUsd * threshold;

  if (dailyUsage >= limit) {
    return {
      skip: true,
      reason: `Daily usage $${dailyUsage.toFixed(2)} >= threshold $${limit.toFixed(2)} (${job.sessionLimitThreshold}% of $${job.dailyBudgetUsd})`,
    };
  }

  return { skip: false };
}
