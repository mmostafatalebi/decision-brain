import type { Retrieved } from "./retrieve.js";

/**
 * Rule-based gap detection. NO LLM. Matches the question's intent against the
 * retrieved evidence and flags categories that are thin or contested. A gap is
 * a fallback for what's missing — not a default search loop.
 *
 * Suppression rule: if the corpus already answers the topic (≥3 high-tier facts
 * on the topic predicate) AND there is no contradiction among those facts, the
 * gap is suppressed. A contradiction means the corpus's answer is in dispute,
 * so external validation is warranted even when facts are plentiful (this is
 * exactly why the runway question still researches despite 6 runway facts).
 */

export interface Gap {
  description: string;
  search_terms: string[];
  priority: "high" | "medium" | "low";
}

const HIGH_TIER = 3;
const STRONG_COUNT = 3;

function corpusAnswers(retrieved: Retrieved, predicatePrefix: string): boolean {
  const onTopic = retrieved.facts.filter(
    (f) => f.predicate.startsWith(predicatePrefix) && f.evidenceTier >= HIGH_TIER,
  );
  if (onTopic.length < STRONG_COUNT) return false;
  const ids = new Set(onTopic.map((f) => f.id));
  const contested = retrieved.contradictions.some(
    (c) => ids.has(c.factAId) || ids.has(c.factBId),
  );
  return !contested; // strong AND uncontested → corpus answers it
}

export function detectGaps(question: string, retrieved: Retrieved): Gap[] {
  const q = question.toLowerCase();
  const gaps: Gap[] = [];

  if (/runway|burn|cash|raise/.test(q) && !corpusAnswers(retrieved, "runway:")) {
    gaps.push({
      description:
        "No internal burn-rate / AE-hire cost benchmark to validate the runway figures",
      search_terms: [
        "SaaS Series A burn rate benchmark",
        "AE hire cost loaded comp",
      ],
      priority: "high",
    });
    gaps.push({
      description: "No recent fundraising-market signal for Series A logistics SaaS",
      search_terms: ["Series A logistics SaaS valuations 2026"],
      priority: "medium",
    });
  }

  if (
    /icp|customer|segment|upmarket|self-serve/.test(q) &&
    !corpusAnswers(retrieved, "icp:")
  ) {
    gaps.push({
      description:
        "No external GTM data on mid-market vs enterprise SaaS sales motion",
      search_terms: ["mid-market vs enterprise B2B SaaS sales motion"],
      priority: "medium",
    });
  }

  if (
    /objection|blocker|losing|deal/.test(q) &&
    !corpusAnswers(retrieved, "objection:")
  ) {
    gaps.push({
      description:
        "No pricing-tier benchmark for the procurement threshold values found in the calls",
      search_terms: ["B2B SaaS pricing tier $10k procurement threshold"],
      priority: "medium",
    });
  }

  if (
    /competitor|losing to|freightpilot/.test(q) &&
    !corpusAnswers(retrieved, "competitor:")
  ) {
    gaps.push({
      description: "No external competitive-market data on the named competitor",
      search_terms: ["FreightPilot logistics SaaS competitor analysis"],
      priority: "medium",
    });
  }

  return gaps;
}
