import { z } from "zod";
import { embed } from "../embed/embed.js";
import { completeJSON } from "../llm/provider.js";
import {
  appendAlias,
  createEntity,
  listEntitiesByType,
  type EntityRow,
} from "./store.js";

export type EntityType =
  | "person"
  | "company"
  | "product"
  | "investor"
  | "deal"
  | "venture";

export interface EntityCandidate {
  type: EntityType;
  name: string;
  attributes?: Record<string, unknown>;
}

export type ResolveStatus =
  | "exact_match"
  | "alias_match"
  | "embedding_match"
  | "llm_disambiguated"
  | "created";

export interface ResolveResult {
  entity_id: string;
  status: ResolveStatus;
  matched_via?: { canonical_name: string; similarity?: number };
}

const SIM_THRESHOLD = 0.85;

/** Step 1: normalize — lowercase, strip punctuation, collapse whitespace. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const DisambiguationSchema = z.object({ entity_id: z.string().min(1) });

export interface MatchResult {
  status: ResolveStatus | "no_match";
  entity_id?: string;
  matched_via?: { canonical_name: string; similarity?: number };
  /** Reused by the caller when it needs to create (avoids re-embedding). */
  candidateEmbedding?: number[];
}

/**
 * The resolution core, run against a supplied pool of entities (ordered
 * created_at ASC so the earliest wins ties). Steps 1-3 are deterministic;
 * step 4 is the single LLM call, used ONLY when 2+ candidates clear the
 * similarity threshold and a human-grade judgment is genuinely needed.
 */
export async function matchEntity(
  candidate: EntityCandidate,
  pool: EntityRow[],
  opts?: { candidateEmbedding?: number[] },
): Promise<MatchResult> {
  const norm = normalizeName(candidate.name);

  // Step 2a — exact canonical match (earliest first).
  for (const e of pool) {
    if (normalizeName(e.canonicalName) === norm) {
      return {
        status: "exact_match",
        entity_id: e.id,
        matched_via: { canonical_name: e.canonicalName },
      };
    }
  }
  // Step 2b — alias match.
  for (const e of pool) {
    if (e.aliases.some((a) => normalizeName(a) === norm)) {
      return {
        status: "alias_match",
        entity_id: e.id,
        matched_via: { canonical_name: e.canonicalName },
      };
    }
  }

  // Step 3 — embedding similarity over same-type entities with embeddings.
  const candidateEmbedding =
    opts?.candidateEmbedding ?? (await embed(candidate.name));
  const scored = pool
    .filter((e) => e.embedding && e.embedding.length > 0)
    .map((e) => ({ e, sim: cosine(candidateEmbedding, e.embedding!) }))
    .filter((x) => x.sim >= SIM_THRESHOLD)
    .sort((a, b) => b.sim - a.sim);

  if (scored.length === 0) {
    return { status: "no_match", candidateEmbedding };
  }
  if (scored.length === 1) {
    const top = scored[0]!;
    return {
      status: "embedding_match",
      entity_id: top.e.id,
      matched_via: { canonical_name: top.e.canonicalName, similarity: top.sim },
      candidateEmbedding,
    };
  }

  // Step 4 — LLM disambiguation: only reached when >1 candidate is ambiguous.
  const top = scored.slice(0, 5);
  const chosen = await disambiguate(
    candidate,
    top.map((x) => x.e),
  );
  if (chosen === "new") return { status: "no_match", candidateEmbedding };
  const matched = top.find((x) => x.e.id === chosen);
  return {
    status: "llm_disambiguated",
    entity_id: chosen,
    matched_via: matched
      ? { canonical_name: matched.e.canonicalName, similarity: matched.sim }
      : undefined,
    candidateEmbedding,
  };
}

async function disambiguate(
  candidate: EntityCandidate,
  candidates: EntityRow[],
): Promise<string> {
  const system =
    "You disambiguate entity references. Given a candidate name and several existing entities judged similar by embedding, decide which existing entity the candidate refers to, or whether it is a new entity. Respond via the tool with {\"entity_id\": \"<one of the given ids>\" } or {\"entity_id\": \"new\"}.";
  const user = [
    `Candidate (${candidate.type}): ${candidate.name}`,
    candidate.attributes
      ? `Candidate attributes: ${JSON.stringify(candidate.attributes)}`
      : "",
    "",
    "Existing similar entities:",
    ...candidates.map(
      (e) =>
        `- id=${e.id} canonical="${e.canonicalName}" attributes=${JSON.stringify(
          e.attributes,
        )}`,
    ),
    "",
    'Return the id of the matching entity, or "new" if the candidate is a distinct entity.',
  ]
    .filter(Boolean)
    .join("\n");

  const res = await completeJSON({
    system,
    user,
    schema: DisambiguationSchema,
    maxRetries: 1,
  });
  const allowed = new Set<string>(candidates.map((e) => e.id));
  allowed.add("new");
  return allowed.has(res.entity_id) ? res.entity_id : "new";
}

/**
 * Full resolver (used by the ingestion path): match against all same-type
 * entities; create a new canonical with an embedding if nothing matches. On an
 * embedding/LLM match, record the candidate spelling as an alias.
 */
export async function resolveEntity(
  candidate: EntityCandidate,
): Promise<ResolveResult> {
  const pool = await listEntitiesByType(candidate.type);
  const m = await matchEntity(candidate, pool);

  if (m.status !== "no_match" && m.entity_id) {
    if (m.status === "embedding_match" || m.status === "llm_disambiguated") {
      await appendAlias(m.entity_id, candidate.name);
    }
    return { entity_id: m.entity_id, status: m.status, matched_via: m.matched_via };
  }

  const embedding = m.candidateEmbedding ?? (await embed(candidate.name));
  const id = await createEntity({
    type: candidate.type,
    name: candidate.name,
    attributes: candidate.attributes,
    embedding,
  });
  return { entity_id: id, status: "created" };
}

/**
 * Deterministic exact-match-or-create resolver for graph building. No embedding
 * similarity and no LLM — names here come from structured fact values and item
 * metadata, so an exact (normalized) match is the right semantics, and this
 * keeps `buildRelations` provably LLM-free. New entities still get an embedding.
 */
export async function getOrCreateCanonicalEntity(
  candidate: EntityCandidate,
): Promise<{ entity_id: string; status: "exact_match" | "alias_match" | "created" }> {
  const pool = await listEntitiesByType(candidate.type);
  const norm = normalizeName(candidate.name);
  for (const e of pool) {
    if (normalizeName(e.canonicalName) === norm) {
      return { entity_id: e.id, status: "exact_match" };
    }
  }
  for (const e of pool) {
    if (e.aliases.some((a) => normalizeName(a) === norm)) {
      return { entity_id: e.id, status: "alias_match" };
    }
  }
  const id = await createEntity({
    type: candidate.type,
    name: candidate.name,
    attributes: candidate.attributes,
    embedding: await embed(candidate.name),
  });
  return { entity_id: id, status: "created" };
}
