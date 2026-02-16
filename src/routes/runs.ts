import { all, get } from "../db";
import { json, text } from "../lib/response";
import { getJob } from "../services/scheduler";

export async function handleGetRuns(id: number, req: Request): Promise<Response> {
  const job = getJob(id);
  if (!job) return json({ error: "Job not found" }, 404);

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || 20;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const status = url.searchParams.get("status");

  let query = "SELECT * FROM runs WHERE job_id = ?";
  const params: unknown[] = [id];

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }

  query += " ORDER BY started_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const rows = await all(query, ...params);
  const total = await get<{ cnt: number }>(
    "SELECT count(*)::INTEGER as cnt FROM runs WHERE job_id = ?", id
  );

  return json({
    runs: rows.map((r: any) => ({
      id: r.id,
      jobId: r.job_id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      exitCode: r.exit_code,
      durationMs: r.duration_ms,
      logFile: r.log_file,
      error: r.error,
      status: r.status,
    })),
    total: total?.cnt ?? 0,
    limit,
    offset,
  });
}

export async function handleGetLog(id: number, req: Request): Promise<Response> {
  const job = getJob(id);
  if (!job) return json({ error: "Job not found" }, 404);

  const url = new URL(req.url);
  const runId = url.searchParams.get("run");

  let logPath: string | undefined;

  if (runId) {
    const row = await get<{ log_file: string }>(
      "SELECT log_file FROM runs WHERE id = ? AND job_id = ?", Number(runId), id
    );
    logPath = row?.log_file;
  } else {
    const row = await get<{ log_file: string }>(
      "SELECT log_file FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT 1", id
    );
    logPath = row?.log_file;
  }

  if (!logPath) return json({ error: "No runs yet" }, 404);

  try {
    const content = await Bun.file(logPath).text();
    return text(content);
  } catch {
    return json({ error: "Log file not found" }, 404);
  }
}
