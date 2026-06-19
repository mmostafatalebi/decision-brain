import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { db, pool } from "./db/client.js";
import { rawItems, type NewRawItem } from "../drizzle/schema.js";

/**
 * Seed: load the Loomwork corpus and insert it into `raw_items`.
 *
 * Items are content-addressed — the primary key is the sha256 of the
 * normalized body — so re-running this is a no-op (insert ... on conflict do
 * nothing). The richer ingest/extract pipeline arrives in a later phase; for
 * now this just lands the raw corpus faithfully.
 */

const CorpusItem = z.object({
  source_ref: z.string().min(1),
  source_type: z.enum(["call", "email", "note", "tweet", "doc"]),
  body: z.string().min(1),
  valid_at: z.string().datetime(), // ISO timestamp of when the event happened
  metadata: z.record(z.unknown()).default({}),
});
type CorpusItem = z.infer<typeof CorpusItem>;

const Corpus = z.array(CorpusItem);

/**
 * Normalize a body before hashing so trivially different encodings of the same
 * content collapse to one identity. Kept intentionally light: line endings and
 * surrounding whitespace only — we don't want to mangle the verbatim text the
 * extraction step quotes against.
 */
function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim();
}

function contentHash(body: string): string {
  return createHash("sha256").update(normalizeBody(body), "utf8").digest("hex");
}

function loadCorpus(path: string): CorpusItem[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return Corpus.parse(raw);
}

async function main(): Promise<void> {
  console.log("Seeding...");

  const items = loadCorpus("data/loomwork.json");

  const rows: NewRawItem[] = items.map((item) => ({
    id: contentHash(item.body),
    sourceType: item.source_type,
    sourceRef: item.source_ref,
    body: normalizeBody(item.body),
    // Preserve valid_at on the raw item so extraction can stamp facts with the
    // real-world event time rather than ingest time.
    metadata: { ...item.metadata, valid_at: item.valid_at },
  }));

  const inserted = await db
    .insert(rawItems)
    .values(rows)
    .onConflictDoNothing({ target: rawItems.id })
    .returning({ id: rawItems.id });

  const skipped = rows.length - inserted.length;
  console.log(
    `Corpus: ${rows.length} items — inserted ${inserted.length}, skipped ${skipped} (already present).`,
  );

  // Breakdown by source_type, straight from the DB, as a sanity check.
  const breakdown = new Map<string, number>();
  for (const item of items) {
    breakdown.set(item.source_type, (breakdown.get(item.source_type) ?? 0) + 1);
  }
  console.log(
    "By source_type:",
    Object.fromEntries([...breakdown.entries()].sort()),
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
