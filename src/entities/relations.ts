import { pathToFileURL } from "node:url";
import { pool } from "../db/client.js";
import { getOrCreateCanonicalEntity } from "./resolve.js";
import {
  countRelations,
  factsForRelations,
  relationsByPredicate,
  upsertRelation,
  type RelationFact,
} from "./store.js";

/**
 * Derive the relations graph deterministically from typed facts + item
 * metadata. NO LLM runs here — every edge comes from pattern-matching on
 * predicates and structured metadata. Entity endpoints are resolved with the
 * exact-match-or-create resolver (also LLM-free).
 */

const VENTURE_NAME = "Loomwork";

/** Drop a generic industry descriptor so "Brightway Logistics" → "Brightway". */
function canonicalCompanyName(raw: string): string {
  return raw.replace(/\s+(logistics|inc\.?|llc|corp\.?)$/i, "").trim();
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export interface RelationsSummary {
  inserted: number;
  updated: number;
  total: number;
  byPredicate: { predicate: string; count: number }[];
}

export async function buildRelations(): Promise<RelationsSummary> {
  const allFacts = await factsForRelations();

  const ventureId = (
    await getOrCreateCanonicalEntity({ type: "venture", name: VENTURE_NAME })
  ).entity_id;

  let inserted = 0;
  let updated = 0;
  const apply = async (edge: {
    sourceId: string;
    predicate: string;
    targetId: string;
    evidenceFacts: string[];
    confidence: number;
  }): Promise<void> => {
    if (edge.evidenceFacts.length === 0) return;
    const r = await upsertRelation(edge);
    if (r === "inserted") inserted++;
    else updated++;
  };

  // Group facts by source item for metadata-driven rules.
  const byItem = new Map<string, RelationFact[]>();
  for (const f of allFacts) {
    const arr = byItem.get(f.sourceRef) ?? [];
    arr.push(f);
    byItem.set(f.sourceRef, arr);
  }
  const metaOf = (sourceRef: string): Record<string, unknown> =>
    byItem.get(sourceRef)?.[0]?.metadata ?? {};

  // Rule A — competitor:name → venture competes_with company.
  const competitorGroups = new Map<string, RelationFact[]>();
  for (const f of allFacts.filter((f) => f.predicate === "competitor:name")) {
    const name = asString((f.value as { value?: unknown })?.value);
    if (!name) continue;
    const arr = competitorGroups.get(name) ?? [];
    arr.push(f);
    competitorGroups.set(name, arr);
  }
  for (const [name, group] of competitorGroups) {
    const targetId = (
      await getOrCreateCanonicalEntity({ type: "company", name })
    ).entity_id;
    await apply({
      sourceId: ventureId,
      predicate: "competes_with",
      targetId,
      evidenceFacts: group.map((f) => f.factId),
      confidence: avg(group.map((f) => f.confidence)),
    });
  }

  // Rule B — investor:relationship fact → investor invested_in venture.
  for (const f of allFacts.filter(
    (f) => f.predicate === "investor:relationship" && f.subjectId,
  )) {
    await apply({
      sourceId: f.subjectId!,
      predicate: "invested_in",
      targetId: ventureId,
      evidenceFacts: [f.factId],
      confidence: f.confidence,
    });
  }

  // Rule C — item metadata.firm (investor-context) → firm invested_in venture.
  for (const [sourceRef, group] of byItem) {
    const firm = asString(metaOf(sourceRef)["firm"]);
    if (!firm) continue;
    const investorId = (
      await getOrCreateCanonicalEntity({ type: "investor", name: firm })
    ).entity_id;
    await apply({
      sourceId: investorId,
      predicate: "invested_in",
      targetId: ventureId,
      evidenceFacts: group.map((f) => f.factId),
      confidence: avg(group.map((f) => f.confidence)),
    });
  }

  // Rule D — person voicing an objection/pain at a company (from account meta).
  const atGroups = new Map<string, { companyId: string; facts: RelationFact[] }>();
  for (const f of allFacts.filter(
    (f) =>
      f.subjectType === "person" &&
      f.subjectId &&
      (f.predicate.startsWith("objection:") || f.predicate.startsWith("pain:")),
  )) {
    const account = asString(metaOf(f.sourceRef)["account"]);
    if (!account) continue;
    const company = canonicalCompanyName(account);
    const companyId = (
      await getOrCreateCanonicalEntity({ type: "company", name: company })
    ).entity_id;
    const key = `${f.subjectId}|${companyId}`;
    const entry = atGroups.get(key) ?? { companyId, facts: [] };
    entry.facts.push(f);
    atGroups.set(key, entry);
  }
  for (const [key, entry] of atGroups) {
    const personId = key.split("|")[0]!;
    await apply({
      sourceId: personId,
      predicate: "at",
      targetId: entry.companyId,
      evidenceFacts: entry.facts.map((f) => f.factId),
      confidence: avg(entry.facts.map((f) => f.confidence)),
    });
  }

  // Rules E & F — internal/board-prep items: participants/author are staff and
  // board members of the venture. (employed_by from team:role is also included.)
  const personEdge = async (
    name: string,
    predicate: "employed_by" | "board_member_of",
    evidence: RelationFact[],
  ): Promise<void> => {
    const personId = (
      await getOrCreateCanonicalEntity({ type: "person", name })
    ).entity_id;
    await apply({
      sourceId: personId,
      predicate,
      targetId: ventureId,
      evidenceFacts: evidence.map((f) => f.factId),
      confidence: avg(evidence.map((f) => f.confidence)),
    });
  };

  // Rule E (part 1) — team:role facts → person employed_by venture.
  for (const f of allFacts.filter(
    (f) => f.predicate === "team:role" && f.subjectName,
  )) {
    await personEdge(f.subjectName!, "employed_by", [f]);
  }

  for (const [sourceRef, group] of byItem) {
    const meta = metaOf(sourceRef);
    const channel = asString(meta["channel"]) ?? "";
    const purpose = asString(meta["purpose"]) ?? "";
    const audience = asString(meta["audience"]) ?? "";
    const isInternal = channel === "internal" || /internal/i.test(audience);
    const isBoard =
      /board/i.test(purpose) ||
      /board/i.test(audience) ||
      /board/i.test(sourceRef);

    if (!isInternal && !isBoard) continue;

    const people = new Set<string>(asStringArray(meta["participants"]));
    const author = asString(meta["author"]);
    if (author) people.add(author);

    for (const name of people) {
      if (isInternal) await personEdge(name, "employed_by", group);
      if (isBoard) await personEdge(name, "board_member_of", group);
    }
  }

  const total = await countRelations();
  const byPredicate = await relationsByPredicate();
  return { inserted, updated, total, byPredicate };
}

async function main(): Promise<void> {
  const summary = await buildRelations();
  console.log("buildRelations summary:", {
    inserted: summary.inserted,
    updated: summary.updated,
    total: summary.total,
  });
  console.log("\nRelations by predicate:");
  for (const row of summary.byPredicate) {
    console.log(`  ${row.predicate}: ${row.count}`);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
