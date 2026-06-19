import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the persistence + embedding + LLM seams so the resolver is exercised as
// pure logic over in-memory fixtures (no DB, no API).
vi.mock("../src/entities/store.js", () => ({
  listEntitiesByType: vi.fn(),
  appendAlias: vi.fn(),
  createEntity: vi.fn(),
  listAllEntities: vi.fn(),
  mergeEntity: vi.fn(),
  updateEntityEmbedding: vi.fn(),
}));
vi.mock("../src/embed/embed.js", () => ({ embed: vi.fn(), embedBatch: vi.fn() }));
vi.mock("../src/llm/provider.js", () => ({ completeJSON: vi.fn() }));

import * as store from "../src/entities/store.js";
import { embed } from "../src/embed/embed.js";
import { completeJSON } from "../src/llm/provider.js";
import { resolveEntity } from "../src/entities/resolve.js";
import { resolveAll } from "../src/entities/index.js";
import type { EntityRow } from "../src/entities/store.js";

function makeEntity(
  id: string,
  canonicalName: string,
  opts: { aliases?: string[]; embedding?: number[]; type?: string } = {},
): EntityRow {
  return {
    id,
    type: opts.type ?? "person",
    canonicalName,
    aliases: opts.aliases ?? [],
    attributes: {},
    embedding: opts.embedding ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.createEntity).mockResolvedValue("new-id");
});

describe("resolveEntity — exact & alias", () => {
  it("exact match wins and returns the earliest entity", async () => {
    vi.mocked(store.listEntitiesByType).mockResolvedValue([
      makeEntity("a", "Acme Freight", { type: "company" }),
      makeEntity("b", "Acme Freight", { type: "company" }),
    ]);
    const res = await resolveEntity({ type: "company", name: "Acme Freight" });
    expect(res.status).toBe("exact_match");
    expect(res.entity_id).toBe("a");
    expect(embed).not.toHaveBeenCalled();
    expect(store.createEntity).not.toHaveBeenCalled();
  });

  it("alias match resolves to the owning entity", async () => {
    vi.mocked(store.listEntitiesByType).mockResolvedValue([
      makeEntity("a", "Acme Freight", { aliases: ["Acme"], type: "company" }),
    ]);
    const res = await resolveEntity({ type: "company", name: "Acme" });
    expect(res.status).toBe("alias_match");
    expect(res.entity_id).toBe("a");
  });
});

describe("resolveEntity — embedding similarity", () => {
  it("resolves to the canonical when similarity ≥ 0.85 and records an alias", async () => {
    vi.mocked(store.listEntitiesByType).mockResolvedValue([
      makeEntity("a", "Jordan Rivera", { embedding: [1, 0, 0] }),
    ]);
    vi.mocked(embed).mockResolvedValue([0.95, 0.31, 0]); // cosine ≈ 0.95 to [1,0,0]
    const res = await resolveEntity({ type: "person", name: "Jordan" });
    expect(res.status).toBe("embedding_match");
    expect(res.entity_id).toBe("a");
    expect(store.appendAlias).toHaveBeenCalledWith("a", "Jordan");
    expect(store.createEntity).not.toHaveBeenCalled();
  });

  it("creates a new canonical when similarity < 0.85", async () => {
    vi.mocked(store.listEntitiesByType).mockResolvedValue([
      makeEntity("a", "Jordan Rivera", { embedding: [1, 0, 0] }),
    ]);
    vi.mocked(embed).mockResolvedValue([0, 1, 0]); // cosine 0 to [1,0,0]
    const res = await resolveEntity({ type: "person", name: "Marcus Tan" });
    expect(res.status).toBe("created");
    expect(res.entity_id).toBe("new-id");
    expect(completeJSON).not.toHaveBeenCalled();
  });
});

describe("resolveEntity — LLM disambiguation seam", () => {
  it("does NOT call the LLM when only one candidate clears the threshold", async () => {
    vi.mocked(store.listEntitiesByType).mockResolvedValue([
      makeEntity("a", "Jordan Rivera", { embedding: [1, 0, 0] }),
    ]);
    vi.mocked(embed).mockResolvedValue([0.95, 0.31, 0]);
    const res = await resolveEntity({ type: "person", name: "Jordan" });
    expect(res.status).toBe("embedding_match");
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it("calls the LLM when 2+ candidates clear the threshold", async () => {
    vi.mocked(store.listEntitiesByType).mockResolvedValue([
      makeEntity("a", "Jordan Rivera", { embedding: [1, 0, 0] }),
      makeEntity("b", "Jordan R.", { embedding: [0.99, 0.14, 0] }),
    ]);
    vi.mocked(embed).mockResolvedValue([0.95, 0.31, 0]); // ≈0.95 to a, ≈0.94 to b
    vi.mocked(completeJSON).mockResolvedValue({ entity_id: "b" });
    const res = await resolveEntity({ type: "person", name: "Jordan" });
    expect(completeJSON).toHaveBeenCalledOnce();
    expect(res.status).toBe("llm_disambiguated");
    expect(res.entity_id).toBe("b");
  });
});

describe("resolveAll — idempotency", () => {
  it("merges a duplicate on the first run and repoints nothing on the second", async () => {
    const canonical = makeEntity("a", "Jordan Rivera", { embedding: [1, 0, 0] });
    const dup = makeEntity("b", "Jordan", { embedding: [0.95, 0.31, 0] });

    vi.mocked(store.mergeEntity).mockResolvedValue(2); // 2 facts repointed

    // First run sees both rows; second run sees only the survivor.
    vi.mocked(store.listAllEntities)
      .mockResolvedValueOnce([canonical, dup])
      .mockResolvedValueOnce([canonical]);

    const first = await resolveAll();
    expect(first.entitiesProcessed).toBe(2);
    expect(first.embeddingMatches).toBe(1);
    expect(first.factsRepointed).toBe(2);
    expect(first.orphansDeleted).toBe(1);
    expect(store.mergeEntity).toHaveBeenCalledOnce();

    vi.mocked(store.mergeEntity).mockClear();

    const second = await resolveAll();
    expect(second.entitiesProcessed).toBe(1);
    expect(second.factsRepointed).toBe(0);
    expect(second.orphansDeleted).toBe(0);
    expect(store.mergeEntity).not.toHaveBeenCalled();
  });
});
