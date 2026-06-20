import { completeJSON, ExtractionError } from "../llm/provider.js";
import {
  BriefSchema,
  SYNTHESIZE_SYSTEM,
  buildSynthesisUser,
  type Brief,
  type SynthContradiction,
  type SynthFact,
} from "../llm/synthesize-prompt.js";
import { validateCitations } from "./validate-citations.js";
import type { Retrieved } from "./retrieve.js";
import type { ResearchFinding } from "../research/tavily.js";

/**
 * The answer-synthesis LLM seam. One structured-output call against BriefSchema,
 * gated by the citation validator. On a citation failure we retry exactly once
 * with the valid fact-id set spelled out; a second failure throws.
 */

function toSynthFacts(retrieved: Retrieved): SynthFact[] {
  return retrieved.facts.map((f) => ({
    id: f.id,
    predicate: f.predicate,
    value: f.value,
    verbatim_quote: f.verbatimQuote,
    source_ref: f.sourceRef,
    evidence_tier: f.evidenceTier,
    confidence: f.confidence,
  }));
}

function toSynthContradictions(retrieved: Retrieved): SynthContradiction[] {
  return retrieved.contradictions.map((c) => ({
    fact_a_id: c.factAId,
    fact_b_id: c.factBId,
    reason: c.reason,
  }));
}

export async function synthesizeBrief(
  question: string,
  retrieved: Retrieved,
  researchFindings: ResearchFinding[],
): Promise<Brief> {
  const facts = toSynthFacts(retrieved);
  const validFactIds = facts.map((f) => f.id);
  const contradictions = toSynthContradictions(retrieved);
  const signals = retrieved.signals.map((s) => ({
    type: s.type,
    status: s.status,
    summary: s.summary,
  }));
  const research = researchFindings.flatMap((finding) =>
    finding.results.map((r) => ({
      query: finding.query,
      url: r.url,
      title: r.title,
      snippet: r.snippet,
    })),
  );

  for (let attempt = 0; attempt < 2; attempt++) {
    const user = buildSynthesisUser({
      question,
      facts,
      signals,
      contradictions,
      research,
      validFactIds: attempt === 0 ? undefined : validFactIds,
    });

    const brief = await completeJSON({
      system: SYNTHESIZE_SYSTEM,
      user,
      schema: BriefSchema,
      maxRetries: 1,
    });

    const check = await validateCitations(brief);
    if (check.valid) return brief;
    // else loop once more with the strict valid-id list
  }

  throw new ExtractionError(
    "Brief failed citation validation after a stricter retry",
    null,
  );
}
