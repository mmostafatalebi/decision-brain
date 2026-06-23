import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { decisions, facts, rawItems, users } from "../../drizzle/schema.js";

/**
 * The decisions persistence layer. Exactly two operations exist: insert a
 * pending decision, and finalize a pending one. There is intentionally NO
 * general update — the append-only invariant is enforced by the absence of any
 * other mutation path.
 */

export interface PendingDecisionInput {
  question: string;
  factsUsed: string[];
  signalsUsed: string[];
  researchRefs: unknown[];
  recommendation: string;
  confidence: number;
  openGaps: string[];
}

export async function insertPendingDecision(
  input: PendingDecisionInput,
): Promise<string> {
  const inserted = await db
    .insert(decisions)
    .values({
      question: input.question,
      factsUsed: input.factsUsed,
      signalsUsed: input.signalsUsed,
      researchRefs: input.researchRefs,
      recommendation: input.recommendation,
      confidence: input.confidence,
      openGaps: input.openGaps,
      // humanDecision + decidedAt stay NULL → pending.
    })
    .returning({ id: decisions.id });
  return inserted[0]!.id;
}

/**
 * The ONLY mutation of `decisions`: set the human-decision columns, but only
 * while still pending. Returns false if the row is missing or already
 * finalized (so the caller can reject the duplicate finalize).
 */
export async function finalizePending(
  id: string,
  humanDecision: "approved" | "rejected",
  userId: string,
  note: string | undefined,
): Promise<boolean> {
  const updated = await db
    .update(decisions)
    .set({
      humanDecision,
      humanNote: note ?? null,
      decidedAt: new Date(),
      finalizedByUserId: userId, // audit: who finalized this decision
    })
    .where(and(eq(decisions.id, id), isNull(decisions.humanDecision)))
    .returning({ id: decisions.id });
  return updated.length > 0;
}

// ---- read-only queries (added for the web UI; SELECTs only, no mutations) ---

export interface DecisionListRow {
  id: string;
  question: string;
  recommendation: string;
  confidence: number;
  humanDecision: string | null;
  humanNote: string | null;
  openGaps: string[];
  factsUsed: string[];
  researchRefs: unknown[];
  createdAt: Date;
  decidedAt: Date | null;
  finalizedByEmail: string | null;
}

const decisionListFields = {
  id: decisions.id,
  question: decisions.question,
  recommendation: decisions.recommendation,
  confidence: decisions.confidence,
  humanDecision: decisions.humanDecision,
  humanNote: decisions.humanNote,
  openGaps: decisions.openGaps,
  factsUsed: decisions.factsUsed,
  researchRefs: decisions.researchRefs,
  createdAt: decisions.createdAt,
  decidedAt: decisions.decidedAt,
  finalizedByEmail: users.email,
};

export async function countDecisions(filter: {
  status?: "pending" | "approved" | "rejected";
  sinceDays?: number;
}): Promise<number> {
  const conds = [];
  if (filter.status === "pending") {
    conds.push(isNull(decisions.humanDecision));
  } else if (filter.status) {
    conds.push(eq(decisions.humanDecision, filter.status));
  }
  if (filter.sinceDays !== undefined) {
    conds.push(
      gte(
        decisions.decidedAt,
        new Date(Date.now() - filter.sinceDays * 24 * 60 * 60 * 1000),
      ),
    );
  }
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(decisions)
    .where(conds.length ? and(...conds) : undefined);
  return rows[0]?.c ?? 0;
}

export async function listRecentDecisions(
  limit: number,
): Promise<DecisionListRow[]> {
  return db
    .select(decisionListFields)
    .from(decisions)
    .leftJoin(users, eq(users.id, decisions.finalizedByUserId))
    .orderBy(desc(decisions.createdAt))
    .limit(limit);
}

export async function listPendingDecisions(): Promise<DecisionListRow[]> {
  return db
    .select(decisionListFields)
    .from(decisions)
    .leftJoin(users, eq(users.id, decisions.finalizedByUserId))
    .where(isNull(decisions.humanDecision))
    .orderBy(desc(decisions.createdAt));
}

export async function listHistoryDecisions(
  limit: number,
): Promise<DecisionListRow[]> {
  return db
    .select(decisionListFields)
    .from(decisions)
    .leftJoin(users, eq(users.id, decisions.finalizedByUserId))
    .where(isNotNull(decisions.humanDecision))
    .orderBy(desc(decisions.decidedAt))
    .limit(limit);
}

export interface DecisionFactLite {
  id: string;
  predicate: string;
  value: unknown;
  evidenceTier: number;
  verbatimQuote: string;
  sourceRef: string;
}

/** Batch-fetch cited facts for a set of decisions (avoids N+1 on the queue). */
export async function getFactsLite(
  factIds: string[],
): Promise<DecisionFactLite[]> {
  if (factIds.length === 0) return [];
  return db
    .select({
      id: facts.id,
      predicate: facts.predicate,
      value: facts.value,
      evidenceTier: facts.evidenceTier,
      verbatimQuote: facts.verbatimQuote,
      sourceRef: rawItems.sourceRef,
    })
    .from(facts)
    .innerJoin(rawItems, eq(rawItems.id, facts.rawItemId))
    .where(inArray(facts.id, factIds));
}

export async function getDecisionWithFacts(
  id: string,
): Promise<{ decision: DecisionListRow; facts: DecisionFactLite[] } | null> {
  const rows = await db
    .select(decisionListFields)
    .from(decisions)
    .leftJoin(users, eq(users.id, decisions.finalizedByUserId))
    .where(eq(decisions.id, id))
    .limit(1);
  const decision = rows[0];
  if (!decision) return null;
  return { decision, facts: await getFactsLite(decision.factsUsed) };
}
