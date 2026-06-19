/**
 * Seed entry point: ingests the Loomwork fixture week into memory.
 *
 * Placeholder for Phase 1 — the real ingest/extract pipeline lands in a later
 * phase. For now it just proves the entry point runs.
 */
export {}; // mark as an ES module so top-level names don't leak to global scope

async function main(): Promise<void> {
  console.log("Seeding...");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
