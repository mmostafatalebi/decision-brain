// Re-export the brain's existing pg/Drizzle client so the web app shares one
// pool and one schema binding. No new DB wiring.
export { db, pool } from "../../src/db/client";
