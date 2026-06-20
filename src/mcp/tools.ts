import { createHash } from "node:crypto";
import { and, desc, eq, ilike, isNotNull, isNull, like, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  contradictions,
  entities,
  facts,
  rawItems,
  signals,
} from "../../drizzle/schema.js";
import { ingestRawItem } from "../ingest/index.js";

/**
 * Pure-SQL query helpers backing the MCP read tools. NO LLM — these are the
 * read path. Each is small and deterministic.
 */

export async function queryFacts(filter: {
  predicate?: string;
  subject?: string;
  limit?: number;
}) {
  const conds = [];
  if (filter.predicate) conds.push(like(facts.predicate, `${filter.predicate}%`));
  if (filter.subject) conds.push(ilike(entities.canonicalName, `%${filter.subject}%`));
  return db
    .select({
      id: facts.id,
      predicate: facts.predicate,
      subject: entities.canonicalName,
      value: facts.value,
      evidenceTier: facts.evidenceTier,
      verbatimQuote: facts.verbatimQuote,
      sourceRef: rawItems.sourceRef,
    })
    .from(facts)
    .leftJoin(entities, eq(entities.id, facts.subjectId))
    .innerJoin(rawItems, eq(rawItems.id, facts.rawItemId))
    .where(conds.length ? and(...conds) : undefined)
    .limit(filter.limit ?? 50);
}

export async function queryEntities(filter: { type?: string; name?: string }) {
  const conds = [];
  if (filter.type) conds.push(eq(entities.type, filter.type));
  if (filter.name) conds.push(ilike(entities.canonicalName, `%${filter.name}%`));
  return db
    .select({
      id: entities.id,
      type: entities.type,
      canonicalName: entities.canonicalName,
      aliases: entities.aliases,
    })
    .from(entities)
    .where(conds.length ? and(...conds) : undefined);
}

export async function querySignals(filter: { type?: string; status?: string }) {
  const conds = [];
  if (filter.type) conds.push(eq(signals.type, filter.type));
  if (filter.status) conds.push(eq(signals.status, filter.status));
  return db
    .select({
      id: signals.id,
      type: signals.type,
      status: signals.status,
      evidenceCount: signals.evidenceCount,
      summary: signals.summary,
    })
    .from(signals)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(signals.evidenceCount));
}

export async function getContradictions(filter: { resolved?: boolean }) {
  const where =
    filter.resolved === undefined
      ? undefined
      : filter.resolved
        ? isNotNull(contradictions.resolution)
        : isNull(contradictions.resolution);
  return db
    .select({
      id: contradictions.id,
      reason: contradictions.reason,
      factAId: contradictions.factAId,
      factBId: contradictions.factBId,
      resolution: contradictions.resolution,
    })
    .from(contradictions)
    .where(where);
}

function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim();
}

export interface IngestItemInput {
  source_type: string;
  source_ref: string;
  body: string;
  metadata?: Record<string, unknown>;
  valid_at?: string;
}

/** Content-address, insert the raw item, then run the Phase 3 ingest pipeline. */
export async function ingestItems(items: IngestItemInput[]): Promise<{
  rawItemsCreated: number;
  factsInserted: number;
  factsRejected: number;
}> {
  let rawItemsCreated = 0;
  let factsInserted = 0;
  let factsRejected = 0;

  for (const item of items) {
    const body = normalizeBody(item.body);
    const id = createHash("sha256").update(body, "utf8").digest("hex");
    const metadata = {
      ...(item.metadata ?? {}),
      ...(item.valid_at ? { valid_at: item.valid_at } : {}),
    };

    const created = await db
      .insert(rawItems)
      .values({
        id,
        sourceType: item.source_type,
        sourceRef: item.source_ref,
        body,
        metadata,
      })
      .onConflictDoNothing({ target: rawItems.id })
      .returning({ id: rawItems.id });
    if (created.length > 0) rawItemsCreated++;

    const r = await ingestRawItem({
      id,
      source_type: item.source_type,
      source_ref: item.source_ref,
      body,
      metadata,
      ingested_at: new Date(),
    });
    factsInserted += r.inserted;
    factsRejected += r.rejected;
  }

  return { rawItemsCreated, factsInserted, factsRejected };
}

export async function listDecisions(limit = 50) {
  return db.execute(
    sql`SELECT id, question, recommendation, confidence, human_decision, created_at, decided_at FROM decisions ORDER BY created_at DESC LIMIT ${limit}`,
  );
}
