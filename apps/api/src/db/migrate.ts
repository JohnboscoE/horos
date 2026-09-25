import { loadConfig } from "../env.js";
import { migrate, openDb } from "./db.js";

const cfg = loadConfig();
const db = await openDb({ databaseUrl: cfg.databaseUrl, pgliteDir: cfg.pgliteDir });
await migrate(db);
await db.close();
console.log(`[migrate] schema applied (${cfg.databaseUrl ? "postgres" : `pglite:${cfg.pgliteDir}`})`);
