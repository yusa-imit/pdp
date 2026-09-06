// Fire-and-forget Discord notifications for job lifecycle events, sent via
// the `openclaw` CLI (see CLAUDE.md: "Discord at end of cycle" — this reuses
// the same mechanism for mid-cycle skip/failure/timeout alerts).
//
// No-ops entirely when OPENCLAW_DISCORD_TARGET isn't set, so this is inert
// until an operator opts in. Callers (runJob) should not `await` this — a
// slow or hung `openclaw` process must never delay a run's bookkeeping or
// hold open the parallel-job slot it occupied.

const NOTIFY_TIMEOUT_MS = 10_000;

export async function notify(text: string): Promise<void> {
  const target = process.env.OPENCLAW_DISCORD_TARGET;
  if (!target) return;

  try {
    const proc = Bun.spawn(
      ["openclaw", "message", "send", "--channel", "discord", "--target", target, "--message", text],
      { stdout: "ignore", stderr: "ignore" }
    );

    let timedOut = false;
    await Promise.race([
      proc.exited,
      new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, NOTIFY_TIMEOUT_MS)),
    ]);

    if (timedOut) {
      console.error(`[notify] openclaw did not exit within ${NOTIFY_TIMEOUT_MS}ms, killing`);
      try {
        proc.kill();
      } catch { /* already exited */ }
    }
  } catch (err) {
    console.error(`[notify] failed to send: ${String(err)}`);
  }
}
