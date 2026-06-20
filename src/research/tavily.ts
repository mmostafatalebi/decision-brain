import { createHash } from "node:crypto";
import { tavily } from "@tavily/core";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { rawItems } from "../../drizzle/schema.js";
import { ingestRawItem } from "../ingest/index.js";
import type { Gap } from "../answer/gap-detect.js";

/**
 * Web research with provenance. The Tavily call is the only network hop here;
 * folding findings back into memory reuses Phase 3's ingest pipeline verbatim,
 * so research-derived facts pass the SAME verbatim-quote gate, entity resolver,
 * and embedding step as first-party items.
 */

const MAX_RESULTS = 5;

export interface ResearchResult {
  url: string;
  title: string;
  snippet: string;
  score: number;
  retrieved_at: string;
}

export interface ResearchFinding {
  query: string;
  results: ResearchResult[];
}

let client: ReturnType<typeof tavily> | undefined;
function tavilyClient() {
  return (client ??= tavily({ apiKey: config.TAVILY_API_KEY }));
}

export async function researchGap(gap: Gap): Promise<ResearchFinding> {
  // One query per gap (its primary search term) keeps token/network cost bounded.
  const query = gap.search_terms[0] ?? gap.description;
  const retrievedAt = new Date().toISOString();
  const res = await tavilyClient().search(query, {
    maxResults: MAX_RESULTS,
    searchDepth: "basic",
  });
  return {
    query,
    results: (res.results ?? []).slice(0, MAX_RESULTS).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.content,
      score: r.score,
      retrieved_at: retrievedAt,
    })),
  };
}

function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim();
}

async function insertResearchRawItem(
  id: string,
  sourceRef: string,
  body: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const inserted = await db
    .insert(rawItems)
    .values({ id, sourceType: "research", sourceRef, body, metadata })
    .onConflictDoNothing({ target: rawItems.id })
    .returning({ id: rawItems.id });
  return inserted.length > 0;
}

export async function foldResearchAsFacts(finding: ResearchFinding): Promise<{
  rawItemsCreated: number;
  factsExtracted: number;
  factsRejected: number;
}> {
  let rawItemsCreated = 0;
  let factsExtracted = 0;
  let factsRejected = 0;

  for (const r of finding.results) {
    const body = normalizeBody(`${r.title}\n\n${r.snippet}`);
    if (!body) continue;
    const id = createHash("sha256").update(body, "utf8").digest("hex");
    const sourceRef = `research/${id.slice(0, 12)}`;
    const metadata = {
      url: r.url,
      query: finding.query,
      score: r.score,
      retrieved_at: r.retrieved_at,
      // valid_at lets extraction stamp facts with the retrieval time.
      valid_at: r.retrieved_at,
    };

    const created = await insertResearchRawItem(id, sourceRef, body, metadata);
    if (created) rawItemsCreated++;

    // Reuse Phase 3's pipeline: idempotency check, extract, verbatim-quote gate,
    // entity resolution, embed, insert. Skips token spend if already ingested.
    const result = await ingestRawItem({
      id,
      source_type: "research",
      source_ref: sourceRef,
      body,
      metadata,
      ingested_at: new Date(),
    });
    factsExtracted += result.extracted;
    factsRejected += result.rejected;
  }

  return { rawItemsCreated, factsExtracted, factsRejected };
}

/** Whether a research raw_item already exists (idempotency helper for tests/CLI). */
export async function researchItemExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: rawItems.id })
    .from(rawItems)
    .where(eq(rawItems.id, id))
    .limit(1);
  return rows.length > 0;
}
