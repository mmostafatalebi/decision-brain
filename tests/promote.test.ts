import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/signals/store.js", () => ({
  listSignals: vi.fn(),
  signalSourceMetrics: vi.fn(),
  updateSignalStatus: vi.fn(),
  // unused by promote but part of the module surface
  fetchSignalFacts: vi.fn(),
  insertSignal: vi.fn(),
  updateSignalAggregate: vi.fn(),
}));

import * as store from "../src/signals/store.js";
import { promoteSignals } from "../src/signals/promote.js";
import type { SignalRow, SignalSourceMetric } from "../src/signals/store.js";

const DAY = 24 * 60 * 60 * 1000;

function signal(over: Partial<SignalRow> = {}): SignalRow {
  return {
    id: "s1",
    type: "runway_claim",
    factIds: ["f1"],
    status: "candidate",
    evidenceCount: 1,
    lastSeenAt: new Date(),
    promotedAt: {},
    ...over,
  };
}

function metric(over: Partial<SignalSourceMetric> = {}): SignalSourceMetric {
  return { signalId: "s1", distinctSources: 1, maxTier: 5, ...over };
}

beforeEach(() => vi.clearAllMocks());

async function run(sig: SignalRow, m: SignalSourceMetric) {
  vi.mocked(store.listSignals).mockResolvedValue([sig]);
  vi.mocked(store.signalSourceMetrics).mockResolvedValue([m]);
  return promoteSignals();
}

describe("promotion ladder", () => {
  it("1-fact signal stays candidate", async () => {
    await run(signal({ evidenceCount: 1 }), metric());
    expect(store.updateSignalStatus).not.toHaveBeenCalled();
  });

  it("2-fact recent signal becomes emerging", async () => {
    await run(signal({ evidenceCount: 2 }), metric({ distinctSources: 2 }));
    expect(store.updateSignalStatus).toHaveBeenCalledWith(
      "s1",
      "emerging",
      expect.objectContaining({ emerging: expect.any(String) }),
    );
  });

  it("2-fact signal older than 60 days stays candidate (recency gate)", async () => {
    await run(
      signal({ evidenceCount: 2, lastSeenAt: new Date(Date.now() - 90 * DAY) }),
      metric({ distinctSources: 2 }),
    );
    expect(store.updateSignalStatus).not.toHaveBeenCalled();
  });

  it("4-fact / 2-source / E3 signal becomes validated", async () => {
    await run(
      signal({ evidenceCount: 4 }),
      metric({ distinctSources: 2, maxTier: 3 }),
    );
    expect(store.updateSignalStatus).toHaveBeenCalledWith(
      "s1",
      "validated",
      expect.objectContaining({
        emerging: expect.any(String),
        validated: expect.any(String),
      }),
    );
  });

  it("6-fact / 3-source / E4 signal reaches decision_grade", async () => {
    await run(
      signal({ evidenceCount: 6 }),
      metric({ distinctSources: 3, maxTier: 4 }),
    );
    expect(store.updateSignalStatus).toHaveBeenCalledWith(
      "s1",
      "decision_grade",
      expect.objectContaining({ decision_grade: expect.any(String) }),
    );
  });

  it("5-fact / 1-source signal does NOT reach validated (distinct-sources gate)", async () => {
    await run(
      signal({ evidenceCount: 5 }),
      metric({ distinctSources: 1, maxTier: 5 }),
    );
    expect(store.updateSignalStatus).toHaveBeenCalledWith(
      "s1",
      "emerging",
      expect.anything(),
    );
  });

  it("one-way: a validated signal that loses evidence is NOT demoted", async () => {
    await run(
      signal({
        status: "validated",
        evidenceCount: 1, // dropped below every threshold
        promotedAt: { emerging: "t", validated: "t" },
      }),
      metric({ distinctSources: 1, maxTier: 1 }),
    );
    expect(store.updateSignalStatus).not.toHaveBeenCalled();
  });
});
