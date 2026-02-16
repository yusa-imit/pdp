import duckdb from "duckdb";

export interface Db {
  run(sql: string, ...params: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  init(): Promise<void>;
  close(): Promise<void>;
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
    ];
    for (const sql of migrations) {
      try { await run(sql); } catch { /* column already exists */ }
    }
  }

  function close(): Promise<void> {
    return new Promise((resolve) => {
      instance.close(() => resolve());
    });
  }

  return { run, all, get, init, close };
}
