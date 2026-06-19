import { eq, sql } from "drizzle-orm";
import { db } from "./client.js";
import {
  facts,
  rawItems,
  type NewFact,
  type RawItem,
} from "../../drizzle/schema.js";

/** All raw items, oldest-ingested first (stable processing order). */
export async function listRawItems(): Promise<RawItem[]> {
  return db.select().from(rawItems).orderBy(rawItems.sourceRef);
}

/** How many facts already exist for a raw item — the idempotency check. */
export async function countFactsForRawItem(rawItemId: string): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(facts)
    .where(eq(facts.rawItemId, rawItemId));
  return rows[0]?.c ?? 0;
}

/** Insert all facts for one raw item atomically; returns the inserted count. */
export async function insertFactRows(rows: NewFact[]): Promise<number> {
  if (rows.length === 0) return 0;
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(facts)
      .values(rows)
      .returning({ id: facts.id });
    return inserted.length;
  });
}

/** Fact counts grouped by predicate, highest first. */
export async function predicateBreakdown(): Promise<
  { predicate: string; count: number }[]
> {
  return db
    .select({
      predicate: facts.predicate,
      count: sql<number>`count(*)::int`,
    })
    .from(facts)
    .groupBy(facts.predicate)
    .orderBy(sql`count(*) desc`);
}
