import { sql } from "drizzle-orm";
import { eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { contradictions, facts, signals } from "../../drizzle/schema.js";

/**
 * Persistence layer for signal aggregation + promotion. Separated from the
 * clustering/promotion logic so both can be unit-tested against in-memory
 * fixtures with no database.
 */

function parseEmbedding(v: unknown): number[] {
  if (Array.isArray(v)) return v as number[];
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v) as unknown;
      return Array.isArray(p) ? (p as number[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export interface SignalFact {
  id: string;
  predicate: string;
  value: unknown;
  embedding: number[];
  validAt: Date;
  evidenceTier: number;
  rawItemId: string;
}

export async function fetchSignalFacts(): Promise<SignalFact[]> {
  const rows = await db
    .select({
      id: facts.id,
      predicate: facts.predicate,
      value: facts.value,
      embedding: facts.embedding,
      validAt: facts.validAt,
      evidenceTier: facts.evidenceTier,
      rawItemId: facts.rawItemId,
    })
    .from(facts);
  return rows.map((r) => ({
    id: r.id,
    predicate: r.predicate,
    value: r.value,
    embedding: parseEmbedding(r.embedding),
    validAt: r.validAt,
    evidenceTier: r.evidenceTier,
    rawItemId: r.rawItemId,
  }));
}

export interface SignalRow {
  id: string;
  type: string;
  factIds: string[];
  status: string;
  evidenceCount: number;
  lastSeenAt: Date;
  promotedAt: Record<string, string>;
}

export async function listSignals(): Promise<SignalRow[]> {
  const rows = await db.select().from(signals);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    factIds: r.factIds,
    status: r.status,
    evidenceCount: r.evidenceCount,
    lastSeenAt: r.lastSeenAt,
    promotedAt: r.promotedAt,
  }));
}

export async function insertSignal(input: {
  type: string;
  centroid: number[];
  factIds: string[];
  evidenceCount: number;
  lastSeenAt: Date;
  summary: string;
}): Promise<void> {
  await db.insert(signals).values({
    type: input.type,
    centroid: input.centroid,
    factIds: input.factIds,
    status: "candidate",
    evidenceCount: input.evidenceCount,
    lastSeenAt: input.lastSeenAt,
    summary: input.summary,
  });
}

/** Refresh derived fields of an existing signal. Never touches status/promotedAt. */
export async function updateSignalAggregate(
  id: string,
  input: {
    centroid: number[];
    evidenceCount: number;
    lastSeenAt: Date;
    summary: string;
  },
): Promise<void> {
  await db
    .update(signals)
    .set({
      centroid: input.centroid,
      evidenceCount: input.evidenceCount,
      lastSeenAt: input.lastSeenAt,
      summary: input.summary,
    })
    .where(eq(signals.id, id));
}

export async function updateSignalStatus(
  id: string,
  status: string,
  promotedAt: Record<string, string>,
): Promise<void> {
  await db.update(signals).set({ status, promotedAt }).where(eq(signals.id, id));
}

export interface SignalSourceMetric {
  signalId: string;
  distinctSources: number;
  maxTier: number;
}

/**
 * Signal ids that have ≥1 fact appearing in an UNRESOLVED contradiction — the
 * input to the decision_grade promotion gate (Phase 6).
 */
export async function signalIdsWithUnresolvedContradictions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: signals.id })
    .from(signals)
    .innerJoin(
      contradictions,
      sql`(${contradictions.factAId} = ANY(${signals.factIds}) OR ${contradictions.factBId} = ANY(${signals.factIds}))`,
    )
    .where(isNull(contradictions.resolution));
  return rows.map((r) => r.id);
}

/** distinct raw_item sources + max evidence tier per signal, via one join. */
export async function signalSourceMetrics(): Promise<SignalSourceMetric[]> {
  const rows = await db
    .select({
      signalId: signals.id,
      distinctSources: sql<number>`count(distinct ${facts.rawItemId})::int`,
      maxTier: sql<number>`max(${facts.evidenceTier})::int`,
    })
    .from(signals)
    .innerJoin(facts, sql`${facts.id} = ANY(${signals.factIds})`)
    .groupBy(signals.id);
  return rows;
}
