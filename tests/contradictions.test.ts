import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/contradictions/store.js", () => ({
  fetchContradictionFacts: vi.fn(),
  insertContradiction: vi.fn(),
}));
vi.mock("../src/signals/store.js", () => ({
  listSignals: vi.fn(),
  signalSourceMetrics: vi.fn(),
  signalIdsWithUnresolvedContradictions: vi.fn(),
  updateSignalStatus: vi.fn(),
  fetchSignalFacts: vi.fn(),
  insertSignal: vi.fn(),
  updateSignalAggregate: vi.fn(),
}));

import * as cstore from "../src/contradictions/store.js";
import { detectContradictions } from "../src/contradictions/detect.js";
import type { ContradictionFact } from "../src/contradictions/store.js";
import * as sstore from "../src/signals/store.js";
import { promoteSignals } from "../src/signals/promote.js";
import type { SignalRow, SignalSourceMetric } from "../src/signals/store.js";

const SUBJECT = "loomwork";

function cf(over: Partial<ContradictionFact> = {}): ContradictionFact {
  return {
    id: "f1",
    subjectId: SUBJECT,
    predicate: "runway:months",
    value: { value: 18, unit: "months", conditional: false },
    validAt: new Date("2026-06-10T00:00:00Z"),
    supersededBy: null,
    rawItemId: "ri1",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cstore.insertContradiction).mockResolvedValue(true);
});

async function detectWith(facts: ContradictionFact[]) {
  vi.mocked(cstore.fetchContradictionFacts).mockResolvedValue(facts);
  return detectContradictions();
}

describe("detectContradictions", () => {
  it("1. numeric: runway 18 vs 9 (overlapping time) → one contradiction", async () => {
    const r = await detectWith([
      cf({ id: "a", value: { value: 18, conditional: false } }),
      cf({ id: "b", value: { value: 9, conditional: true, condition: "AE hires" } }),
    ]);
    expect(r.contradictionsFound).toBe(1);
    expect(cstore.insertContradiction).toHaveBeenCalledOnce();
  });

  it("2. numeric within ±20% tolerance: 18 vs 19 → not a contradiction", async () => {
    const r = await detectWith([
      cf({ id: "a", value: { value: 18, conditional: false } }),
      cf({ id: "b", value: { value: 19, conditional: false } }),
    ]);
    expect(r.contradictionsFound).toBe(0);
    expect(cstore.insertContradiction).not.toHaveBeenCalled();
  });

  it("3. categorical: icp enterprise vs mid-market within 60d → contradiction", async () => {
    const r = await detectWith([
      cf({
        id: "a",
        predicate: "icp:segment",
        value: { value: "enterprise", channel: "investor_update" },
      }),
      cf({
        id: "b",
        predicate: "icp:segment",
        value: { value: "mid-market", channel: "twitter" },
      }),
    ]);
    expect(r.contradictionsFound).toBe(1);
  });

  it("4. conditional vs unconditional SAME value (18/18) → not a contradiction", async () => {
    const r = await detectWith([
      cf({ id: "a", value: { value: 18, conditional: false } }),
      cf({ id: "b", value: { value: 18, conditional: true, condition: "no hires" } }),
    ]);
    expect(r.contradictionsFound).toBe(0);
  });

  it("5. conditional vs unconditional DIFFERENT values (18/9) → contradiction, reason names the condition", async () => {
    await detectWith([
      cf({ id: "a", value: { value: 18, conditional: false } }),
      cf({
        id: "b",
        value: { value: 9, conditional: true, condition: "hiring two AEs" },
      }),
    ]);
    const [, , reason] = vi.mocked(cstore.insertContradiction).mock.calls[0]!;
    expect(reason).toMatch(/unconditional/);
    expect(reason).toMatch(/conditional on hiring two AEs/);
  });

  it("6. supersession: A superseded_by B → not a contradiction even if values differ", async () => {
    const r = await detectWith([
      cf({ id: "a", value: { value: 18, conditional: false }, supersededBy: "b" }),
      cf({ id: "b", value: { value: 9, conditional: true } }),
    ]);
    expect(r.contradictionsFound).toBe(0);
  });

  it("7. idempotency: a re-run where inserts conflict finds 0 new contradictions", async () => {
    const facts = [
      cf({ id: "a", value: { value: 18, conditional: false } }),
      cf({ id: "b", value: { value: 9, conditional: true } }),
    ];
    vi.mocked(cstore.insertContradiction).mockResolvedValueOnce(true);
    const first = await detectWith(facts);
    expect(first.contradictionsFound).toBe(1);

    vi.mocked(cstore.insertContradiction).mockResolvedValue(false); // ON CONFLICT
    const second = await detectWith(facts);
    expect(second.contradictionsFound).toBe(0);
  });
});

// ---- promotion gate -----------------------------------------------------

function signal(over: Partial<SignalRow> = {}): SignalRow {
  return {
    id: "s1",
    type: "icp_claim",
    factIds: ["f1"],
    status: "candidate",
    evidenceCount: 6,
    lastSeenAt: new Date(),
    promotedAt: {},
    ...over,
  };
}
function metric(over: Partial<SignalSourceMetric> = {}): SignalSourceMetric {
  return { signalId: "s1", distinctSources: 3, maxTier: 4, ...over };
}

describe("decision_grade contradiction gate", () => {
  it("8. a signal with an unresolved contradiction is blocked from decision_grade", async () => {
    vi.mocked(sstore.listSignals).mockResolvedValue([signal()]); // 6/3/E4 → would be decision_grade
    vi.mocked(sstore.signalSourceMetrics).mockResolvedValue([metric()]);
    vi.mocked(sstore.signalIdsWithUnresolvedContradictions).mockResolvedValue(["s1"]);

    await promoteSignals();

    expect(sstore.updateSignalStatus).toHaveBeenCalledWith(
      "s1",
      "validated", // capped — not decision_grade
      expect.anything(),
    );
  });

  it("9. a signal already at decision_grade is NOT demoted when a contradiction appears", async () => {
    vi.mocked(sstore.listSignals).mockResolvedValue([
      signal({ status: "decision_grade", promotedAt: { decision_grade: "t" } }),
    ]);
    vi.mocked(sstore.signalSourceMetrics).mockResolvedValue([metric()]);
    vi.mocked(sstore.signalIdsWithUnresolvedContradictions).mockResolvedValue(["s1"]);

    const r = await promoteSignals();

    expect(sstore.updateSignalStatus).not.toHaveBeenCalled(); // preserved
    expect(r.preservedAgainstDemotion).toContain("s1");
  });
});
