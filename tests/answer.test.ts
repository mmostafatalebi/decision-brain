import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/embed/embed.js", () => ({ embed: vi.fn(), embedBatch: vi.fn() }));
vi.mock("../src/answer/store.js", () => ({
  knnFacts: vi.fn(),
  factsByPredicatePrefixes: vi.fn(),
  factsForSubjects: vi.fn(),
  listEntitiesLite: vi.fn(),
  entitiesByIds: vi.fn(),
  allSignals: vi.fn(),
  allContradictions: vi.fn(),
  existingFactIds: vi.fn(),
  contradictionExists: vi.fn(),
  factsByIds: vi.fn(),
}));
vi.mock("../src/llm/provider.js", () => ({
  completeJSON: vi.fn(),
  ExtractionError: class extends Error {},
}));
vi.mock("../src/decisions/store.js", () => ({
  insertPendingDecision: vi.fn(),
  finalizePending: vi.fn(),
}));

import { embed } from "../src/embed/embed.js";
import * as store from "../src/answer/store.js";
import { completeJSON } from "../src/llm/provider.js";
import * as dstore from "../src/decisions/store.js";
import { retrieveForQuestion } from "../src/answer/retrieve.js";
import { detectGaps } from "../src/answer/gap-detect.js";
import { validateCitations } from "../src/answer/validate-citations.js";
import { synthesizeBrief } from "../src/answer/synthesize.js";
import { recordPendingDecision, finalizeDecision } from "../src/decisions/log.js";
import type { FactRow } from "../src/answer/store.js";
import type { Brief } from "../src/llm/synthesize-prompt.js";

const U = {
  e1: "11111111-1111-1111-1111-111111111111",
  e2: "22222222-2222-2222-2222-222222222222",
  r18: "33333333-3333-3333-3333-333333333333",
  r9: "44444444-4444-4444-4444-444444444444",
  ob1: "55555555-5555-5555-5555-555555555555",
  ob2: "66666666-6666-6666-6666-666666666666",
  ob3: "77777777-7777-7777-7777-777777777777",
  bad: "00000000-0000-0000-0000-000000000000",
};

function fact(over: Partial<FactRow>): FactRow {
  return {
    id: "f",
    subjectId: "loomwork",
    predicate: "runway:months",
    value: {},
    evidenceTier: 4,
    confidence: 0.9,
    verbatimQuote: "q",
    validAt: new Date("2026-06-15T00:00:00Z"),
    rawItemId: "ri",
    sourceRef: "src",
    sourceType: "call",
    ...over,
  };
}

function brief(over: Partial<Brief>): Brief {
  return {
    question: "q",
    answer: "a",
    confidence: 0.5,
    contradictions_noted: [],
    open_gaps: [],
    recommendation: "do x",
    cited_fact_ids: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(embed).mockResolvedValue([0.1, 0.2, 0.3]);
  vi.mocked(store.listEntitiesLite).mockResolvedValue([]);
  vi.mocked(store.factsByPredicatePrefixes).mockResolvedValue([]);
  vi.mocked(store.factsForSubjects).mockResolvedValue([]);
  vi.mocked(store.knnFacts).mockResolvedValue([]);
  vi.mocked(store.allSignals).mockResolvedValue([]);
  vi.mocked(store.entitiesByIds).mockResolvedValue([]);
  vi.mocked(store.allContradictions).mockResolvedValue([]);
});

describe("retrieveForQuestion", () => {
  it("1. ICP question returns enterprise + mid-market facts and the ICP contradiction", async () => {
    vi.mocked(store.factsByPredicatePrefixes).mockResolvedValue([
      fact({ id: U.e1, predicate: "icp:segment", value: { value: "enterprise" }, sourceRef: "email/northpeak-update-may" }),
      fact({ id: U.e2, predicate: "icp:segment", value: { value: "mid-market" }, sourceRef: "tweet/maya-0612" }),
    ]);
    vi.mocked(store.allContradictions).mockResolvedValue([
      { id: "c1", reason: "icp: 'enterprise' vs 'mid-market'", factAId: U.e1, factBId: U.e2, resolution: null },
    ]);

    const r = await retrieveForQuestion("Is our ICP actually mid-market, or are we drifting up?");
    const segs = r.facts.map((f) => (f.value as { value?: string }).value);
    expect(segs).toContain("enterprise");
    expect(segs).toContain("mid-market");
    expect(r.contradictions).toHaveLength(1);
    expect(r.contradictions[0]!.factA?.id).toBe(U.e1);
  });

  it("2. objection question returns budget-authority facts across all 3 calls", async () => {
    vi.mocked(store.factsByPredicatePrefixes).mockResolvedValue([
      fact({ id: U.ob1, predicate: "objection:budget_authority", rawItemId: "acme", sourceRef: "call/acme-eval" }),
      fact({ id: U.ob2, predicate: "objection:budget_authority", rawItemId: "bright", sourceRef: "call/brightway" }),
      fact({ id: U.ob3, predicate: "objection:budget_authority", rawItemId: "delta", sourceRef: "call/delta-logix" }),
    ]);
    const r = await retrieveForQuestion("Which objection is killing deals — and is it real?");
    expect(r.facts).toHaveLength(3);
    expect(new Set(r.facts.map((f) => f.rawItemId)).size).toBe(3);
  });

  it("3. runway question returns BOTH 18-unconditional and 9-conditional facts + the contradiction", async () => {
    vi.mocked(store.factsByPredicatePrefixes).mockResolvedValue([
      fact({ id: U.r18, value: { value: 18, conditional: false }, sourceRef: "email/northpeak-update-may" }),
      fact({ id: U.r9, value: { value: 9, conditional: true }, sourceRef: "note/board-q2" }),
    ]);
    vi.mocked(store.allContradictions).mockResolvedValue([
      { id: "c2", reason: "runway: 18 months (unconditional) vs 9 months (conditional...)", factAId: U.r18, factBId: U.r9, resolution: null },
    ]);
    const r = await retrieveForQuestion("What runway can I defend in this week's investor update?");
    const vals = r.facts.map((f) => (f.value as { value?: number }).value);
    expect(vals).toContain(18);
    expect(vals).toContain(9);
    expect(r.contradictions).toHaveLength(1);
  });
});

