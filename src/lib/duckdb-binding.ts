import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// The compiled DuckDB native addon. The `duckdb` npm package loads this at
// import time, so if it's missing the whole server crash-loops on boot with
// `Cannot find module '.../duckdb.node'`. It can vanish from an aggressive disk
// cleanup that prunes large binaries out of node_modules — this happened in the
// 2026-07 outage, where a cleanup deleted duckdb.node and every restart failed.
const BINDING = "node_modules/duckdb/lib/binding/duckdb.node";
const PREGYP = "node_modules/@mapbox/node-pre-gyp/bin/node-pre-gyp";

// Ensure the DuckDB native binding exists before anything imports `duckdb`.
// If it's missing, re-download the prebuilt via node-pre-gyp so a KeepAlive
// restart self-heals instead of crash-looping. `--fallback-to-build=false`
// keeps this to a pure download (no native toolchain needed). Throws if
// recovery fails — better to exit loudly than start with a broken DB layer.
export function ensureDuckdbBinding(): void {
  if (existsSync(BINDING)) return;

  console.warn(`[preflight] DuckDB binding missing (${BINDING}) — recovering via node-pre-gyp`);
  const res = spawnSync(
    process.execPath,
    [PREGYP, "install", "--fallback-to-build=false"],
    { cwd: "node_modules/duckdb", stdio: "inherit" },
  );

  if (res.status !== 0 || !existsSync(BINDING)) {
    throw new Error(
      `[preflight] Failed to restore DuckDB binding (exit=${res.status}). ` +
        "Fix manually: (cd node_modules/duckdb && node ../@mapbox/node-pre-gyp/bin/node-pre-gyp install)",
    );
  }
  console.warn("[preflight] DuckDB binding restored");
}
