import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ask } from "../answer/index.js";
import { finalizeDecision } from "../decisions/log.js";
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

function buildServer(): McpServer {
  const server = new McpServer({ name: "decision-brain", version: "0.1.0" });

  server.registerTool(
    "ask",
    {
      description:
        "Ask the decision brain a CEO question. Retrieves cited facts, researches gaps, synthesizes a cited brief, and logs it as a PENDING decision (not yet approved).",
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
        "Record the human's approve/reject call on a pending decision. Append-only: a decision can be finalized exactly once.",
      inputSchema: {
        decision_id: z.string().uuid(),
        human_decision: z.enum(["approved", "rejected"]),
        note: z.string().optional(),
      },
    },
    async ({ decision_id, human_decision, note }) => {
      await finalizeDecision(decision_id, human_decision, note);
      return json({ decision_id, human_decision, note: note ?? null, status: "finalized" });
    },
  );

  server.registerTool(
    "query_facts",
    {
      description: "Query typed facts by predicate prefix and/or subject name.",
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
      description: "Query canonical entities by type and/or name.",
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
      description: "Query aggregated signals by type and/or promotion status.",
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
        "List detected contradictions. Optionally filter by whether they are resolved.",
      inputSchema: { resolved: z.boolean().optional() },
    },
    async ({ resolved }) => json(await getContradictions({ resolved })),
  );

  server.registerTool(
    "ingest_items",
    {
      description:
        "Ingest new raw items (call/email/note/tweet/doc/research) into memory through the full extraction pipeline.",
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
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs go to stderr so they don't corrupt the stdio JSON-RPC channel.
  console.error("MCP server starting... (decision-brain, stdio)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
