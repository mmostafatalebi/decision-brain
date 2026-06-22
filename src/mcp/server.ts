import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ask } from "../answer/index.js";
import { finalizeDecision } from "../decisions/log.js";
import { db } from "../db/client.js";
import { users } from "../../drizzle/schema.js";
import {
  getContradictions,
  ingestItems,
  queryEntities,
  queryFacts,
  querySignals,
} from "./tools.js";

/**
 * MCP server over stdio. Exposes the decision brain to an agent: ask a question
 * (returns a pending, cited brief), log the human decision, and run pure-SQL
 * queries over memory. The two LLM seams live behind `ask`; everything else is
 * deterministic.
 */

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function buildServer(mcpUserId: string, mcpUserEmail: string): McpServer {
  const server = new McpServer({ name: "decision-brain", version: "0.1.0" });

  server.registerTool(
    "ask",
    {
      description:
        "Ask the decision brain a CEO-level question. Returns a cited brief plus a pending decision id — the brief is a recommendation only; nothing is recorded as decided until you call log_decision.",
      inputSchema: { question: z.string().min(1) },
    },
    async ({ question }) => {
      const { decision_id, brief, pending } = await ask(question);
      return json({ decision_id, pending, brief });
    },
  );

  server.registerTool(
    "log_decision",
    {
      description:
        "Record your approval or rejection of a pending decision. A given decision_id can be finalized exactly once; replays return an error.",
      inputSchema: {
        decision_id: z.string().uuid(),
        human_decision: z.enum(["approved", "rejected"]),
        note: z.string().optional(),
      },
    },
    async ({ decision_id, human_decision, note }) => {
      // The MCP server acts as the configured MCP_USER_EMAIL; role enforcement
      // happens inside finalizeDecision (founder-only).
      await finalizeDecision(decision_id, human_decision, mcpUserId, note);
      return json({
        decision_id,
        human_decision,
        finalized_by: mcpUserEmail,
        status: "finalized",
      });
    },
  );

  server.registerTool(
    "query_facts",
    {
      description:
        "Search the brain's memory for typed, evidence-tiered facts (read-only), optionally filtered by predicate or the subject they're about.",
      inputSchema: {
        predicate: z.string().optional(),
        subject: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async (filter) => json(await queryFacts(filter)),
  );

  server.registerTool(
    "query_entities",
    {
      description:
        "Look up the canonical people, companies, and investors the brain knows about (read-only), optionally filtered by type or name.",
      inputSchema: {
        type: z.string().optional(),
        name: z.string().optional(),
      },
    },
    async (filter) => json(await queryEntities(filter)),
  );

  server.registerTool(
    "query_signals",
    {
      description:
        "Browse aggregated signals and where each sits on the promotion ladder (candidate → emerging → validated → decision_grade), optionally filtered by type or status.",
      inputSchema: {
        type: z.string().optional(),
        status: z.string().optional(),
      },
    },
    async (filter) => json(await querySignals(filter)),
  );

  server.registerTool(
    "get_contradictions",
    {
      description:
        "List the conflicting claims the brain has detected in memory, optionally filtered to just the resolved or unresolved ones.",
      inputSchema: { resolved: z.boolean().optional() },
    },
    async ({ resolved }) => json(await getContradictions({ resolved })),
  );

  server.registerTool(
    "ingest_items",
    {
      description:
        "Feed new raw items (calls, emails, notes, tweets, docs) into the brain — this is the only way to write to memory, and each item runs through the full extraction pipeline.",
      inputSchema: {
        items: z
          .array(
            z.object({
              source_type: z.enum([
                "call",
                "email",
                "note",
                "tweet",
                "doc",
                "research",
              ]),
              source_ref: z.string().min(1),
              body: z.string().min(1),
              metadata: z.record(z.unknown()).optional(),
              valid_at: z.string().datetime().optional(),
            }),
          )
          .min(1),
      },
    },
    async ({ items }) => json(await ingestItems(items)),
  );

  return server;
}

async function main(): Promise<void> {
  // The MCP server acts as one configured user when finalizing decisions.
  // Resolve it once at startup so callers don't have to pass UUIDs.
  const mcpUserEmail = process.env.MCP_USER_EMAIL ?? "maya@loomwork.local";
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, mcpUserEmail))
    .limit(1);
  const mcpUser = userRows[0];
  if (!mcpUser) {
    throw new Error(
      `MCP user not found: ${mcpUserEmail}. Run 'pnpm seed:users' first.`,
    );
  }

  const server = buildServer(mcpUser.id, mcpUserEmail);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs go to stderr so they don't corrupt the stdio JSON-RPC channel.
  console.error(
    `MCP server starting... (decision-brain, stdio; acting as ${mcpUserEmail})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
