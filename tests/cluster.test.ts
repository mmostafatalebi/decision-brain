import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/signals/store.js", () => ({
  fetchSignalFacts: vi.fn(),
  listSignals: vi.fn(),
  insertSignal: vi.fn(),
  updateSignalAggregate: vi.fn(),
  signalSourceMetrics: vi.fn(),
  updateSignalStatus: vi.fn(),
}));

import * as store from "../src/signals/store.js";
import { clusterByEmbedding, aggregateSignals } from "../src/signals/cluster.js";
import type { SignalFact } from "../src/signals/store.js";

function fact(over: Partial<SignalFact> = {}): SignalFact {
  return {
    id: "f1",
    predicate: "runway:months",
    value: { value: 18, unit: "months", conditional: false },
    embedding: [1, 0],
    validAt: new Date("2026-06-15T00:00:00Z"),
    evidenceTier: 4,
    rawItemId: "ri1",
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("clusterByEmbedding (embedding kNN primitive)", () => {
  it("clusters two facts with cosine similarity ≥ 0.80 together", () => {
    const a = fact({ id: "a", embedding: [1, 0] });
    // cosine([1,0],[0.85,0.527]) ≈ 0.85
    const b = fact({ id: "b", embedding: [0.85, 0.527] });
    const clusters = clusterByEmbedding([a, b], 0.8);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.facts).toHaveLength(2);
  });

  it("keeps two facts with cosine similarity 0.60 in separate clusters", () => {
    const a = fact({ id: "a", embedding: [1, 0] });
    // cosine([1,0],[0.6,0.8]) = 0.60
    const b = fact({ id: "b", embedding: [0.6, 0.8] });
    const clusters = clusterByEmbedding([a, b], 0.8);
    expect(clusters).toHaveLength(2);
  });
});

describe("aggregateSignals — idempotency", () => {
  const twoRunwayFacts = [
    fact({ id: "a", rawItemId: "ri1" }),
    fact({ id: "b", rawItemId: "ri2" }),
  ];

  it("inserts on the first run and updates (no new rows) on the second", async () => {
    vi.mocked(store.fetchSignalFacts).mockResolvedValue(twoRunwayFacts);

    // First run: nothing exists yet → one insert, no updates.
    vi.mocked(store.listSignals).mockResolvedValueOnce([]);
    const first = await aggregateSignals();
    expect(first.signalsCreated).toBe(1);
    expect(first.signalsUpdated).toBe(0);
    expect(store.insertSignal).toHaveBeenCalledOnce();

    // Second run: the same cluster already exists (same type + sorted fact_ids)
    // → one update, no inserts.
    vi.mocked(store.listSignals).mockResolvedValueOnce([
      {
        id: "s1",
        type: "runway_claim",
        factIds: ["a", "b"],
        status: "candidate",
        evidenceCount: 2,
        lastSeenAt: new Date(),
        promotedAt: {},
      },
    ]);
    const second = await aggregateSignals();
    expect(second.signalsCreated).toBe(0);
    expect(second.signalsUpdated).toBe(1);
    expect(store.updateSignalAggregate).toHaveBeenCalledOnce();
  });
});
