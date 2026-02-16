import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getDailyUsage, shouldSkipForUsage } from "../src/services/usage";
import type { ActiveBlock } from "../src/services/usage";
import type { AppContext, CronJob } from "../src/types";
import { Cron } from "croner";
import { createTestContext } from "./helpers";

let ctx: AppContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.db.close();
});

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 1,
    name: "test-job",
    expression: "* * * * *",
    prompt: "do something",
    cwd: "/tmp",
    model: "sonnet",
    permissionMode: "bypassPermissions",
    maxBudget: null,
    timeoutMs: 600000,
    allowedTools: [],
    appendSystemPrompt: "",
    sessionLimitThreshold: 90,
    dailyBudgetUsd: null,
    blockTokenLimit: null,
    instance: new Cron("* * * * *", { paused: true }, () => {}),
    createdAt: new Date().toISOString(),
    isRunning: false,
    ...overrides,
  };
}

function mockActiveBlock(totalTokens: number): () => Promise<ActiveBlock | null> {
  return async () => ({
    id: "2026-02-16T16:00:00.000Z",
    startTime: "2026-02-16T16:00:00.000Z",
    endTime: "2026-02-16T21:00:00.000Z",
    isActive: true,
    totalTokens,
    costUSD: 4.5,
    projection: null,
  });
}

describe("getDailyUsage", () => {
  test("returns 0 when no runs exist", async () => {
    const usage = await getDailyUsage(ctx);
    expect(usage).toBe(0);
  });

  test("sums today's run costs", async () => {
    const now = new Date();
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      1, now.toISOString(), 0.5
    );
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      2, now.toISOString(), 0.3
    );

    const usage = await getDailyUsage(ctx);
    expect(usage).toBeCloseTo(0.8, 5);
  });

  test("excludes runs without cost_usd", async () => {
    const now = new Date();
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      1, now.toISOString(), 0.5
    );
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status) VALUES (?, ?, 'skipped')",
      1, now.toISOString()
    );

    const usage = await getDailyUsage(ctx);
    expect(usage).toBeCloseTo(0.5, 5);
  });

  test("excludes yesterday's runs", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);

    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      1, yesterday.toISOString(), 10.0
    );

    const usage = await getDailyUsage(ctx);
    expect(usage).toBe(0);
  });
});

describe("shouldSkipForUsage", () => {
  test("returns skip=false when both limits are null (fail-open)", async () => {
    const job = makeJob({ dailyBudgetUsd: null, blockTokenLimit: null });
    const result = await shouldSkipForUsage(ctx, job);
    expect(result.skip).toBe(false);
  });

  test("returns skip=false when usage is below daily budget threshold", async () => {
    const now = new Date();
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      1, now.toISOString(), 5.0
    );

    // Budget $100, threshold 90% → limit $90, usage $5 → no skip
    const job = makeJob({ dailyBudgetUsd: 100, sessionLimitThreshold: 90 });
    const result = await shouldSkipForUsage(ctx, job);
    expect(result.skip).toBe(false);
  });

  test("returns skip=true when daily usage reaches threshold", async () => {
    const now = new Date();
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      1, now.toISOString(), 45.0
    );

    // Budget $50, threshold 90% → limit $45, usage $45 → skip
    const job = makeJob({ dailyBudgetUsd: 50, sessionLimitThreshold: 90 });
    const result = await shouldSkipForUsage(ctx, job);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain("$45.00");
    expect(result.reason).toContain("90%");
  });

  test("returns skip=true when daily usage exceeds threshold", async () => {
    const now = new Date();
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      1, now.toISOString(), 50.0
    );

    // Budget $50, threshold 80% → limit $40, usage $50 → skip
    const job = makeJob({ dailyBudgetUsd: 50, sessionLimitThreshold: 80 });
    const result = await shouldSkipForUsage(ctx, job);
    expect(result.skip).toBe(true);
  });

  test("considers all jobs' runs for daily total", async () => {
    const now = new Date();
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      1, now.toISOString(), 20.0
    );
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      2, now.toISOString(), 25.0
    );

    // Total usage = $45, budget $50, threshold 90% → limit $45 → skip
    const job = makeJob({ id: 3, dailyBudgetUsd: 50, sessionLimitThreshold: 90 });
    const result = await shouldSkipForUsage(ctx, job);
    expect(result.skip).toBe(true);
  });
});

describe("shouldSkipForUsage with blockTokenLimit", () => {
  test("skips when block tokens exceed threshold", async () => {
    // blockTokenLimit=10M, threshold 90% → limit 9M, tokens 9.5M → skip
    const job = makeJob({ blockTokenLimit: 10_000_000, sessionLimitThreshold: 90 });
    const result = await shouldSkipForUsage(ctx, job, mockActiveBlock(9_500_000));
    expect(result.skip).toBe(true);
    expect(result.reason).toContain("Block tokens");
    expect(result.reason).toContain("90%");
  });

  test("does not skip when block tokens below threshold", async () => {
    // blockTokenLimit=10M, threshold 90% → limit 9M, tokens 5M → no skip
    const job = makeJob({ blockTokenLimit: 10_000_000, sessionLimitThreshold: 90 });
    const result = await shouldSkipForUsage(ctx, job, mockActiveBlock(5_000_000));
    expect(result.skip).toBe(false);
  });

  test("falls through to daily budget when ccusage returns no active block", async () => {
    const now = new Date();
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status, cost_usd) VALUES (?, ?, 'success', ?)",
      1, now.toISOString(), 45.0
    );

    // blockTokenLimit set but ccusage returns null → fall through to dailyBudget
    // Budget $50, threshold 90% → limit $45, usage $45 → skip
    const job = makeJob({ blockTokenLimit: 10_000_000, dailyBudgetUsd: 50, sessionLimitThreshold: 90 });
    const result = await shouldSkipForUsage(ctx, job, async () => null);
    expect(result.skip).toBe(true);
    expect(result.reason).toContain("Daily usage");
  });

  test("blockTokenLimit check takes priority over dailyBudgetUsd", async () => {
    // Both limits set, block tokens exceed → should skip with block reason, not daily
    const job = makeJob({ blockTokenLimit: 10_000_000, dailyBudgetUsd: 50, sessionLimitThreshold: 90 });
    const result = await shouldSkipForUsage(ctx, job, mockActiveBlock(9_500_000));
    expect(result.skip).toBe(true);
    expect(result.reason).toContain("Block tokens");
    expect(result.reason).not.toContain("Daily usage");
  });

  test("does not skip when block is not active", async () => {
    const mockInactiveBlock = async (): Promise<ActiveBlock | null> => ({
      id: "2026-02-16T16:00:00.000Z",
      startTime: "2026-02-16T16:00:00.000Z",
      endTime: "2026-02-16T21:00:00.000Z",
      isActive: false,
      totalTokens: 9_500_000,
      costUSD: 4.5,
      projection: null,
    });

    const job = makeJob({ blockTokenLimit: 10_000_000, sessionLimitThreshold: 90 });
    const result = await shouldSkipForUsage(ctx, job, mockInactiveBlock);
    expect(result.skip).toBe(false);
  });
});
