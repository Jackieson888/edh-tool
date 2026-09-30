import "server-only";
import { Pool } from "pg";

// One pool per server instance (kept on globalThis so dev hot-reloads don't leak connections).
// Use Neon's *pooled* connection string (DATABASE_URL) here; the pipeline loader uses the direct one.
const g = globalThis as unknown as { __edhPool?: Pool };

export function db(): Pool {
  if (!g.__edhPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    g.__edhPool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000 });
  }
  return g.__edhPool;
}
