import duckdb from "duckdb";

export interface Db {
  run(sql: string, ...params: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  init(): Promise<void>;
  close(): Promise<void>;
  checkpoint(): Promise<void>;
}

export function createDb(dbPath: string): Db {
  const instance = new duckdb.Database(dbPath);
  const con = instance.connect();

  function run(sql: string, ...params: unknown[]): Promise<void> {
    return new Promise((resolve, reject) => {
      con.run(sql, ...params, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    return new Promise((resolve, reject) => {
      con.all(sql, ...params, (err: Error | null, rows: T[]) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    return all<T>(sql, ...params).then((rows) => rows[0]);
  }

  async function init(): Promise<void> {
    await run("CREATE SEQUENCE IF NOT EXISTS jobs_seq START 1");
    await run("CREATE SEQUENCE IF NOT EXISTS runs_seq START 1");

    await run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id            INTEGER PRIMARY KEY DEFAULT nextval('jobs_seq'),
        name          VARCHAR NOT NULL,
        expression    VARCHAR NOT NULL,
        prompt        TEXT NOT NULL,
        cwd           VARCHAR NOT NULL,
        model         VARCHAR NOT NULL DEFAULT 'sonnet',
        permission_mode VARCHAR NOT NULL DEFAULT 'bypassPermissions',
        max_budget    DOUBLE,
        timeout_ms    INTEGER NOT NULL DEFAULT 600000,
        allowed_tools TEXT NOT NULL DEFAULT '[]',
        append_system_prompt TEXT NOT NULL DEFAULT '',
        session_limit_threshold INTEGER NOT NULL DEFAULT 90,
        daily_budget_usd DOUBLE,
        block_token_limit INTEGER,
        extra_args    TEXT NOT NULL DEFAULT '[]',
        is_paused     BOOLEAN NOT NULL DEFAULT false,
        created_at    TIMESTAMP NOT NULL DEFAULT current_timestamp
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS runs (
        id          INTEGER PRIMARY KEY DEFAULT nextval('runs_seq'),
        job_id      INTEGER NOT NULL,
        started_at  TIMESTAMP NOT NULL,
        finished_at TIMESTAMP,
        exit_code   INTEGER,
        duration_ms INTEGER,
        log_file    VARCHAR,
        error       TEXT,
        status      VARCHAR NOT NULL DEFAULT 'running',
        cost_usd    DOUBLE,
        input_tokens INTEGER,
        output_tokens INTEGER
      )
    `);

    // Migrations for existing databases
    const migrations = [
      "ALTER TABLE jobs ADD COLUMN session_limit_threshold INTEGER NOT NULL DEFAULT 90",
      "ALTER TABLE jobs ADD COLUMN daily_budget_usd DOUBLE",
      "ALTER TABLE runs ADD COLUMN cost_usd DOUBLE",
      "ALTER TABLE runs ADD COLUMN input_tokens INTEGER",
      "ALTER TABLE runs ADD COLUMN output_tokens INTEGER",
      "ALTER TABLE jobs ADD COLUMN block_token_limit INTEGER",
      "ALTER TABLE jobs ADD COLUMN is_paused BOOLEAN DEFAULT false",
      "ALTER TABLE jobs ADD COLUMN extra_args TEXT DEFAULT '[]'",
    ];
    for (const sql of migrations) {
      try { await run(sql); } catch (e) {
        const msg = String(e);
        if (!/already exists|Duplicate column|Column with name .* already exists/i.test(msg)) {
          console.error(`[migration] failed: ${sql}\n  ${msg}`);
        }
      }
    }
    // Fold schema changes into the base file: DuckDB 1.4.x cannot replay an un-checkpointed
    // `ALTER TABLE ... ADD COLUMN ... DEFAULT` from the WAL (assertion in ReplayAlter), which took
    // the server down on 2026-09-06. A checkpoint right after migrations keeps the WAL free of it.
    try { await run("CHECKPOINT"); } catch (e) { console.error(`[db] checkpoint after migrations failed: ${String(e)}`); }
  }

  function close(): Promise<void> {
    return new Promise((resolve) => {
      instance.close(() => resolve());
    });
  }

  async function checkpoint(): Promise<void> {
    try { await run("CHECKPOINT"); } catch (e) { console.error(`[db] checkpoint failed: ${String(e)}`); }
  }

  return { run, all, get, init, close, checkpoint };
}
