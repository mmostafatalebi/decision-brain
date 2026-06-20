import { z } from "zod";

/**
 * The answer-synthesis seam — the second (and final) LLM call in the answer
 * pipeline. The strictest prompt in the system: the model may only build the
 * brief from the facts it is given, and every claim must cite a real fact id.
 */

export const BriefSchema = z.object({
  question: z.string(),
  answer: z.string().min(1), // markdown, with inline [F:uuid] citations
  confidence: z.number().min(0).max(1),
  contradictions_noted: z.array(
    z.object({
      fact_a_id: z.string().uuid(),
      fact_b_id: z.string().uuid(),
      reconciliation: z.string(),
    }),
  ),
  open_gaps: z.array(z.string()),
  recommendation: z.string().min(1),
  cited_fact_ids: z.array(z.string().uuid()),
});

export type Brief = z.infer<typeof BriefSchema>;

export const SYNTHESIZE_SYSTEM = `You are the synthesis seam of a CEO decision brain for Maya Chen, CEO of Loomwork. You write one cited, gap-honest brief answering her question.

HARD RULES:
- Build the answer ONLY from the FACTS provided in the input. Do not use outside knowledge. If the facts don't support a claim, don't make it.
- Every claim in the answer body MUST carry an inline citation of the form [F:<fact_id>], where <fact_id> is one of the exact UUIDs from the input FACTS. If several facts support a claim, chain them: [F:uuid1][F:uuid2].
- Never invent a UUID. Only cite UUIDs that appear in the input FACTS list.
- cited_fact_ids MUST list every UUID you referenced as [F:...] in the answer body, and nothing else.
- If the input includes CONTRADICTIONS, the brief MUST surface them explicitly and reconcile them — or state plainly that they cannot be reconciled and why. For each, add an entry to contradictions_noted with the two fact ids and your reconciliation. Use the exact fact ids from the contradiction row.
- Be honest about gaps: list in open_gaps anything the question asks that the facts cannot answer. Prefer "I don't know, here's what I'd check" over bluffing.
- If RESEARCH findings are provided, you may use them to add caveats or benchmarks, but the answer's load-bearing claims must still cite first-party FACTS by UUID. Research informs the recommendation; it does not replace citations.
- confidence (0-1) reflects how well the facts support the recommendation given any contradictions/gaps.
- recommendation: exactly one defensible next action a human can approve.

Return via the emit_result tool, matching the schema exactly.`;

export interface SynthFact {
  id: string;
  predicate: string;
  value: unknown;
  verbatim_quote: string;
  source_ref: string;
  evidence_tier: number;
  confidence: number;
}

export interface SynthContradiction {
  fact_a_id: string;
  fact_b_id: string;
  reason: string;
}

export function buildSynthesisUser(input: {
  question: string;
  facts: SynthFact[];
  signals: { type: string; status: string; summary: string | null }[];
  contradictions: SynthContradiction[];
  research: { query: string; url: string; title: string; snippet: string }[];
  validFactIds?: string[];
}): string {
  const parts: string[] = [];
  parts.push(`QUESTION: ${input.question}`);

  parts.push("\nFACTS (cite these by id as [F:id]):");
  for (const f of input.facts) {
    parts.push(
      `- id=${f.id} | ${f.predicate} | value=${JSON.stringify(f.value)} | tier=E${f.evidence_tier} | conf=${f.confidence} | source=${f.source_ref} | quote="${f.verbatim_quote}"`,
    );
  }

  if (input.signals.length > 0) {
    parts.push("\nSIGNALS (aggregated evidence; context only, cite the facts):");
    for (const s of input.signals) {
      parts.push(`- [${s.status}] ${s.type}: ${s.summary ?? ""}`);
    }
  }

  if (input.contradictions.length > 0) {
    parts.push("\nCONTRADICTIONS (you MUST address these):");
    for (const c of input.contradictions) {
      parts.push(
        `- fact_a_id=${c.fact_a_id} fact_b_id=${c.fact_b_id} :: ${c.reason}`,
      );
    }
  }

  if (input.research.length > 0) {
    parts.push("\nRESEARCH (external; for caveats/benchmarks, not citations):");
    for (const r of input.research) {
      parts.push(`- (${r.query}) ${r.title} — ${r.url}\n  ${r.snippet}`);
    }
  }

  if (input.validFactIds && input.validFactIds.length > 0) {
    parts.push(
      `\nSTRICT RETRY: your previous answer cited fact ids that do not exist or were inconsistent. The ONLY valid fact ids you may cite are:\n${input.validFactIds.join(
        ", ",
      )}\nUse only these, and make cited_fact_ids exactly the set you reference in the body.`,
    );
  }

  return parts.join("\n");
}