describe("detectGaps", () => {
  const RUNWAY_Q = "What runway can I defend in this week's investor update?";

  it("4. runway question with a thin corpus → burn-rate + AE-cost gaps", () => {
    const gaps = detectGaps(RUNWAY_Q, { facts: [], signals: [], entities: [], contradictions: [] });
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    expect(gaps[0]!.priority).toBe("high");
    expect(gaps.flatMap((g) => g.search_terms).join(" ")).toMatch(/burn rate/i);
  });

  it("5. runway question with ≥3 high-tier uncontested facts → no research", () => {
    const facts = [
      fact({ id: "a", evidenceTier: 4 }),
      fact({ id: "b", evidenceTier: 4 }),
      fact({ id: "c", evidenceTier: 3 }),
    ];
    const gaps = detectGaps(RUNWAY_Q, { facts, signals: [], entities: [], contradictions: [] });
    expect(gaps).toHaveLength(0);
  });
});

describe("validateCitations (provenance gate)", () => {
  it("6a. rejects a brief that cites a UUID not in the facts table", async () => {
    vi.mocked(store.existingFactIds).mockResolvedValue(new Set([U.r18]));
    const check = await validateCitations(
      brief({ answer: `runway is 18 [F:${U.bad}]`, cited_fact_ids: [U.bad] }),
    );
    expect(check.valid).toBe(false);
    expect(check.invalidFactIds).toContain(U.bad);
  });

  it("6b. synthesizeBrief retries once when the first brief has a bad citation", async () => {
    vi.mocked(store.existingFactIds).mockResolvedValue(new Set([U.r18]));
    vi.mocked(store.contradictionExists).mockResolvedValue(true);
    vi.mocked(completeJSON)
      .mockResolvedValueOnce(brief({ answer: `[F:${U.bad}]`, cited_fact_ids: [U.bad] }))
      .mockResolvedValueOnce(brief({ answer: `[F:${U.r18}]`, cited_fact_ids: [U.r18] }));

    const retrieved = { facts: [fact({ id: U.r18 })], signals: [], entities: [], contradictions: [] };
    const out = await synthesizeBrief("q", retrieved, []);
    expect(completeJSON).toHaveBeenCalledTimes(2);
    expect(out.cited_fact_ids).toEqual([U.r18]);
  });

  it("7. rejects when cited_fact_ids contains a UUID not referenced in the body", async () => {
    vi.mocked(store.existingFactIds).mockResolvedValue(new Set([U.r18, U.r9]));
    const check = await validateCitations(
      brief({ answer: `runway [F:${U.r18}]`, cited_fact_ids: [U.r9] }),
    );
    expect(check.valid).toBe(false);
    expect(check.unreferencedClaims).toContain(U.r9);
  });
});

describe("decision log (append-only)", () => {
  it("8. finalizeDecision twice → the second call is rejected", async () => {
    vi.mocked(dstore.finalizePending).mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(finalizeDecision("d1", "approved")).resolves.toBeUndefined();
    await expect(finalizeDecision("d1", "approved")).rejects.toThrow(/already finalized/i);
  });

  it("9. recordPendingDecision writes a pending row (no human decision set)", async () => {
    vi.mocked(dstore.insertPendingDecision).mockResolvedValue("dec-1");
    const retrieved = {
      facts: [],
      signals: [{ id: "sig1", type: "runway_claim", status: "emerging", summary: "s", factIds: [U.r18] }],
      entities: [],
      contradictions: [],
    };
    const { decision_id } = await recordPendingDecision(
      "q",
      brief({ cited_fact_ids: [U.r18] }),
      retrieved,
      [],
    );
    expect(decision_id).toBe("dec-1");
    const payload = vi.mocked(dstore.insertPendingDecision).mock.calls[0]![0];
    expect(payload.factsUsed).toEqual([U.r18]);
    expect(payload.signalsUsed).toEqual(["sig1"]); // signal shares the cited fact
    expect(payload).not.toHaveProperty("humanDecision");
  });
});
