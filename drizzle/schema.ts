import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  smallint,
  integer,
  real,
  jsonb,
  timestamp,
  vector,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Schema mirrors the foundation's Postgres DDL one-to-one.
 *
 * Conventions:
 *  - VECTOR(1536) -> drizzle native `vector({ dimensions: 1536 })`
 *  - bi-temporal facts carry both `validAt` (true-in-world) and `learnedAt`
 *    (ingested), and supersession is a self-reference, never a delete.
 *  - timestamps are `timestamptz` (withTimezone) returning JS Date.
 */

const EMBED_DIM = 1536;

// raw items, content-addressed: id is the sha256 of the normalized body.
export const rawItems = pgTable("raw_items", {
  id: text("id").primaryKey(), // sha256 of normalized body
  sourceType: text("source_type").notNull(), // 'call' | 'email' | 'note' | 'tweet' | 'doc'
  sourceRef: text("source_ref").notNull(), // e.g. 'call/acme-eval'
  body: text("body").notNull(),
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  ingestedAt: timestamp("ingested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(), // 'person' | 'company' | 'product' | 'investor' | 'deal'
    canonicalName: text("canonical_name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'`),
    attributes: jsonb("attributes")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    embedding: vector("embedding", { dimensions: EMBED_DIM }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("entities_embedding_idx").using(
      "ivfflat",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const facts = pgTable(
  "facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rawItemId: text("raw_item_id")
      .notNull()
      .references(() => rawItems.id),
    subjectId: uuid("subject_id").references(() => entities.id),
    predicate: text("predicate").notNull(), // 'runway:months', 'icp:segment', ...
    value: jsonb("value").$type<unknown>().notNull(),
    evidenceTier: smallint("evidence_tier").notNull(), // 1..5
    confidence: real("confidence").notNull(), // 0..1
    verbatimQuote: text("verbatim_quote").notNull(),
    quoteOffset: jsonb("quote_offset").$type<{ start: number; end: number }>(),
    validAt: timestamp("valid_at", { withTimezone: true }).notNull(),
    learnedAt: timestamp("learned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededBy: uuid("superseded_by").references(
      (): AnyPgColumn => facts.id,
    ),
    embedding: vector("embedding", { dimensions: EMBED_DIM }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index("facts_embedding_idx").using(
      "ivfflat",
      t.embedding.op("vector_cosine_ops"),
    ),
    index("facts_predicate_subject_idx").on(t.predicate, t.subjectId),
    index("facts_valid_at_idx").on(t.validAt),
  ],
);

export const relations = pgTable("relations", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => entities.id),
  predicate: text("predicate").notNull(),
  targetId: uuid("target_id")
    .notNull()
    .references(() => entities.id),
  evidenceFacts: uuid("evidence_facts").array().notNull().default(sql`'{}'`),
  confidence: real("confidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const contradictions = pgTable(
  "contradictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    factAId: uuid("fact_a_id")
      .notNull()
      .references(() => facts.id),
    factBId: uuid("fact_b_id")
      .notNull()
      .references(() => facts.id),
    reason: text("reason").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolution: jsonb("resolution").$type<Record<string, unknown>>(),
  },
  (t) => [
    // Unique so contradiction detection can insert with ON CONFLICT DO NOTHING
    // (canonical least/greatest ordering makes re-runs idempotent).
    uniqueIndex("contradictions_pair_idx").on(t.factAId, t.factBId),
  ],
);

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    centroid: vector("centroid", { dimensions: EMBED_DIM }).notNull(),
    factIds: uuid("fact_ids").array().notNull(),
    status: text("status").notNull(), // 'candidate' | 'emerging' | 'validated' | 'decision_grade'
    evidenceCount: integer("evidence_count").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    promotedAt: jsonb("promoted_at")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    summary: text("summary"),
  },
  (t) => [
    index("signals_centroid_idx").using(
      "ivfflat",
      t.centroid.op("vector_cosine_ops"),
    ),
  ],
);

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  question: text("question").notNull(),
  factsUsed: uuid("facts_used").array().notNull(),
  signalsUsed: uuid("signals_used").array().notNull(),
  researchRefs: jsonb("research_refs")
    .$type<unknown[]>()
    .notNull()
    .default([]),
  recommendation: text("recommendation").notNull(),
  confidence: real("confidence").notNull(),
  openGaps: text("open_gaps").array().notNull().default(sql`'{}'`),
  humanDecision: text("human_decision"), // 'approved' | 'rejected' | null (pending)
  humanNote: text("human_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

// Convenience row types inferred from the schema.
export type RawItem = typeof rawItems.$inferSelect;
export type NewRawItem = typeof rawItems.$inferInsert;
export type Entity = typeof entities.$inferSelect;
export type NewEntity = typeof entities.$inferInsert;
export type Fact = typeof facts.$inferSelect;
export type NewFact = typeof facts.$inferInsert;
export type Relation = typeof relations.$inferSelect;
export type NewRelation = typeof relations.$inferInsert;
export type Contradiction = typeof contradictions.$inferSelect;
export type NewContradiction = typeof contradictions.$inferInsert;
export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
