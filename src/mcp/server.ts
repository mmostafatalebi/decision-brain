/**
 * MCP server entry point (stdio transport).
 *
 * Placeholder for Phase 1 — the real tool registration and stdio transport
 * land in a later phase. For now it just proves the entry point runs.
 */
export {}; // mark as an ES module so top-level names don't leak to global scope

async function main(): Promise<void> {
  console.log("MCP server starting...");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
