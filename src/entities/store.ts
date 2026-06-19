import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { entities, facts, rawItems, relations } from "../../drizzle/schema.js";

/**
 * Persistence layer for entity resolution + relations. Kept separate from the
 * resolution logic so the resolver can be unit-tested against in-memory
 * fixtures (mock this module) with no database.
 */

export interface EntityRow {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  attributes: Record<string, unknown>;
  embedding: number[] | null;
}

// drizzle's vector column may surface as number[] or a '[..]' string; normalize.
function parseEmbedding(v: unknown): number[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown;
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toRow(r: typeof entities.$inferSelect): EntityRow {
  return {
    id: r.id,
    type: r.type,
    canonicalName: r.canonicalName,
    aliases: r.aliases ?? [],
    attributes: r.attributes ?? {},
    embedding: parseEmbedding(r.embedding),
  };
}

export async function listAllEntities(): Promise<EntityRow[]> {
  const rows = await db.select().from(entities).orderBy(entities.createdAt);
  return rows.map(toRow);
}

export async function listEntitiesByType(type: string): Promise<EntityRow[]> {
  const rows = await db
    .select()
    .from(entities)
    .where(eq(entities.type, type))
    .orderBy(entities.createdAt);
  return rows.map(toRow);
}

export async function createEntity(input: {
  type: string;
  name: string;
  attributes?: Record<string, unknown>;
  embedding: number[] | null;
}): Promise<string> {
  const inserted = await db
    .insert(entities)
    .values({
      type: input.type,
      canonicalName: input.name,
      attributes: input.attributes ?? {},
      embedding: input.embedding,
    })
    .returning({ id: entities.id });
  return inserted[0]!.id;
}

export async function updateEntityEmbedding(
  id: string,
  embedding: number[],
): Promise<void> {
  await db.update(entities).set({ embedding }).where(eq(entities.id, id));
}

/** Append an alias only if it's not already present (idempotent). */
export async function appendAlias(id: string, alias: string): Promise<void> {
  await db
    .update(entities)
    .set({ aliases: sql`array_append(${entities.aliases}, ${alias})` })
    .where(
      and(eq(entities.id, id), sql`NOT (${alias} = ANY(${entities.aliases}))`),
    );
}

/**
 * Merge a duplicate into its canonical, atomically: repoint every fact whose
 * subject is the duplicate, record the duplicate's name as an alias, then
 * delete the duplicate. Returns the number of facts repointed.
 */
export async function mergeEntity(
  canonicalId: string,
  dupId: string,
  dupName: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const repointed = await tx
      .update(facts)
      .set({ subjectId: canonicalId })
      .where(eq(facts.subjectId, dupId))
      .returning({ id: facts.id });
    await tx
      .update(entities)
      .set({ aliases: sql`array_append(${entities.aliases}, ${dupName})` })
      .where(
        and(
          eq(entities.id, canonicalId),
          sql`NOT (${dupName} = ANY(${entities.aliases}))`,
        ),
      );
    await tx.delete(entities).where(eq(entities.id, dupId));
    return repointed.length;
  });
}

// ---- relations ----------------------------------------------------------

export interface RelationFact {
  factId: string;
  predicate: string;
  value: unknown;
  subjectId: string | null;
  subjectType: string | null;
  subjectName: string | null;
  sourceRef: string;
  metadata: Record<string, unknown>;
  confidence: number;
}

export async function factsForRelations(): Promise<RelationFact[]> {
  return db
    .select({
      factId: facts.id,
      predicate: facts.predicate,
      value: facts.value,
      subjectId: facts.subjectId,
      subjectType: entities.type,
      subjectName: entities.canonicalName,
      sourceRef: rawItems.sourceRef,
      metadata: rawItems.metadata,
      confidence: facts.confidence,
    })
    .from(facts)
    .leftJoin(entities, eq(entities.id, facts.subjectId))
    .innerJoin(rawItems, eq(rawItems.id, facts.rawItemId));
}

/** Insert-or-update a relation keyed on (source, predicate, target). Idempotent. */
export async function upsertRelation(input: {
  sourceId: string;
  predicate: string;
  targetId: string;
  evidenceFacts: string[];
  confidence: number;
}): Promise<"inserted" | "updated"> {
  const existing = await db
    .select({ id: relations.id })
    .from(relations)
    .where(
      and(
        eq(relations.sourceId, input.sourceId),
        eq(relations.predicate, input.predicate),
        eq(relations.targetId, input.targetId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(relations)
      .set({
        evidenceFacts: input.evidenceFacts,
        confidence: input.confidence,
      })
      .where(eq(relations.id, existing[0].id));
    return "updated";
  }

  await db.insert(relations).values({
    sourceId: input.sourceId,
    predicate: input.predicate,
    targetId: input.targetId,
    evidenceFacts: input.evidenceFacts,
    confidence: input.confidence,
  });
  return "inserted";
}

export async function countRelations(): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(relations);
  return rows[0]?.c ?? 0;
}

export async function relationsByPredicate(): Promise<
  { predicate: string; count: number }[]
> {
  return db
    .select({ predicate: relations.predicate, count: sql<number>`count(*)::int` })
    .from(relations)
    .groupBy(relations.predicate)
    .orderBy(sql`count(*) desc`);
}
