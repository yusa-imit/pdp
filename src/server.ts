import { handleHealth } from "./routes/health";
import {
  handleListJobs,
  handleGetJob,
  handleCreateJob,
  handleDeleteJob,
  handlePauseJob,
  handleResumeJob,
  handleTriggerJob,
} from "./routes/jobs";
import { handleGetRuns, handleGetLog } from "./routes/runs";
import { json } from "./lib/response";

const PORT = Number(process.env.PORT) || 3000;

export function startServer() {
  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;
      const method = req.method;

      if (method === "GET" && pathname === "/health") {
        return handleHealth();
      }

      if (method === "GET" && pathname === "/jobs") {
        return handleListJobs();
      }

      if (method === "POST" && pathname === "/jobs") {
        return handleCreateJob(req);
      }

      const jobMatch = pathname.match(/^\/jobs\/(\d+)$/);
      if (method === "GET" && jobMatch) {
        return handleGetJob(Number(jobMatch[1]));
      }
      if (method === "DELETE" && jobMatch) {
        return handleDeleteJob(Number(jobMatch[1]));
      }

      const pauseMatch = pathname.match(/^\/jobs\/(\d+)\/pause$/);
      if (method === "POST" && pauseMatch) {
        return handlePauseJob(Number(pauseMatch[1]));
      }

      const resumeMatch = pathname.match(/^\/jobs\/(\d+)\/resume$/);
      if (method === "POST" && resumeMatch) {
        return handleResumeJob(Number(resumeMatch[1]));
      }

      const triggerMatch = pathname.match(/^\/jobs\/(\d+)\/trigger$/);
      if (method === "POST" && triggerMatch) {
        return handleTriggerJob(Number(triggerMatch[1]));
      }

      const runsMatch = pathname.match(/^\/jobs\/(\d+)\/runs$/);
      if (method === "GET" && runsMatch) {
        return handleGetRuns(Number(runsMatch[1]), req);
      }

      const logMatch = pathname.match(/^\/jobs\/(\d+)\/logs$/);
      if (method === "GET" && logMatch) {
        return handleGetLog(Number(logMatch[1]), req);
      }

      return json({ error: "Not found" }, 404);
    },
  });

  return server;
}
