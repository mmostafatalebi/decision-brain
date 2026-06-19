import { pathToFileURL } from "node:url";
import { pool } from "../db/client.js";
import { embed } from "../embed/embed.js";
import { matchEntity, type EntityType } from "./resolve.js";
import {
  listAllEntities,
  mergeEntity,
  updateEntityEmbedding,
  type EntityRow,
} from "./store.js";

export interface ResolveSummary {
  entitiesProcessed: number;
  exactMatches: number;
  embeddingMatches: number;
  llmDisambiguations: number;
  created: number;
  factsRepointed: number;
  orphansDeleted: number;
}

/**
 * Dedupe the entities table. Walk entities oldest-first; the earliest spelling
 * of a thing becomes its canonical. Each later entity is resolved against the
 * canonicals accepted so far — if it matches one, it's a duplicate: its facts
 * are repointed, its name kept as an alias, and the row deleted (all in one
 * transaction). Otherwise it becomes a new canonical. Idempotent: a second run
 * finds no duplicates and repoints nothing.
 */
export async function resolveAll(): Promise<ResolveSummary> {
  const all = await listAllEntities();

  // Step 1: ensure every entity has an embedding (Phase 3 deferred these).
  for (const e of all) {
    if (!e.embedding || e.embedding.length === 0) {
      const emb = await embed(e.canonicalName);
      await updateEntityEmbedding(e.id, emb);
      e.embedding = emb;
    }
  }

  const summary: ResolveSummary = {
    entitiesProcessed: 0,
    exactMatches: 0,
    embeddingMatches: 0,
    llmDisambiguations: 0,
    created: 0,
    factsRepointed: 0,
    orphansDeleted: 0,
  };

  const canonicals: EntityRow[] = [];

  for (const e of all) {
    summary.entitiesProcessed++;
    const poolSameType = canonicals.filter((c) => c.type === e.type);
    const m = await matchEntity(
      { type: e.type as EntityType, name: e.canonicalName },
      poolSameType,
      { candidateEmbedding: e.embedding ?? undefined },
    );

    if (m.status !== "no_match" && m.entity_id) {
      // e duplicates an already-accepted canonical → merge e into it.
      const repointed = await mergeEntity(m.entity_id, e.id, e.canonicalName);
      summary.factsRepointed += repointed;
      summary.orphansDeleted++;
      if (m.status === "exact_match" || m.status === "alias_match") {
        summary.exactMatches++;
      } else if (m.status === "embedding_match") {
        summary.embeddingMatches++;
      } else if (m.status === "llm_disambiguated") {
        summary.llmDisambiguations++;
      }
    } else {
      canonicals.push(e);
    }
  }

  return summary;
}

async function main(): Promise<void> {
  const summary = await resolveAll();
  console.log("resolveAll summary:", summary);
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
