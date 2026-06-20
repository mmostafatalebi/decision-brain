import { db } from "../db/client.js";
import { contradictions, facts } from "../../drizzle/schema.js";

/**
 * Persistence layer for contradiction detection. Separated from the comparison
 * logic so the detector can be unit-tested against in-memory fixtures.
 */

export interface ContradictionFact {
  id: string;
  subjectId: string | null;
  predicate: string;
  value: unknown;
  validAt: Date;
  supersededBy: string | null;
  rawItemId: string;
}

export async function fetchContradictionFacts(): Promise<ContradictionFact[]> {
  return db
    .select({
      id: facts.id,
      subjectId: facts.subjectId,
      predicate: facts.predicate,
      value: facts.value,
      validAt: facts.validAt,
      supersededBy: facts.supersededBy,
      rawItemId: facts.rawItemId,
    })
    .from(facts);
}

/**
 * Insert a contradiction with canonical ordering already applied by the caller
 * (factAId < factBId). ON CONFLICT DO NOTHING makes re-runs idempotent. Returns
 * true if a new row was written.
 */
export async function insertContradiction(
  factAId: string,
  factBId: string,
  reason: string,
): Promise<boolean> {
  const r = await db
    .insert(contradictions)
    .values({ factAId, factBId, reason })
    .onConflictDoNothing({
      target: [contradictions.factAId, contradictions.factBId],
    })
    .returning({ id: contradictions.id });
  return r.length > 0;
}
