import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

let instance: Database | null = null;
let initPromise: Promise<Database> | null = null;

let previewDatabase = false;

/**
 * True when the app is running against the ephemeral in-memory database because
 * no DATABASE_URL was supplied. Never true in production: `initDatabase` refuses
 * to fall back there.
 */
export function isPreviewDatabase(): boolean {
  return previewDatabase;
}

/**
 * The Drizzle client.
 *
 * A proxy rather than a plain export so the connection can be established
 * asynchronously (the preview driver boots WASM) while every call site keeps the
 * synchronous `db.select()...` form. Awaiting `initDatabase()` once at startup
 * is what makes the proxy safe — see artifacts/api-server/src/index.ts.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    if (!instance) {
      throw new Error(
        "Database has not been initialised. Await initDatabase() before serving requests.",
      );
    }
    return Reflect.get(instance as object, prop, receiver);
  },
});

/**
 * Connects to Postgres, or boots an in-memory database when DATABASE_URL is
 * absent outside production. Safe to call more than once — later calls reuse the
 * first connection.
 */
export function initDatabase(): Promise<Database> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const url = process.env.DATABASE_URL;

    if (url) {
      const pool = new Pool({ connectionString: url });
      instance = drizzle(pool, { schema });
      return instance;
    }

    // Falling back in production would silently serve a local file-backed
    // database in place of real client records — fail loudly instead.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DATABASE_URL must be set in production. The local preview database is refused outside development.",
      );
    }

    const { createPreviewDatabase } = await import("./preview");
    instance = await createPreviewDatabase();
    previewDatabase = true;
    return instance;
  })();

  return initPromise;
}

export * from "./schema";
export { previewDataDir } from "./preview";
