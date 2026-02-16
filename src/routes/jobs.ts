import { Cron } from "croner";
import { json } from "../lib/response";
import { runJob } from "../services/runner";
import {
  getAllJobs,
  getJob,
  jobToJSON,
  createJobInDB,
  updateJobInDB,
  deleteJobFromDB,
  removeJob,
  pauseJob,
  resumeJob,
} from "../services/scheduler";
import type { AppContext, CreateJobBody } from "../types";

export async function handleListJobs(ctx: AppContext): Promise<Response> {
  const list = await Promise.all(getAllJobs(ctx).map((j) => jobToJSON(ctx, j)));
  return json({ jobs: list });
}

export async function handleGetJob(ctx: AppContext, id: number): Promise<Response> {
  const job = getJob(ctx, id);
  if (!job) return json({ error: "Job not found" }, 404);
  return json(await jobToJSON(ctx, job));
}

export async function handleCreateJob(ctx: AppContext, req: Request): Promise<Response> {
  const body = (await req.json()) as CreateJobBody;

  if (!body.name || !body.expression || !body.prompt || !body.cwd) {
    return json({ error: "name, expression, prompt, cwd are required" }, 400);
  }

  try {
    new Cron(body.expression, { paused: true }, () => {});
  } catch {
    return json({ error: "Invalid cron expression" }, 400);
  }

  if (body.sessionLimitThreshold !== undefined) {
    if (body.sessionLimitThreshold < 0 || body.sessionLimitThreshold > 100) {
      return json({ error: "sessionLimitThreshold must be between 0 and 100" }, 400);
    }
  }
  if (body.dailyBudgetUsd !== undefined && body.dailyBudgetUsd !== null && body.dailyBudgetUsd <= 0) {
    return json({ error: "dailyBudgetUsd must be positive" }, 400);
  }
  if (body.blockTokenLimit !== undefined && body.blockTokenLimit !== null) {
    if (!Number.isInteger(body.blockTokenLimit) || body.blockTokenLimit <= 0) {
      return json({ error: "blockTokenLimit must be a positive integer" }, 400);
    }
  }

  const job = await createJobInDB(ctx, body, {
    model: body.model || "sonnet",
    permissionMode: body.permissionMode || "bypassPermissions",
    maxBudget: body.maxBudget ?? null,
    timeoutMs: body.timeoutMs || 10 * 60 * 1000,
    allowedTools: body.allowedTools || [],
    appendSystemPrompt: body.appendSystemPrompt || "",
    sessionLimitThreshold: body.sessionLimitThreshold ?? 90,
    dailyBudgetUsd: body.dailyBudgetUsd ?? null,
    blockTokenLimit: body.blockTokenLimit ?? null,
  });

  console.log(`Job created: "${job.name}" (id=${job.id}) [${job.expression}]`);
  return json(await jobToJSON(ctx, job), 201);
}

export async function handleUpdateJob(ctx: AppContext, id: number, req: Request): Promise<Response> {
  const job = getJob(ctx, id);
  if (!job) return json({ error: "Job not found" }, 404);

  const body = await req.json();

  if (body.expression) {
    try {
      new Cron(body.expression, { paused: true }, () => {});
    } catch {
      return json({ error: "Invalid cron expression" }, 400);
    }
  }

  if (body.sessionLimitThreshold !== undefined) {
    if (body.sessionLimitThreshold < 0 || body.sessionLimitThreshold > 100) {
      return json({ error: "sessionLimitThreshold must be between 0 and 100" }, 400);
    }
  }
  if (body.dailyBudgetUsd !== undefined && body.dailyBudgetUsd !== null && body.dailyBudgetUsd <= 0) {
    return json({ error: "dailyBudgetUsd must be positive" }, 400);
  }
  if (body.blockTokenLimit !== undefined && body.blockTokenLimit !== null) {
    if (!Number.isInteger(body.blockTokenLimit) || body.blockTokenLimit <= 0) {
      return json({ error: "blockTokenLimit must be a positive integer" }, 400);
    }
  }

  const updated = await updateJobInDB(ctx, job, body);
  console.log(`Job updated: "${updated.name}" (id=${id})`);
  return json(await jobToJSON(ctx, updated));
}

export async function handleDeleteJob(ctx: AppContext, id: number): Promise<Response> {
  const job = removeJob(ctx, id);
  if (!job) return json({ error: "Job not found" }, 404);

  await deleteJobFromDB(ctx, id);
  console.log(`Job deleted: "${job.name}" (id=${id})`);
  return json({ message: "Job deleted" });
}

export function handlePauseJob(ctx: AppContext, id: number): Response {
  const job = getJob(ctx, id);
  if (!job) return json({ error: "Job not found" }, 404);

  pauseJob(job);
  console.log(`Job paused: "${job.name}" (id=${id})`);
  return json({ message: "Job paused", id });
}

export function handleResumeJob(ctx: AppContext, id: number): Response {
  const job = getJob(ctx, id);
  if (!job) return json({ error: "Job not found" }, 404);

  resumeJob(job);
  console.log(`Job resumed: "${job.name}" (id=${id})`);
  return json({ message: "Job resumed", id });
}

export function handleTriggerJob(ctx: AppContext, id: number): Response {
  const job = getJob(ctx, id);
  if (!job) return json({ error: "Job not found" }, 404);

  if (job.isRunning) {
    return json({ error: "Job is already running" }, 409);
  }

  runJob(ctx, job);
  return json({ message: "Job triggered", jobId: id });
}
