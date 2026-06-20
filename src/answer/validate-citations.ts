import { contradictionExists, existingFactIds } from "./store.js";
import type { Brief } from "../llm/synthesize-prompt.js";

/**
 * The synthesis provenance gate — the answer-side mirror of Phase 3's
 * verbatim-quote verifier. NO LLM. Checks that every citation refers to a real
 * fact and that the brief's bookkeeping is internally consistent. Without this
 * gate the brain can hallucinate citations and the provenance promise breaks.
 */

const CITE_RE = /\[F:([0-9a-fA-F-]{36})\]/g;

export function extractCitedIds(answer: string): string[] {
  const ids = new Set<string>();
  for (const m of answer.matchAll(CITE_RE)) ids.add(m[1]!.toLowerCase());
  return [...ids];
}

export interface CitationCheck {
  valid: boolean;
  invalidFactIds: string[];
  unreferencedClaims: string[];
}

export async function validateCitations(brief: Brief): Promise<CitationCheck> {
  const inBody = extractCitedIds(brief.answer);
  const declared = brief.cited_fact_ids.map((s) => s.toLowerCase());

  // Rule 1: every [F:uuid] in the body must exist in the facts table.
  const present = await existingFactIds([...new Set([...inBody, ...declared])]);
  const invalidFactIds = inBody.filter((id) => !present.has(id));

  // Rule 2: every declared cited_fact_id must appear in the body.
  const bodySet = new Set(inBody);
  const unreferencedClaims = declared.filter((id) => !bodySet.has(id));

  // Rule 3: every noted contradiction must be a real contradiction row.
  const badContradictions: string[] = [];
  for (const c of brief.contradictions_noted) {
    if (!(await contradictionExists(c.fact_a_id, c.fact_b_id))) {
      badContradictions.push(`${c.fact_a_id}~${c.fact_b_id}`);
    }
  }

  const valid =
    invalidFactIds.length === 0 &&
    unreferencedClaims.length === 0 &&
    badContradictions.length === 0;

  return {
    valid,
    invalidFactIds,
    unreferencedClaims: [...unreferencedClaims, ...badContradictions],
  };
}
