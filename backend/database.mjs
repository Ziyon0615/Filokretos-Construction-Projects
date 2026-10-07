import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const useInMemoryDatabase = process.env.USE_IN_MEMORY_DATABASE === "true";
const databaseUrl = process.env.DATABASE_URL?.trim();
const migrationUrl = process.env.DATABASE_URL_UNPOOLED?.trim() || databaseUrl;

let pool;
let migrationPool;

if (useInMemoryDatabase) {
  const { newDb } = await import("pg-mem");
  const memoryDatabase = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memoryDatabase.adapters.createPg();
  pool = new adapter.Pool();
  migrationPool = pool;
} else {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required. Use the pooled Neon connection string for the running API.");
  }
  pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  migrationPool = migrationUrl === databaseUrl ? pool : new Pool({ connectionString: migrationUrl, max: 1 });
}

export async function initializeDatabase() {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  try {
    await migrationPool.query(schema);
  } finally {
    if (migrationPool !== pool) await migrationPool.end();
  }
}

export async function closeDatabase() {
  await pool.end();
}

export { pool };
