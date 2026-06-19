import type { Fact } from "./schema.js";

/**
 * The provenance gate. Every fact's verbatim_quote must appear as a literal
 * substring of the raw item's body — whitespace and case must match exactly.
 * A fact whose quote was paraphrased, condensed, or invented is rejected and
 * never written to the DB. This is what makes "cite the exact source" real.
 * If this gate isn't wired in, the LLM's well-documented quote-hallucination
 * failure mode silently breaks every downstream citation.
 */
export function verifyVerbatimQuotes(
  facts: Fact[],
  body: string,
): { valid: Fact[]; rejected: { fact: Fact; reason: string }[] } {
  const valid: Fact[] = [];
  const rejected: { fact: Fact; reason: string }[] = [];

  for (const fact of facts) {
    if (fact.verbatim_quote.length > 0 && body.includes(fact.verbatim_quote)) {
      valid.push(fact);
    } else {
      const preview = fact.verbatim_quote.slice(0, 80);
      rejected.push({
        fact,
        reason: `verbatim_quote not found as a literal substring of the body: ${JSON.stringify(
          preview,
        )}`,
      });
    }
  }

  return { valid, rejected };
}
