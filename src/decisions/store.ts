import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { decisions } from "../../drizzle/schema.js";

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
