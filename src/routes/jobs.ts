import { Cron } from "croner";
import { json } from "../lib/response";
import { runJob } from "../services/runner";
import {
  getAllJobs,
  getJob,
  jobToJSON,
  createJobInDB,
  deleteJobFromDB,
  removeJob,
  pauseJob,
  resumeJob,
} from "../services/scheduler";
import type { CreateJobBody } from "../types";

export async function handleListJobs(): Promise<Response> {
  const list = await Promise.all(getAllJobs().map(jobToJSON));
  return json({ jobs: list });
}

export async function handleGetJob(id: number): Promise<Response> {
  const job = getJob(id);
  if (!job) return json({ error: "Job not found" }, 404);
  return json(await jobToJSON(job));
}

export async function handleCreateJob(req: Request): Promise<Response> {
  const body = (await req.json()) as CreateJobBody;

  if (!body.name || !body.expression || !body.prompt || !body.cwd) {
    return json({ error: "name, expression, prompt, cwd are required" }, 400);
  }

  try {
    new Cron(body.expression, { paused: true }, () => {});
  } catch {
    return json({ error: "Invalid cron expression" }, 400);
  }

  const job = await createJobInDB(body, {
    model: body.model || "sonnet",
    permissionMode: body.permissionMode || "bypassPermissions",
    maxBudget: body.maxBudget ?? null,
    timeoutMs: body.timeoutMs || 10 * 60 * 1000,
    allowedTools: body.allowedTools || [],
    appendSystemPrompt: body.appendSystemPrompt || "",
  });

  console.log(`Job created: "${job.name}" (id=${job.id}) [${job.expression}]`);
  return json(await jobToJSON(job), 201);
}

export async function handleDeleteJob(id: number): Promise<Response> {
  const job = removeJob(id);
  if (!job) return json({ error: "Job not found" }, 404);

  await deleteJobFromDB(id);
  console.log(`Job deleted: "${job.name}" (id=${id})`);
  return json({ message: "Job deleted" });
}

export function handlePauseJob(id: number): Response {
  const job = getJob(id);
  if (!job) return json({ error: "Job not found" }, 404);

  pauseJob(job);
  console.log(`Job paused: "${job.name}" (id=${id})`);
  return json({ message: "Job paused", id });
}

export function handleResumeJob(id: number): Response {
  const job = getJob(id);
  if (!job) return json({ error: "Job not found" }, 404);

  resumeJob(job);
  console.log(`Job resumed: "${job.name}" (id=${id})`);
  return json({ message: "Job resumed", id });
}

export function handleTriggerJob(id: number): Response {
  const job = getJob(id);
  if (!job) return json({ error: "Job not found" }, 404);

  if (job.isRunning) {
    return json({ error: "Job is already running" }, 409);
  }

  runJob(job);
  return json({ message: "Job triggered", jobId: id });
}
