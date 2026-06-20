import { retrieveForQuestion, type Retrieved } from "./retrieve.js";
import { detectGaps } from "./gap-detect.js";
import { synthesizeBrief } from "./synthesize.js";
import { recordPendingDecision } from "../decisions/log.js";
import {
  foldResearchAsFacts,
  researchGap,
  type ResearchFinding,
} from "../research/tavily.js";
import type { Brief } from "../llm/synthesize-prompt.js";

/**
 * Answer pipeline orchestration. Two LLM seams (research extraction inside
 * foldResearchAsFacts, and synthesis); everything else is deterministic. The
 * orchestrator never finalizes the decision — that is the human's call.
 */
export interface AskResult {
  decision_id: string;
  brief: Brief;
  pending: true;
  research: ResearchFinding[];
}

export async function ask(question: string): Promise<AskResult> {
  // 1. Deterministic retrieval.
  let retrieved: Retrieved = await retrieveForQuestion(question);

  // 2. Rule-based gap detection.
  const gaps = detectGaps(question, retrieved);

  // 3. Research each gap and fold findings back as cited facts (Phase 3 pipeline).
  const research: ResearchFinding[] = [];
  for (const gap of gaps) {
    const finding = await researchGap(gap);
    research.push(finding);
    await foldResearchAsFacts(finding);
  }

  // 4. Re-retrieve so any newly-researched facts are visible to synthesis.
  if (gaps.length > 0) {
    retrieved = await retrieveForQuestion(question);
  }

  // 5-6. Synthesize the brief (citation-validated, retry-on-failure inside).
  const brief = await synthesizeBrief(question, retrieved, research);

  // 7. Append-only pending decision.
  const { decision_id } = await recordPendingDecision(
    question,
    brief,
    retrieved,
    research,
  );

  return { decision_id, brief, pending: true, research };
}
