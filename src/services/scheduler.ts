import { Cron } from "croner";
import { runJob } from "./runner";
import type { AppContext, CronJob, JobRow, RunRow } from "../types";

// --- Accessors ---

export function getJob(ctx: AppContext, id: number): CronJob | undefined {
  return ctx.jobs.get(id);
}

export function getAllJobs(ctx: AppContext): CronJob[] {
  return [...ctx.jobs.values()];
}

// --- Job lifecycle ---

export function scheduleJob(ctx: AppContext, job: CronJob): void {
  job.instance = new Cron(job.expression, () => runJob(ctx, job));
  ctx.jobs.set(job.id, job);
}

export function removeJob(ctx: AppContext, id: number): CronJob | undefined {
  const job = ctx.jobs.get(id);
  if (job) {
    job.instance.stop();
    ctx.jobs.delete(id);
  }
  return job;
}

export async function pauseJob(ctx: AppContext, job: CronJob): Promise<void> {
  job.instance.pause();
  job.isPaused = true;
  await ctx.db.run("UPDATE jobs SET is_paused = true WHERE id = ?", job.id);
}

export async function resumeJob(ctx: AppContext, job: CronJob): Promise<void> {
  job.instance.resume();
  job.isPaused = false;
  await ctx.db.run("UPDATE jobs SET is_paused = false WHERE id = ?", job.id);
}

// --- Serialization ---

export async function jobToJSON(ctx: AppContext, job: CronJob) {
  const lastRun = await ctx.db.get<RunRow>(
    "SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1",
    job.id
  );
  const runCount = await ctx.db.get<{ cnt: number }>(
    "SELECT count(*)::INTEGER as cnt FROM runs WHERE job_id = ?",
    job.id
  );
  return {
    id: job.id,
    name: job.name,
    expression: job.expression,
    prompt: job.prompt,
    cwd: job.cwd,
    model: job.model,
    permissionMode: job.permissionMode,
    maxBudget: job.maxBudget,
    timeoutMs: job.timeoutMs,
    allowedTools: job.allowedTools,
    appendSystemPrompt: job.appendSystemPrompt || null,
    sessionLimitThreshold: job.sessionLimitThreshold,
    dailyBudgetUsd: job.dailyBudgetUsd,
    blockTokenLimit: job.blockTokenLimit,
    scheduled: !job.instance.isStopped() && !job.isPaused,
    isRunning: job.isRunning,
    nextRun: job.instance.nextRun()?.toISOString() ?? null,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          startedAt: lastRun.started_at,
          finishedAt: lastRun.finished_at,
          exitCode: lastRun.exit_code,
          durationMs: lastRun.duration_ms,
          logFile: lastRun.log_file,
          error: lastRun.error,
          status: lastRun.status,
          costUsd: lastRun.cost_usd,
          inputTokens: lastRun.input_tokens,
          outputTokens: lastRun.output_tokens,
        }
      : null,
    runCount: runCount?.cnt ?? 0,
    createdAt: job.createdAt,
  };
}

// --- DB persistence ---

