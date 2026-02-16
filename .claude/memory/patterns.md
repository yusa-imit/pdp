# Verified Code Patterns

## Route Handler Pattern
```typescript
export async function handleXxx(ctx: AppContext, id: number): Promise<Response> {
  const job = getJob(ctx, id);
  if (!job) return json({ error: "Job not found" }, 404);
  // ... logic
  return json(data);
}
```

## DuckDB Insert + Get ID
DuckDB has no `last_insert_rowid()`. Use sequence + select after insert:
```typescript
await ctx.db.run("INSERT INTO jobs (...) VALUES (?, ...)", ...params);
const row = await ctx.db.get<{ id: number }>(
  "SELECT id FROM jobs ORDER BY id DESC LIMIT 1"
);
```

## Array Storage in DuckDB
`VARCHAR[]` is unreliable with empty arrays. Store as JSON text:
```typescript
// Write
JSON.stringify(opts.allowedTools)
// Read
JSON.parse(row.allowed_tools || "[]")
```

## Test Context Factory
```typescript
import { createDb } from "../src/db";
const db = createDb(":memory:");
await db.init();
const ctx: AppContext = { db, jobs: new Map(), logsDir: tmpDir };
```

## Cron Instance Cleanup in Tests
Always stop cron instances in afterEach to prevent leaked timers:
```typescript
afterEach(async () => {
  for (const job of ctx.jobs.values()) job.instance.stop();
  await ctx.db.close();
});
```

## Job Update with Reschedule
When expression changes, stop old cron and create new one:
```typescript
if (needsReschedule) {
  job.instance.stop();
  job.instance = new Cron(job.expression, () => runJob(ctx, job));
}
```
