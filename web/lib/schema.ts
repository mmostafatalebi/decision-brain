// Re-export the brain's Drizzle tables for web queries (raw_items + facts on the
// ingest path, signals for the "touched" count).
export {
  rawItems,
  facts,
  signals,
  decisions,
  users,
  sessions,
} from "../../drizzle/schema";
