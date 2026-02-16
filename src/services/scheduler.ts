import { Cron } from "croner";
import { all, get, run as dbRun } from "../db";
import { runJob } from "./runner";
import type { CronJob, JobRow, RunRow } from "../types";

const jobs = new Map<number, CronJob>();

// --- Accessors ---

export function getJob(id: number): CronJob | undefined {
  return jobs.get(id);
}

export function getAllJobs(): CronJob[] {
  return [...jobs.values()];
}

// --- Job lifecycle ---

export function scheduleJob(job: CronJob): void {
  job.instance = new Cron(job.expression, () => runJob(job));
  jobs.set(job.id, job);
}

export function removeJob(id: number): CronJob | undefined {
  const job = jobs.get(id);
  if (job) {
    job.instance.stop();
    jobs.delete(id);
  }
  return job;
}

export function pauseJob(job: CronJob): void {
  job.instance.pause();
}

export function resumeJob(job: CronJob): void {
  job.instance.resume();
}

// --- Serialization ---

export async function jobToJSON(job: CronJob) {
  const lastRun = await get<RunRow>(
    "SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1",
    job.id
  );
  const runCount = await get<{ cnt: number }>(
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
    scheduled: !job.instance.isStopped(),
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
        }
      : null,
    runCount: runCount?.cnt ?? 0,
    createdAt: job.createdAt,
  };
}

// --- DB persistence ---

export async function createJobInDB(
  body: { name: string; expression: string; prompt: string; cwd: string },
  opts: { model: string; permissionMode: string; maxBudget: number | null; timeoutMs: number; allowedTools: string[]; appendSystemPrompt: string }
): Promise<CronJob> {
  await dbRun(
    `INSERT INTO jobs (name, expression, prompt, cwd, model, permission_mode, max_budget, timeout_ms, allowed_tools, append_system_prompt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    body.name, body.expression, body.prompt, body.cwd,
    opts.model, opts.permissionMode, opts.maxBudget, opts.timeoutMs,
    JSON.stringify(opts.allowedTools), opts.appendSystemPrompt
  );

  const row = await get<{ id: number; created_at: string }>(
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
  };

  scheduleJob(job);
  return job;
}

export async function deleteJobFromDB(id: number): Promise<void> {
  await dbRun("DELETE FROM runs WHERE job_id = ?", id);
  await dbRun("DELETE FROM jobs WHERE id = ?", id);
}

export async function loadJobs(): Promise<void> {
  const rows = await all<JobRow>(
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
      instance: null as unknown as Cron,
      createdAt: row.created_at,
      isRunning: false,
    };
    scheduleJob(job);
    console.log(`  Loaded job: "${job.name}" (id=${job.id}) [${job.expression}]`);
  }

  if (rows.length > 0) {
    console.log(`Loaded ${rows.length} job(s) from database`);
  }
}
