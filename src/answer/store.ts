import { inArray, like, or, sql, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  contradictions,
  entities,
  facts,
  rawItems,
  signals,
} from "../../drizzle/schema.js";

/**
 * Read-path data layer for the answer pipeline. Pure SQL — no LLM. Kept apart
 * from retrieve/validate logic so those can be unit-tested against fixtures.
 */

export interface FactRow {
  id: string;
  subjectId: string | null;
  predicate: string;
  value: unknown;
  evidenceTier: number;
  confidence: number;
  verbatimQuote: string;
  validAt: Date;
  rawItemId: string;
  sourceRef: string;
  sourceType: string;
  score?: number;
}

export interface SignalLite {
  id: string;
  type: string;
  status: string;
  summary: string | null;
  factIds: string[];
}

export interface EntityLite {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
}

export interface ContradictionRow {
  id: string;
  reason: string;
  factAId: string;
  factBId: string;
  resolution: Record<string, unknown> | null;
}

const FACT_FIELDS = {
  id: facts.id,
  subjectId: facts.subjectId,
  predicate: facts.predicate,
  value: facts.value,
  evidenceTier: facts.evidenceTier,
  confidence: facts.confidence,
  verbatimQuote: facts.verbatimQuote,
  validAt: facts.validAt,
  rawItemId: facts.rawItemId,
  sourceRef: rawItems.sourceRef,
  sourceType: rawItems.sourceType,
};

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** Top-k facts by pgvector cosine similarity to the question embedding. */
export async function knnFacts(
  embedding: number[],
  limit: number,
): Promise<FactRow[]> {
  const vec = vectorLiteral(embedding);
  const rows = await db
    .select({
      ...FACT_FIELDS,
      score: sql<number>`1 - (${facts.embedding} <=> ${vec}::vector)`,
    })
    .from(facts)
    .innerJoin(rawItems, eq(rawItems.id, facts.rawItemId))
    .orderBy(sql`${facts.embedding} <=> ${vec}::vector`)
    .limit(limit);
  return rows;
}

/** All facts whose predicate starts with any of the given prefixes. */
export async function factsByPredicatePrefixes(
  prefixes: string[],
): Promise<FactRow[]> {
  if (prefixes.length === 0) return [];
  return db
    .select(FACT_FIELDS)
    .from(facts)
    .innerJoin(rawItems, eq(rawItems.id, facts.rawItemId))
    .where(or(...prefixes.map((p) => like(facts.predicate, `${p}%`))));
}

export async function factsForSubjects(subjectIds: string[]): Promise<FactRow[]> {
  if (subjectIds.length === 0) return [];
  return db
    .select(FACT_FIELDS)
    .from(facts)
    .innerJoin(rawItems, eq(rawItems.id, facts.rawItemId))
    .where(inArray(facts.subjectId, subjectIds));
}

export async function listEntitiesLite(): Promise<EntityLite[]> {
  const rows = await db
    .select({
      id: entities.id,
      type: entities.type,
      canonicalName: entities.canonicalName,
      aliases: entities.aliases,
    })
    .from(entities);
  return rows.map((r) => ({ ...r, aliases: r.aliases ?? [] }));
}

export async function entitiesByIds(ids: string[]): Promise<EntityLite[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: entities.id,
      type: entities.type,
      canonicalName: entities.canonicalName,
      aliases: entities.aliases,
    })
    .from(entities)
    .where(inArray(entities.id, ids));
  return rows.map((r) => ({ ...r, aliases: r.aliases ?? [] }));
}

export async function allSignals(): Promise<SignalLite[]> {
  return db
    .select({
      id: signals.id,
      type: signals.type,
      status: signals.status,
      summary: signals.summary,
      factIds: signals.factIds,
    })
    .from(signals);
}

export async function allContradictions(): Promise<ContradictionRow[]> {
  return db
    .select({
      id: contradictions.id,
      reason: contradictions.reason,
      factAId: contradictions.factAId,
      factBId: contradictions.factBId,
      resolution: contradictions.resolution,
    })
    .from(contradictions);
}

/** Full fact rows for the given ids (used to resolve citations for display). */
export async function factsByIds(ids: string[]): Promise<FactRow[]> {
  if (ids.length === 0) return [];
  return db
    .select(FACT_FIELDS)
    .from(facts)
    .innerJoin(rawItems, eq(rawItems.id, facts.rawItemId))
    .where(inArray(facts.id, ids));
}

/** Which of the given fact ids actually exist — the citation existence check. */
export async function existingFactIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: facts.id })
    .from(facts)
    .where(inArray(facts.id, ids));
  return new Set(rows.map((r) => r.id));
}

/** Whether a contradiction row exists for the (unordered) fact pair. */
export async function contradictionExists(
  a: string,
  b: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: contradictions.id })
    .from(contradictions)
    .where(
      or(
        sql`${contradictions.factAId} = ${a} AND ${contradictions.factBId} = ${b}`,
        sql`${contradictions.factAId} = ${b} AND ${contradictions.factBId} = ${a}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}
