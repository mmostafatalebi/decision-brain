import OpenAI from "openai";
import { config } from "../config.js";

/**
 * Deterministic, read-path-safe embeddings via OpenAI text-embedding-3-small
 * (1536 dims). Used at write-time to give every fact a vector for later
 * similarity search, clustering, and entity resolution.
 */
const EMBED_MODEL = "text-embedding-3-small";
const MAX_BATCH = 100;

let client: OpenAI | undefined;
function openai(): OpenAI {
  return (client ??= new OpenAI({ apiKey: config.OPENAI_API_KEY }));
}

/** Embed up to 100 texts in a single API call. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > MAX_BATCH) {
    throw new Error(
      `embedBatch supports up to ${MAX_BATCH} texts at once (got ${texts.length})`,
    );
  }
  const res = await openai().embeddings.create({
    model: EMBED_MODEL,
    input: texts,
  });
  // OpenAI returns embeddings in request order, but sort by index defensively.
  return [...res.data]
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export async function embed(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text]);
  if (!vector) throw new Error("embedding request returned no vector");
  return vector;
}
