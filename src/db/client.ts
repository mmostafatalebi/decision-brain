import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import * as schema from "../../drizzle/schema.js";

/**
 * Single shared pg Pool for the process. Drizzle wraps it with our typed
 * schema so every query is checked against the table definitions.
 */
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

export const db = drizzle(pool, { schema });

export type DB = typeof db;
