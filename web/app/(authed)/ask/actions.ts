"use server";
import { requirePermission } from "@/lib/auth/require-role";
import { ForbiddenError } from "@/lib/auth/permissions";
import { ask, factsByIds } from "@/lib/brain";
import { revalidatePath } from "next/cache";

type CitedFact = {
  id: string;
  predicate: string;
  tier: number;
  quote: string;
  sourceRef: string;
};
type ResearchLink = { query: string; url: string; title: string };

type AskResult =
  | {
      ok: true;
      decision_id: string;
      recommendation: string;
      confidence: number;
      openGaps: string[];
      facts: CitedFact[];
      research: ResearchLink[];
    }
  | { ok: false; error: string };

export async function askQuestion(
  _prev: AskResult | null,
  formData: FormData,
): Promise<AskResult> {
  try {
    await requirePermission("ask");
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "Forbidden." };
    throw e;
  }

  const question = String(formData.get("question") ?? "").trim();
  if (!question) return { ok: false, error: "Enter a question." };

  const { decision_id, brief, research } = await ask(question);
  const cited = await factsByIds(brief.cited_fact_ids);

  // A new pending decision now exists — refresh the queue/badge counts.
  revalidatePath("/decisions");
  revalidatePath("/dashboard");

  const facts: CitedFact[] = cited.map((f) => ({
    id: f.id,
    predicate: f.predicate,
    tier: f.evidenceTier,
    quote: f.verbatimQuote,
    sourceRef: f.sourceRef,
  }));
  const researchLinks: ResearchLink[] = research.flatMap((r) =>
    r.results.map((x) => ({ query: r.query, url: x.url, title: x.title })),
  );

  return {
    ok: true,
    decision_id,
    recommendation: brief.recommendation,
    confidence: brief.confidence,
    openGaps: brief.open_gaps,
    facts,
    research: researchLinks,
  };
}
