import { embed } from "../embed/embed.js";
import {
  allContradictions,
  allSignals,
  entitiesByIds,
  factsByPredicatePrefixes,
  factsForSubjects,
  knnFacts,
  listEntitiesLite,
  type ContradictionRow,
  type EntityLite,
  type FactRow,
  type SignalLite,
} from "./store.js";

/**
 * Deterministic retrieval. NO LLM. Hybrid: literal entity-name keyword match +
 * predicate-prefix completeness + pgvector kNN, then joins to signals,
 * entities, and contradictions. Returns everything relevant; the synthesizer
 * decides what to use.
 */

const KNN_LIMIT = 30;
const MAX_FACTS = 40;

export interface Retrieved {
  facts: FactRow[];
  signals: SignalLite[];
  entities: EntityLite[];
  contradictions: Array<ContradictionRow & { factA?: FactRow; factB?: FactRow }>;
}

/** Map question terms to predicate prefixes for completeness + scoring bias. */
export function predicatePrefixesForQuestion(question: string): string[] {
  const q = question.toLowerCase();
  const prefixes: string[] = [];
  if (/runway|burn|cash|raise/.test(q)) prefixes.push("runway:");
  if (/icp|customer|segment|upmarket|self-serve|mid-market|enterprise/.test(q))
    prefixes.push("icp:");
  if (/objection|blocker|losing|deal/.test(q)) prefixes.push("objection:");
  if (/competitor|losing to|freightpilot/.test(q)) prefixes.push("competitor:");
  if (/pricing|price/.test(q)) prefixes.push("pricing:");
  if (/\bpain\b/.test(q)) prefixes.push("pain:");
  if (/buying/.test(q)) prefixes.push("buying_signal:");
  return prefixes;
}

function entityMentioned(question: string, e: EntityLite): boolean {
  const q = question.toLowerCase();
  if (q.includes(e.canonicalName.toLowerCase())) return true;
  return e.aliases.some((a) => a.length > 2 && q.includes(a.toLowerCase()));
}

function dedupeById(rows: FactRow[]): FactRow[] {
  const seen = new Map<string, FactRow>();
  for (const r of rows) {
    const prev = seen.get(r.id);
    // Keep the highest score seen for the fact.
    if (!prev || (r.score ?? 0) > (prev.score ?? 0)) seen.set(r.id, r);
  }
  return [...seen.values()];
}

export async function retrieveForQuestion(question: string): Promise<Retrieved> {
  const qEmbedding = await embed(question);

  // Keyword scan: entities literally named in the question.
  const allEntities = await listEntitiesLite();
  const mentioned = allEntities.filter((e) => entityMentioned(question, e));

  const prefixes = predicatePrefixesForQuestion(question);

  // Three deterministic sources, merged:
  //  - predicate-prefix facts (completeness: every runway/icp fact, etc.)
  //  - facts about explicitly-named entities
  //  - embedding kNN (semantic recall)
  const [prefixFacts, subjectFacts, knn] = await Promise.all([
    factsByPredicatePrefixes(prefixes),
    factsForSubjects(mentioned.map((e) => e.id)),
    knnFacts(qEmbedding, KNN_LIMIT),
  ]);

  let merged = dedupeById([...prefixFacts, ...subjectFacts, ...knn]);

  // Bias scoring toward exact predicate matches, then trim.
  merged = merged
    .map((f) => ({
      ...f,
      score:
        (f.score ?? 0) +
        (prefixes.some((p) => f.predicate.startsWith(p)) ? 1 : 0),
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, MAX_FACTS);

  const factIdSet = new Set(merged.map((f) => f.id));
  const byId = new Map(merged.map((f) => [f.id, f]));

  // Signals overlapping the retrieved facts.
  const signalsAll = await allSignals();
  const relevantSignals = signalsAll.filter((s) =>
    s.factIds.some((id) => factIdSet.has(id)),
  );

  // Entities that are subjects of the retrieved facts.
  const subjectIds = [
    ...new Set(merged.map((f) => f.subjectId).filter((x): x is string => !!x)),
  ];
  const relevantEntities = await entitiesByIds(subjectIds);

  // Contradictions touching the retrieved facts, with both fact bodies.
  const contradictionsAll = await allContradictions();
  const relevantContradictions = contradictionsAll
    .filter((c) => factIdSet.has(c.factAId) || factIdSet.has(c.factBId))
    .map((c) => ({
      ...c,
      factA: byId.get(c.factAId),
      factB: byId.get(c.factBId),
    }));

  return {
    facts: merged,
    signals: relevantSignals,
    entities: relevantEntities,
    contradictions: relevantContradictions,
  };
}
