import { describe, test, expect, afterEach } from "bun:test";
import { notify } from "../src/services/notify";
import { mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("notify", () => {
  const origTarget = process.env.OPENCLAW_DISCORD_TARGET;
  const origPath = process.env.PATH;

  afterEach(() => {
    if (origTarget === undefined) delete process.env.OPENCLAW_DISCORD_TARGET;
    else process.env.OPENCLAW_DISCORD_TARGET = origTarget;
    process.env.PATH = origPath;
  });

  test("is a no-op when OPENCLAW_DISCORD_TARGET is unset", async () => {
    delete process.env.OPENCLAW_DISCORD_TARGET;

    const binDir = await mkdtemp(join(tmpdir(), "cron-notify-noop-"));
    const evidenceFile = join(binDir, "called.txt");
    const script = ["#!/bin/bash", `echo "$@" > "${evidenceFile}"`, ""].join("\n");
    const scriptPath = join(binDir, "openclaw");
    await Bun.write(scriptPath, script);
    await chmod(scriptPath, 0o755);
    process.env.PATH = `${binDir}:${origPath}`;

    await notify("[cron] test skipped run=1 some reason");

    expect(await Bun.file(evidenceFile).exists()).toBe(false);
  });

  test("invokes openclaw with the expected args when OPENCLAW_DISCORD_TARGET is set", async () => {
    process.env.OPENCLAW_DISCORD_TARGET = "user:123456";

    const binDir = await mkdtemp(join(tmpdir(), "cron-notify-fake-"));
    const evidenceFile = join(binDir, "called.txt");
    const script = ["#!/bin/bash", `printf '%s\\n' "$@" > "${evidenceFile}"`, ""].join("\n");
    const scriptPath = join(binDir, "openclaw");
    await Bun.write(scriptPath, script);
    await chmod(scriptPath, 0o755);
    process.env.PATH = `${binDir}:${origPath}`;

    await notify("[cron] test-job failed run=42 exit code 1");

    const output = await Bun.file(evidenceFile).text();
    const lines = output.trim().split("\n");
    expect(lines).toEqual([
      "message",
      "send",
      "--channel",
      "discord",
      "--target",
      "user:123456",
      "--message",
      "[cron] test-job failed run=42 exit code 1",
    ]);
  });

  test("does not throw when the openclaw binary is missing from PATH", async () => {
    process.env.OPENCLAW_DISCORD_TARGET = "user:123456";
    process.env.PATH = "/nonexistent-bin-dir";

    await expect(notify("[cron] test failed run=1 boom")).resolves.toBeUndefined();
  });
});
