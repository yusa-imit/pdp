import { describe, test, expect } from "bun:test";
import { buildClaudeArgs } from "../src/services/runner";
import type { CronJob } from "../src/types";
import { Cron } from "croner";

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 1,
    name: "test-job",
    expression: "* * * * *",
    prompt: "do something",
    cwd: "/tmp",
    model: "sonnet",
    permissionMode: "bypassPermissions",
    maxBudget: null,
    timeoutMs: 600000,
    allowedTools: [],
    appendSystemPrompt: "",
    instance: new Cron("* * * * *", { paused: true }, () => {}),
    createdAt: new Date().toISOString(),
    isRunning: false,
    ...overrides,
  };
}

describe("buildClaudeArgs", () => {
  test("builds basic args", () => {
    const args = buildClaudeArgs(makeJob());
    expect(args).toEqual([
      "claude", "-p",
      "--output-format", "text",
      "--model", "sonnet",
      "--permission-mode", "bypassPermissions",
      "--verbose",
      "do something",
    ]);
  });

  test("includes --max-budget-usd when set", () => {
    const args = buildClaudeArgs(makeJob({ maxBudget: 5 }));
    expect(args).toContain("--max-budget-usd");
    expect(args).toContain("5");
  });

  test("excludes --max-budget-usd when null", () => {
    const args = buildClaudeArgs(makeJob({ maxBudget: null }));
    expect(args).not.toContain("--max-budget-usd");
  });

  test("includes --allowedTools when set", () => {
    const args = buildClaudeArgs(makeJob({ allowedTools: ["Read", "Write"] }));
    expect(args).toContain("--allowedTools");
    expect(args).toContain("Read");
    expect(args).toContain("Write");
  });

  test("includes --append-system-prompt when set", () => {
    const args = buildClaudeArgs(makeJob({ appendSystemPrompt: "extra instructions" }));
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("extra instructions");
  });

  test("prompt is always the last arg", () => {
    const args = buildClaudeArgs(makeJob({ prompt: "my prompt" }));
    expect(args[args.length - 1]).toBe("my prompt");
  });
});
