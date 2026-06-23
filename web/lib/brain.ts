// Single place the web app reaches into the brain, so pages/actions import from
// "@/lib/brain" instead of deep ../../../../ paths. Re-exports only — no logic.
export { ingestRawItem } from "../../src/ingest/index";
export { ask } from "../../src/answer/index";
export { factsByIds } from "../../src/answer/store";
export { finalizeDecision } from "../../src/decisions/log";
export {
  countDecisions,
  listRecentDecisions,
  listPendingDecisions,
  listHistoryDecisions,
  getDecisionWithFacts,
  getFactsLite,
} from "../../src/decisions/store";
export { aggregateSignals } from "../../src/signals/cluster";
export { promoteSignals } from "../../src/signals/promote";

export type {
  DecisionListRow,
  DecisionFactLite,
} from "../../src/decisions/store";
export type { Brief } from "../../src/llm/synthesize-prompt";
export type { ResearchFinding } from "../../src/research/tavily";
export type { FactRow } from "../../src/answer/store";