export async function createJobInDB(
  ctx: AppContext,
  body: { name: string; expression: string; prompt: string; cwd: string },
  opts: { model: string; permissionMode: string; maxBudget: number | null; timeoutMs: number; allowedTools: string[]; appendSystemPrompt: string; sessionLimitThreshold: number; dailyBudgetUsd: number | null; blockTokenLimit: number | null }
): Promise<CronJob> {
  await ctx.db.run(
    `INSERT INTO jobs (name, expression, prompt, cwd, model, permission_mode, max_budget, timeout_ms, allowed_tools, append_system_prompt, session_limit_threshold, daily_budget_usd, block_token_limit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    body.name, body.expression, body.prompt, body.cwd,
    opts.model, opts.permissionMode, opts.maxBudget, opts.timeoutMs,
    JSON.stringify(opts.allowedTools), opts.appendSystemPrompt,
    opts.sessionLimitThreshold, opts.dailyBudgetUsd, opts.blockTokenLimit
  );

  const row = await ctx.db.get<{ id: number; created_at: string }>(
    "SELECT id, created_at::VARCHAR as created_at FROM jobs ORDER BY id DESC LIMIT 1"
  );

  const job: CronJob = {
    id: row!.id,
    name: body.name,
    expression: body.expression,
    prompt: body.prompt,
    cwd: body.cwd,
    ...opts,
    instance: null as unknown as Cron,
    createdAt: row!.created_at,
    isRunning: false,
    isPaused: false,
  };

  scheduleJob(ctx, job);
  return job;
}

export async function updateJobInDB(
  ctx: AppContext,
  job: CronJob,
  updates: Partial<{ name: string; expression: string; prompt: string; cwd: string; model: string; permissionMode: string; maxBudget: number | null; timeoutMs: number; allowedTools: string[]; appendSystemPrompt: string; sessionLimitThreshold: number; dailyBudgetUsd: number | null; blockTokenLimit: number | null }>
): Promise<CronJob> {
  const needsReschedule = updates.expression && updates.expression !== job.expression;

  if (updates.name !== undefined) job.name = updates.name;
  if (updates.expression !== undefined) job.expression = updates.expression;
  if (updates.prompt !== undefined) job.prompt = updates.prompt;
  if (updates.cwd !== undefined) job.cwd = updates.cwd;
  if (updates.model !== undefined) job.model = updates.model;
  if (updates.permissionMode !== undefined) job.permissionMode = updates.permissionMode;
  if (updates.maxBudget !== undefined) job.maxBudget = updates.maxBudget;
  if (updates.timeoutMs !== undefined) job.timeoutMs = updates.timeoutMs;
  if (updates.allowedTools !== undefined) job.allowedTools = updates.allowedTools;
  if (updates.appendSystemPrompt !== undefined) job.appendSystemPrompt = updates.appendSystemPrompt;
  if (updates.sessionLimitThreshold !== undefined) job.sessionLimitThreshold = updates.sessionLimitThreshold;
  if (updates.dailyBudgetUsd !== undefined) job.dailyBudgetUsd = updates.dailyBudgetUsd;
  if (updates.blockTokenLimit !== undefined) job.blockTokenLimit = updates.blockTokenLimit;

  await ctx.db.run(
    `UPDATE jobs SET name = ?, expression = ?, prompt = ?, cwd = ?, model = ?, permission_mode = ?, max_budget = ?, timeout_ms = ?, allowed_tools = ?, append_system_prompt = ?, session_limit_threshold = ?, daily_budget_usd = ?, block_token_limit = ? WHERE id = ?`,
    job.name, job.expression, job.prompt, job.cwd,
    job.model, job.permissionMode, job.maxBudget, job.timeoutMs,
    JSON.stringify(job.allowedTools), job.appendSystemPrompt,
    job.sessionLimitThreshold, job.dailyBudgetUsd, job.blockTokenLimit, job.id
  );

  if (needsReschedule) {
    job.instance.stop();
    job.instance = new Cron(job.expression, () => runJob(ctx, job));
  }

  return job;
}

export async function deleteJobFromDB(ctx: AppContext, id: number): Promise<void> {
  await ctx.db.run("DELETE FROM runs WHERE job_id = ?", id);
  await ctx.db.run("DELETE FROM jobs WHERE id = ?", id);
}

export async function loadJobs(ctx: AppContext): Promise<void> {
  const rows = await ctx.db.all<JobRow>(
    "SELECT *, created_at::VARCHAR as created_at FROM jobs ORDER BY id"
  );

  for (const row of rows) {
    const job: CronJob = {
      id: row.id,
      name: row.name,
      expression: row.expression,
      prompt: row.prompt,
      cwd: row.cwd,
      model: row.model,
      permissionMode: row.permission_mode,
      maxBudget: row.max_budget,
      timeoutMs: row.timeout_ms,
      allowedTools: JSON.parse(row.allowed_tools || "[]"),
      appendSystemPrompt: row.append_system_prompt,
      sessionLimitThreshold: row.session_limit_threshold,
      dailyBudgetUsd: row.daily_budget_usd,
      blockTokenLimit: row.block_token_limit,
      instance: null as unknown as Cron,
      createdAt: row.created_at,
      isRunning: false,
      isPaused: !!row.is_paused,
    };
    scheduleJob(ctx, job);
    if (job.isPaused) {
      job.instance.pause();
    }
    console.log(`  Loaded job: "${job.name}" (id=${job.id}) [${job.expression}]${job.isPaused ? " (paused)" : ""}`);
  }

  if (rows.length > 0) {
    console.log(`Loaded ${rows.length} job(s) from database`);
  }
}
