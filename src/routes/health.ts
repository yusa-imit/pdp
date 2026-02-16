import { json } from "../lib/response";
import { getAllJobs } from "../services/scheduler";

export function handleHealth(): Response {
  const all = getAllJobs();
  return json({
    status: "ok",
    jobs: all.length,
    running: all.filter((j) => j.isRunning).length,
  });
}
