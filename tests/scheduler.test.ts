import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  getJob,
  getAllJobs,
  scheduleJob,
  removeJob,
  pauseJob,
  resumeJob,
  createJobInDB,
  deleteJobFromDB,
  loadJobs,
  jobToJSON,
} from "../src/services/scheduler";
import type { AppContext, CronJob } from "../src/types";
import { Cron } from "croner";
import { createTestContext } from "./helpers";

let ctx: AppContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  // Stop all scheduled cron instances
  for (const job of ctx.jobs.values()) {
    job.instance.stop();
  }
  await ctx.db.close();
});

function makeCronJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 99,
    name: "test",
    expression: "0 * * * *",
    prompt: "test prompt",
    cwd: "/tmp",
    model: "sonnet",
    permissionMode: "bypassPermissions",
    maxBudget: null,
    timeoutMs: 60000,
    allowedTools: [],
    appendSystemPrompt: "",
    sessionLimitThreshold: 90,
    dailyBudgetUsd: null,
    blockTokenLimit: null,
    instance: null as unknown as Cron,
    createdAt: new Date().toISOString(),
    isRunning: false,
    ...overrides,
  };
}

const defaultOpts = {
  model: "sonnet",
  permissionMode: "bypassPermissions",
  maxBudget: null,
  timeoutMs: 60000,
  allowedTools: [] as string[],
  appendSystemPrompt: "",
  sessionLimitThreshold: 90,
  dailyBudgetUsd: null as number | null,
  blockTokenLimit: null as number | null,
};

describe("in-memory job management", () => {
  test("scheduleJob adds job to map and creates cron instance", () => {
    const job = makeCronJob({ id: 1 });
    scheduleJob(ctx, job);

    expect(ctx.jobs.size).toBe(1);
    expect(ctx.jobs.get(1)).toBe(job);
    expect(job.instance).toBeInstanceOf(Cron);
  });

  test("getJob returns job by id", () => {
    const job = makeCronJob({ id: 1 });
    scheduleJob(ctx, job);

    expect(getJob(ctx, 1)).toBe(job);
    expect(getJob(ctx, 999)).toBeUndefined();
  });

  test("getAllJobs returns all jobs", () => {
    scheduleJob(ctx, makeCronJob({ id: 1 }));
    scheduleJob(ctx, makeCronJob({ id: 2, name: "second" }));

    const all = getAllJobs(ctx);
    expect(all).toHaveLength(2);
  });

  test("removeJob stops cron and removes from map", () => {
    const job = makeCronJob({ id: 1 });
    scheduleJob(ctx, job);

    const removed = removeJob(ctx, 1);
    expect(removed).toBe(job);
    expect(ctx.jobs.size).toBe(0);
    expect(job.instance.isStopped()).toBe(true);
  });

  test("removeJob returns undefined for missing id", () => {
    expect(removeJob(ctx, 999)).toBeUndefined();
  });

  test("pauseJob pauses the cron instance", () => {
    const job = makeCronJob({ id: 1 });
    scheduleJob(ctx, job);

    pauseJob(job);
    expect(job.instance.isStopped()).toBe(false);
    // Paused jobs still exist but don't fire
  });

  test("resumeJob resumes a paused job", () => {
    const job = makeCronJob({ id: 1 });
    scheduleJob(ctx, job);

    pauseJob(job);
    resumeJob(job);
    expect(job.instance.isStopped()).toBe(false);
  });
});

describe("DB persistence", () => {
  test("createJobInDB persists and returns a CronJob", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "db-job", expression: "*/5 * * * *", prompt: "hello", cwd: "/tmp" },
      {
        ...defaultOpts,
        maxBudget: null,
        timeoutMs: 300000,
        allowedTools: ["Read"],
        appendSystemPrompt: "extra",
        sessionLimitThreshold: 80,
        dailyBudgetUsd: 50,
      }
    );

    expect(job.id).toBeGreaterThan(0);
    expect(job.name).toBe("db-job");
    expect(job.expression).toBe("*/5 * * * *");
    expect(job.allowedTools).toEqual(["Read"]);
    expect(job.sessionLimitThreshold).toBe(80);
    expect(job.dailyBudgetUsd).toBe(50);
    expect(ctx.jobs.has(job.id)).toBe(true);
  });

  test("deleteJobFromDB removes job and runs from DB", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "to-delete", expression: "0 * * * *", prompt: "x", cwd: "/tmp" },
      defaultOpts
    );

    // Insert a run for this job
    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, status) VALUES (?, ?, 'success')",
      job.id, new Date().toISOString()
    );

    await deleteJobFromDB(ctx, job.id);

    const jobRow = await ctx.db.get("SELECT * FROM jobs WHERE id = ?", job.id);
    const runRows = await ctx.db.all("SELECT * FROM runs WHERE job_id = ?", job.id);

    expect(jobRow).toBeUndefined();
    expect(runRows).toHaveLength(0);
  });

  test("loadJobs restores jobs from DB into memory", async () => {
    // Create a job in DB directly
    await ctx.db.run(
      `INSERT INTO jobs (name, expression, prompt, cwd, model, permission_mode, max_budget, timeout_ms, allowed_tools, append_system_prompt, session_limit_threshold, daily_budget_usd, block_token_limit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "loaded-job", "30 2 * * *", "do stuff", "/tmp",
      "sonnet", "bypassPermissions", null, 600000, '["Read","Write"]', "", 85, 100, 10000000
    );

    // Clear in-memory state
    ctx.jobs.clear();

    await loadJobs(ctx);

    expect(ctx.jobs.size).toBe(1);
    const job = [...ctx.jobs.values()][0];
    expect(job.name).toBe("loaded-job");
    expect(job.expression).toBe("30 2 * * *");
    expect(job.allowedTools).toEqual(["Read", "Write"]);
    expect(job.sessionLimitThreshold).toBe(85);
    expect(job.dailyBudgetUsd).toBe(100);
    expect(job.blockTokenLimit).toBe(10000000);
  });
});

describe("jobToJSON", () => {
  test("serializes job with no runs", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "json-test", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    const data = await jobToJSON(ctx, job);

    expect(data.id).toBe(job.id);
    expect(data.name).toBe("json-test");
    expect(data.scheduled).toBe(true);
    expect(data.isRunning).toBe(false);
    expect(data.lastRun).toBeNull();
    expect(data.runCount).toBe(0);
    expect(data.nextRun).toBeDefined();
    expect(data.sessionLimitThreshold).toBe(90);
    expect(data.dailyBudgetUsd).toBeNull();
    expect(data.dailyUsage).toBe(0);
  });

  test("serializes job with a run including cost data", async () => {
    const job = await createJobInDB(
      ctx,
      { name: "json-test-2", expression: "0 * * * *", prompt: "p", cwd: "/tmp" },
      defaultOpts
    );

    await ctx.db.run(
      "INSERT INTO runs (job_id, started_at, finished_at, exit_code, duration_ms, log_file, status, cost_usd, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      job.id, new Date().toISOString(), new Date().toISOString(), 0, 60000, "/tmp/test.log", "success", 0.25, 5000, 2000
    );

    const data = await jobToJSON(ctx, job);

    expect(data.runCount).toBe(1);
    expect(data.lastRun).not.toBeNull();
    expect(data.lastRun!.exitCode).toBe(0);
    expect(data.lastRun!.status).toBe("success");
    expect(data.lastRun!.costUsd).toBe(0.25);
    expect(data.lastRun!.inputTokens).toBe(5000);
    expect(data.lastRun!.outputTokens).toBe(2000);
    expect(data.dailyUsage).toBe(0.25);
  });
});
