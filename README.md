# Decision Brain

A CEO decision brain for **Maya Chen, CEO of Loomwork**. It ingests a week of
messy inputs (calls, emails, board notes, tweets, doc snippets), extracts typed
and evidence-tiered facts, builds queryable bi-temporal memory with entity
resolution and contradiction detection, then answers questions with **cited,
confidence-scored** briefs — researching real gaps via web search and logging
every recommendation to an append-only decision trail for a human to approve.

> **Design stance:** _"LLMs live at the seams. Algorithms live in the path."_
> An LLM runs only at write-time (fact extraction) and at the final answer seam
> (synthesis). Everything in between — retrieval, clustering, promotion, entity
> resolution, contradiction detection — is deterministic.

## Prerequisites

- **Node.js 20+** (uses the native `process.loadEnvFile`, so no `dotenv`)
- **pnpm**
- **PostgreSQL 15+** with the [`pgvector`](https://github.com/pgvector/pgvector)
  extension installed
  - _(Verified locally against PostgreSQL 14 + pgvector 0.8.3 — everything we
    rely on, `gen_random_uuid()` and `ivfflat`, works on 14 as well.)_

### One-time database setup

```bash
createdb decision_brain
psql -d decision_brain -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -d decision_brain -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
```

## Setup

```bash
pnpm install
cp .env.example .env      # then fill in your keys + DATABASE_URL
pnpm db:migrate           # apply the schema
```

### Environment variables (`.env`)

| Key                 | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `ANTHROPIC_API_KEY` | Claude — primary write-time extraction + synthesis   |
| `OPENAI_API_KEY`    | Embeddings (`text-embedding-3-small`) + fallback LLM |
| `TAVILY_API_KEY`    | Web research tool                                    |
| `DATABASE_URL`      | Postgres connection string                           |
| `LLM_PROVIDER`      | `anthropic` (default) or `openai`                    |

## Run

```bash
pnpm seed      # ingest the Loomwork fixture week into memory
pnpm dev       # start the MCP server (stdio)
```

## Scripts

| Script             | What it does                                  |
| ------------------ | --------------------------------------------- |
| `pnpm dev`         | Start the MCP server (stdio transport)        |
| `pnpm seed`        | Ingest the fixture week                       |
| `pnpm db:generate` | Generate a Drizzle migration from the schema  |
| `pnpm db:migrate`  | Apply pending migrations                      |
| `pnpm typecheck`   | `tsc --noEmit`, strict                        |
| `pnpm test`        | Run the Vitest suite                          |

## Status

Phase 1 — project skeleton: schema, DB client, env loader, runnable
`seed`/`dev` placeholders. Business logic arrives in later phases.

See [`DESIGN.md`](./DESIGN.md) for architecture notes.
