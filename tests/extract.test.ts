import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExtractionResultSchema, type Fact } from "../src/extract/schema.js";
import { verifyVerbatimQuotes } from "../src/extract/verify.js";

// Mock the raw provider call so completeJSON's validation + retry is testable
// without hitting any API.
vi.mock("../src/llm/raw.js", () => ({ requestRawJSON: vi.fn() }));
// Mock the DB and embedding seams so the ingest idempotency logic is testable
// without a database or API.
vi.mock("../src/db/queries.js", () => ({
  countFactsForRawItem: vi.fn(),
  findOrCreateEntity: vi.fn(),
  insertFactRows: vi.fn(),
  listRawItems: vi.fn(),
  predicateBreakdown: vi.fn(),
}));
vi.mock("../src/extract/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/extract/index.js")>();
  return { ...actual, extractFactsFromItem: vi.fn() };
});
vi.mock("../src/embed/embed.js", () => ({
  embed: vi.fn(),
  embedBatch: vi.fn(),
}));

import { requestRawJSON } from "../src/llm/raw.js";
import { completeJSON, ExtractionError } from "../src/llm/provider.js";
import { extractFactsFromItem } from "../src/extract/index.js";
import * as queries from "../src/db/queries.js";
import { embedBatch } from "../src/embed/embed.js";
import { ingestRawItem } from "../src/ingest/index.js";

const mockRaw = vi.mocked(requestRawJSON);

const BODY =
  "Maya: runway is tight.\nDevin: the picture is closer to 9 months once we hire the two AEs.";

function makeFact(predicate: string, quote: string): Fact {
  return {
    subject: { type: "venture", name: "Loomwork" },
    predicate,
    value: { value: "x" },
    evidence_tier: 4,
    confidence: 0.8,
    verbatim_quote: quote,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyVerbatimQuotes (provenance gate)", () => {
  it("accepts quotes present verbatim and rejects hallucinated ones", () => {
    const facts = [
      makeFact("runway:months", "closer to 9 months once we hire the two AEs"),
      makeFact("runway:months", "this sentence is nowhere in the body"),
    ];
    const { valid, rejected } = verifyVerbatimQuotes(facts, BODY);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatch(/not found/i);
  });
});

describe("extractFactsFromItem (happy path)", () => {
  it("returns a validated 2-fact result that passes the verifier", async () => {
    const actual = await vi.importActual<typeof import("../src/extract/index.js")>(
      "../src/extract/index.js",
    );
    mockRaw.mockResolvedValueOnce({
      facts: [
        makeFact("runway:months", "runway is tight"),
        makeFact("team:role", "hire the two AEs"),
      ],
    });
    const res = await actual.extractFactsFromItem({
      id: "abc",
      source_type: "note",
      source_ref: "note/x",
      body: BODY,
      metadata: { valid_at: "2026-06-17T08:00:00Z" },
    });
    expect(res.facts).toHaveLength(2);
    const { valid, rejected } = verifyVerbatimQuotes(res.facts, BODY);
    expect(valid).toHaveLength(2);
    expect(rejected).toHaveLength(0);
  });
});

describe("completeJSON (malformed response + retry)", () => {
  it("retries once then throws ExtractionError when output never validates", async () => {
    mockRaw.mockResolvedValue({ not: "a valid extraction result" });
    await expect(
      completeJSON({ system: "s", user: "u", schema: ExtractionResultSchema }),
    ).rejects.toBeInstanceOf(ExtractionError);
    expect(mockRaw).toHaveBeenCalledTimes(2); // initial + one retry
  });

  it("recovers when the retry returns valid output", async () => {
    mockRaw
      .mockResolvedValueOnce({ bad: true })
      .mockResolvedValueOnce({
        facts: [makeFact("runway:months", "runway is tight")],
      });
    const result = await completeJSON({
      system: "s",
      user: "u",
      schema: ExtractionResultSchema,
    });
    expect(result.facts).toHaveLength(1);
    expect(mockRaw).toHaveBeenCalledTimes(2);
  });
});

describe("ingestRawItem (idempotency)", () => {
  const item = {
    id: "abc",
    source_type: "note",
    source_ref: "note/x",
    body: BODY,
    metadata: { valid_at: "2026-06-17T08:00:00Z" },
    ingested_at: new Date("2026-06-17T08:00:00Z"),
  };

  it("skips extraction entirely when facts already exist", async () => {
    vi.mocked(queries.countFactsForRawItem).mockResolvedValue(3);
    const r = await ingestRawItem(item);
    expect(r.skipped).toBe(true);
    expect(r.extracted).toBe(0);
    expect(extractFactsFromItem).not.toHaveBeenCalled();
  });

  it("extracts, verifies, embeds, and inserts when no facts exist", async () => {
    vi.mocked(queries.countFactsForRawItem).mockResolvedValue(0);
    vi.mocked(extractFactsFromItem).mockResolvedValue({
      facts: [
        makeFact("runway:months", "runway is tight"),
        makeFact("runway:months", "hallucinated quote not in body"),
      ],
    });
    vi.mocked(queries.findOrCreateEntity).mockResolvedValue("ent-1");
    vi.mocked(embedBatch).mockResolvedValue([[0.1, 0.2, 0.3]]);
    vi.mocked(queries.insertFactRows).mockResolvedValue(1);

    const r = await ingestRawItem(item);

    expect(r.skipped).toBe(false);
    expect(r.extracted).toBe(2);
    expect(r.rejected).toBe(1); // hallucinated quote gated out
    expect(r.inserted).toBe(1);
    // Only the one valid fact is embedded and inserted.
    expect(embedBatch).toHaveBeenCalledWith([
      expect.stringContaining("runway is tight"),
    ]);
    expect(queries.insertFactRows).toHaveBeenCalledOnce();
  });
});
