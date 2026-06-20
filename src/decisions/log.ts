import {
  finalizePending,
  insertPendingDecision,
} from "./store.js";
import type { Brief } from "../llm/synthesize-prompt.js";
import type { Retrieved } from "../answer/retrieve.js";
import type { ResearchFinding } from "../research/tavily.js";

/**
 * Append-only decision log. NO LLM. Every recommendation is written pending;
 * the human's call is the ONLY mutation, applied once. "Why did the brain say
 * that?" is answerable from one row: question, facts used, signals used,
 * research URLs, recommendation, confidence, gaps, and the human decision.
 */

export async function recordPendingDecision(
  question: string,
  brief: Brief,
  retrieved: Retrieved,
  researchFindings: ResearchFinding[],
): Promise<{ decision_id: string }> {
  const factsUsed = [...new Set(brief.cited_fact_ids)].sort();
  const factSet = new Set(factsUsed);

  // Signals "used" = retrieved signals that share a fact with the cited facts.
  const signalsUsed = retrieved.signals
    .filter((s) => s.factIds.some((id) => factSet.has(id)))
    .map((s) => s.id);

  const researchRefs = researchFindings.flatMap((f) =>
    f.results.map((r) => ({
      url: r.url,
      title: r.title,
      query: f.query,
      retrieved_at: r.retrieved_at,
    })),
  );

  const id = await insertPendingDecision({
    question,
    factsUsed,
    signalsUsed,
    researchRefs,
    recommendation: brief.recommendation,
    confidence: brief.confidence,
    openGaps: brief.open_gaps,
  });
  return { decision_id: id };
}

/**
 * Finalize a pending decision with the human's call. Rejects (throws) if the
 * row is missing or already finalized — a decision is finalized exactly once.
 */
export async function finalizeDecision(
  decision_id: string,
  human_decision: "approved" | "rejected",
  human_note?: string,
): Promise<void> {
  const ok = await finalizePending(decision_id, human_decision, human_note);
  if (!ok) {
    throw new Error(
      `Decision ${decision_id} not found or already finalized (append-only: a decision is finalized once).`,
    );
  }
}
