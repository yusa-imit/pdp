import { handleHealth } from "./routes/health";
import {
  handleListJobs,
  handleGetJob,
  handleCreateJob,
  handleUpdateJob,
  handleDeleteJob,
  handlePauseJob,
  handleResumeJob,
  handleTriggerJob,
} from "./routes/jobs";
import { handleGetRuns, handleGetLog } from "./routes/runs";
import { handleDashboard, handleJobsFragment, handleRunsFragment, handleLogFragment } from "./routes/ui";
import { json } from "./lib/response";
import type { AppContext } from "./types";

const PORT = Number(process.env.PORT) || 3000;

export function startServer(ctx: AppContext) {
  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;
      const method = req.method;

      if (method === "GET" && pathname === "/") {
        return await handleDashboard(ctx);
      }

      if (method === "GET" && pathname === "/ui/jobs") {
        return await handleJobsFragment(ctx);
      }

      const uiRunsMatch = pathname.match(/^\/ui\/jobs\/(\d+)\/runs$/);
      if (method === "GET" && uiRunsMatch) {
        return await handleRunsFragment(ctx, Number(uiRunsMatch[1]));
      }

      const uiLogMatch = pathname.match(/^\/ui\/jobs\/(\d+)\/log$/);
      if (method === "GET" && uiLogMatch) {
        return await handleLogFragment(ctx, Number(uiLogMatch[1]), req);
      }

      if (method === "GET" && pathname === "/health") {
        return await handleHealth(ctx);
      }

      if (method === "GET" && pathname === "/jobs") {
        return handleListJobs(ctx);
      }

      if (method === "POST" && pathname === "/jobs") {
        return handleCreateJob(ctx, req);
      }

      const jobMatch = pathname.match(/^\/jobs\/(\d+)$/);
      if (method === "GET" && jobMatch) {
        return handleGetJob(ctx, Number(jobMatch[1]));
      }
      if (method === "PATCH" && jobMatch) {
        return handleUpdateJob(ctx, Number(jobMatch[1]), req);
      }
      if (method === "DELETE" && jobMatch) {
        return handleDeleteJob(ctx, Number(jobMatch[1]));
      }

      const pauseMatch = pathname.match(/^\/jobs\/(\d+)\/pause$/);
      if (method === "POST" && pauseMatch) {
        return handlePauseJob(ctx, Number(pauseMatch[1]));
      }

      const resumeMatch = pathname.match(/^\/jobs\/(\d+)\/resume$/);
      if (method === "POST" && resumeMatch) {
        return handleResumeJob(ctx, Number(resumeMatch[1]));
      }

      const triggerMatch = pathname.match(/^\/jobs\/(\d+)\/trigger$/);
      if (method === "POST" && triggerMatch) {
        return handleTriggerJob(ctx, Number(triggerMatch[1]));
      }

      const runsMatch = pathname.match(/^\/jobs\/(\d+)\/runs$/);
      if (method === "GET" && runsMatch) {
        return handleGetRuns(ctx, Number(runsMatch[1]), req);
      }

      const logMatch = pathname.match(/^\/jobs\/(\d+)\/logs$/);
      if (method === "GET" && logMatch) {
        return handleGetLog(ctx, Number(logMatch[1]), req);
      }

      return json({ error: "Not found" }, 404);
    },
  });

  return server;
}
