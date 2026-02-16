import type { Cron } from "croner";
import type { Db } from "./db";

export interface CronJob {
  id: number;
  name: string;
  expression: string;
  prompt: string;
  cwd: string;
  model: string;
  permissionMode: string;
  maxBudget: number | null;
  timeoutMs: number;
  allowedTools: string[];
  appendSystemPrompt: string;
  sessionLimitThreshold: number;
  dailyBudgetUsd: number | null;
  blockTokenLimit: number | null;
  instance: Cron;
  createdAt: string;
  isRunning: boolean;
}

export interface CreateJobBody {
  name: string;
  expression: string;
  prompt: string;
  cwd: string;
  model?: string;
  permissionMode?: string;
  maxBudget?: number;
  timeoutMs?: number;
  allowedTools?: string[];
  appendSystemPrompt?: string;
  sessionLimitThreshold?: number;
  dailyBudgetUsd?: number | null;
  blockTokenLimit?: number | null;
}

export interface JobRow {
  id: number;
  name: string;
  expression: string;
  prompt: string;
  cwd: string;
  model: string;
  permission_mode: string;
  max_budget: number | null;
  timeout_ms: number;
  allowed_tools: string;
  append_system_prompt: string;
  session_limit_threshold: number;
  daily_budget_usd: number | null;
  block_token_limit: number | null;
  created_at: string;
}

export interface RunRow {
  id: number;
  job_id: number;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  duration_ms: number | null;
  log_file: string | null;
  error: string | null;
  status: string;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface AppContext {
  db: Db;
  jobs: Map<number, CronJob>;
  logsDir: string;
}

export interface ClaudeJsonResult {
  result: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  session_id: string;
  num_turns: number;
}
