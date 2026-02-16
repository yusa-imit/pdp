import type { AppContext, CronJob } from "../types";

export interface ActiveBlock {
  id: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
  totalTokens: number;
  costUSD: number;
  projection: {
    totalTokens: number;
    totalCost: number;
    remainingMinutes: number;
  } | null;
}

export async function getActiveBlock(): Promise<ActiveBlock | null> {
  try {
    const proc = Bun.spawn(["bunx", "ccusage", "blocks", "--active", "--json"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15000,
    });

    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const parsed = JSON.parse(stdout);
    const blocks = parsed.blocks;
    if (!Array.isArray(blocks) || blocks.length === 0) return null;

    const block = blocks[0];
    return {
      id: block.id,
      startTime: block.startTime,
      endTime: block.endTime,
      isActive: block.isActive,
      totalTokens: block.totalTokens,
      costUSD: block.costUSD,
      projection: block.projection ?? null,
    };
  } catch (err) {
    console.error("[ccusage] Failed to get active block:", err);
    return null;
  }
}

export async function getDailyUsage(ctx: AppContext): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const row = await ctx.db.get<{ total: number }>(
    "SELECT COALESCE(SUM(cost_usd), 0)::DOUBLE as total FROM runs WHERE started_at >= ? AND cost_usd IS NOT NULL",
    today.toISOString()
  );
  return row?.total ?? 0;
}

export async function shouldSkipForUsage(
  ctx: AppContext,
  job: CronJob,
  _getActiveBlock: () => Promise<ActiveBlock | null> = getActiveBlock,
): Promise<{ skip: boolean; reason?: string }> {
  // 1st priority: ccusage block token limit check
  if (job.blockTokenLimit !== null && job.blockTokenLimit !== undefined) {
    const block = await _getActiveBlock();
    if (block && block.isActive) {
      const threshold = job.sessionLimitThreshold / 100;
      const limit = job.blockTokenLimit * threshold;
      if (block.totalTokens >= limit) {
        return {
          skip: true,
          reason: `Block tokens ${block.totalTokens.toLocaleString()} >= threshold ${Math.round(limit).toLocaleString()} (${job.sessionLimitThreshold}% of ${job.blockTokenLimit.toLocaleString()})`,
        };
      }
    }
    // If ccusage fails or no active block, fall through to daily budget check (fail-open)
  }

  // 2nd priority: daily cost-based budget check
  if (job.dailyBudgetUsd !== null && job.dailyBudgetUsd !== undefined) {
    const dailyUsage = await getDailyUsage(ctx);
    const threshold = job.sessionLimitThreshold / 100;
    const limit = job.dailyBudgetUsd * threshold;

    if (dailyUsage >= limit) {
      return {
        skip: true,
        reason: `Daily usage $${dailyUsage.toFixed(2)} >= threshold $${limit.toFixed(2)} (${job.sessionLimitThreshold}% of $${job.dailyBudgetUsd})`,
      };
    }
  }

  return { skip: false };
}
