import { pathToFileURL } from "node:url";
import { pool } from "../db/client.js";
import {
  countFactsForRawItem,
  insertFactRows,
  listRawItems,
  predicateBreakdown,
} from "../db/queries.js";
import { resolveEntity, type EntityType } from "../entities/resolve.js";
import { extractFactsFromItem, type RawItemInput } from "../extract/index.js";
import { verifyVerbatimQuotes } from "../extract/verify.js";
import { embedBatch } from "../embed/embed.js";
import type { NewFact } from "../../drizzle/schema.js";

export interface IngestItem extends RawItemInput {
  ingested_at: Date;
}

export interface ItemResult {
  skipped: boolean;
  extracted: number;
  inserted: number;
  rejected: number;
  rejectionReasons: string[];
}

export interface IngestSummary {
  rawItemsProcessed: number;
  factsExtracted: number;
  factsInserted: number;
  factsRejected: number;
  rejectionReasons: string[];
}

/**
 * Ingest a single raw item:
 *  1. Idempotency — skip entirely if facts already exist (no token spend).
 *  2. Extract typed facts via the LLM seam.
 *  3. Gate on the verbatim-quote verifier (hard provenance check).
 *  4. Resolve each subject to a placeholder entity.
 *  5. Embed each surviving fact.
 *  6. Insert all facts for the item in one transaction.
 */
export async function ingestRawItem(item: IngestItem): Promise<ItemResult> {
  const existing = await countFactsForRawItem(item.id);
  if (existing > 0) {
    return {
      skipped: true,
      extracted: 0,
      inserted: 0,
      rejected: 0,
      rejectionReasons: [],
    };
  }

  const { facts: extracted } = await extractFactsFromItem(item);
  const { valid, rejected } = verifyVerbatimQuotes(extracted, item.body);
  const rejectionReasons = rejected.map(
    (r) => `${item.source_ref}: ${r.reason}`,
  );

  if (valid.length === 0) {
    return {
      skipped: false,
      extracted: extracted.length,
      inserted: 0,
      rejected: rejected.length,
      rejectionReasons,
    };
  }

  // Resolve subjects to canonical entities (created with embeddings, deduped).
  const subjectIds: string[] = [];
  for (const fact of valid) {
    const resolved = await resolveEntity({
      type: fact.subject.type as EntityType,
      name: fact.subject.name,
      attributes: fact.subject.attributes,
    });
    subjectIds.push(resolved.entity_id);
  }

  // One embedding API call for all of this item's facts.
  const embeddings = await embedBatch(
    valid.map(
      (f) => `${f.predicate} ${JSON.stringify(f.value)} ${f.verbatim_quote}`,
    ),
  );

  const fallbackValidAt =
    typeof item.metadata?.["valid_at"] === "string"
      ? (item.metadata["valid_at"] as string)
      : undefined;

  const rows: NewFact[] = valid.map((f, i) => ({
    rawItemId: item.id,
    subjectId: subjectIds[i]!,
    predicate: f.predicate,
    value: f.value ?? {},
    evidenceTier: f.evidence_tier,
    confidence: f.confidence,
    verbatimQuote: f.verbatim_quote,
    quoteOffset: f.quote_offset ?? null,
    validAt: new Date(f.valid_at ?? fallbackValidAt ?? item.ingested_at),
    embedding: embeddings[i]!,
    metadata: {},
  }));

  const inserted = await insertFactRows(rows);
  return {
    skipped: false,
    extracted: extracted.length,
    inserted,
    rejected: rejected.length,
    rejectionReasons,
  };
}

/** Run extraction across every raw item in the DB. */
export async function ingestAll(): Promise<IngestSummary> {
  const items = await listRawItems();
  const summary: IngestSummary = {
    rawItemsProcessed: 0,
    factsExtracted: 0,
    factsInserted: 0,
    factsRejected: 0,
    rejectionReasons: [],
  };

  for (const it of items) {
    summary.rawItemsProcessed++;
    const r = await ingestRawItem({
      id: it.id,
      source_type: it.sourceType,
      source_ref: it.sourceRef,
      body: it.body,
      metadata: it.metadata,
      ingested_at: it.ingestedAt,
    });
    summary.factsExtracted += r.extracted;
    summary.factsInserted += r.inserted;
    summary.factsRejected += r.rejected;
    summary.rejectionReasons.push(...r.rejectionReasons);
  }

  return summary;
}

function prefixOf(predicate: string): string {
  // 'objection:budget_authority' stays whole (it's a graded bucket); others
  // roll up to their prefix (runway:*, icp:*, competitor:*, ...).
  if (predicate === "objection:budget_authority") return predicate;
  const head = predicate.split(":")[0];
  return `${head}:*`;
}

async function main(): Promise<void> {
  const summary = await ingestAll();

  console.log("Ingest summary:", {
    rawItemsProcessed: summary.rawItemsProcessed,
    factsExtracted: summary.factsExtracted,
    factsInserted: summary.factsInserted,
    factsRejected: summary.factsRejected,
  });

  const byPredicate = await predicateBreakdown();
  console.log("\nFacts by predicate:");
  for (const row of byPredicate) {
    console.log(`  ${row.predicate}: ${row.count}`);
  }

  const byPrefix = new Map<string, number>();
  for (const row of byPredicate) {
    byPrefix.set(
      prefixOf(row.predicate),
      (byPrefix.get(prefixOf(row.predicate)) ?? 0) + row.count,
    );
  }
  console.log("\nFacts by predicate prefix:");
  for (const [prefix, count] of [...byPrefix.entries()].sort()) {
    console.log(`  ${prefix}: ${count}`);
  }

  if (summary.rejectionReasons.length > 0) {
    console.warn(
      `\n${summary.rejectionReasons.length} fact(s) rejected by the verbatim-quote verifier:`,
    );
    for (const reason of summary.rejectionReasons) console.warn(`  - ${reason}`);
  }
}

// Only run when executed directly (tsx src/ingest/index.ts), not on import.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
