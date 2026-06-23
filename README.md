# Decision Brain

Maya is scaling Loomwork. Her week is a pile of customer calls, board notes,
investor emails, tweets, and internal docs — and buried in it are decisions she
has to defend: what runway to put in front of investors, whether the ICP is
still really mid-market, which objection is actually losing deals. Decision Brain
reads that week, turns it into typed memory she can cite, and answers those
questions with briefs that surface the contradictions, point every claim back to
the exact source, and leave a record of what she decided.

## What this is

The whole thing runs on one idea: I put the model at exactly two spots — turning
each raw item into typed facts when it comes in, and turning retrieved facts into
a cited brief when you ask a question. Everything else — retrieval, entity
resolution, contradiction detection, signal aggregation, promotion, gap
detection, citation validation, the decision log — is deterministic SQL and pure
functions. So you can wipe the derived tables, rebuild them, and get the same
memory back; every citation traces to a real source; and a question costs a
known, bounded amount instead of fanning out into a pile of agent calls.

Memory is three layers. **Learnings** are typed, evidence-tiered facts with the
verbatim quote they came from. **Signals** are those facts aggregated and
promoted along `candidate → emerging → validated → decision_grade`. **Decisions**
are cited briefs you approve or reject, appended for keeps. You talk to it over an
**MCP server (stdio)** — plug it into Claude Desktop or drive it from the CLI. And
the line it won't cross: it recommends, it never acts. Every recommendation sits
as a pending decision until a human finalizes it.

## Quick start

Prerequisites: **Node 20+**, **pnpm**, **PostgreSQL 15+ with
[pgvector](https://github.com/pgvector/pgvector)** (verified on 14 + pgvector
0.8.3 too).

```bash
# 1. Database + extensions
createdb decision_brain
psql -d decision_brain -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -d decision_brain -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# 2. Install + configure
pnpm install
cp .env.example .env          # fill in DATABASE_URL + ANTHROPIC / OPENAI / TAVILY keys

# 3. Schema + build memory
pnpm db:migrate               # apply the Drizzle schema
pnpm refresh                  # seed → ingest → resolve → relations → signals → contradictions

# 4. Ask a question
pnpm ask "What runway can I defend in this week's investor update?"
```

`pnpm refresh` chains the whole write pipeline: it seeds the fixture week,
extracts typed facts (the first LLM seam), resolves entities, builds the
relations graph, aggregates and promotes signals, and detects contradictions.
After it runs, `pnpm ask "..."` answers questions against that memory.

### Environment variables (`.env`)

| Key                 | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `DATABASE_URL`      | Postgres connection string                             |
| `ANTHROPIC_API_KEY` | Claude — write-time extraction + answer synthesis      |
| `OPENAI_API_KEY`    | Embeddings (`text-embedding-3-small`) + fallback LLM   |
| `TAVILY_API_KEY`    | Web research tool (fires only on contested gaps)       |
| `LLM_PROVIDER`      | `anthropic` (default) or `openai`                      |
| `ANTHROPIC_MODEL`   | optional model override (default `claude-opus-4-8`)    |

## Example: the three CEO questions

The brain is built to answer three questions end-to-end. Each runs the same
pipeline (retrieve → detect gaps → research if contested → synthesize → validate
citations → log pending), and each produces a different shape of answer:

- **"Is our ICP actually mid-market, or are we drifting up?"** — surfaces the
  `enterprise` vs `mid-market` contradiction, citing both the tweet
  (`mid-market self-serve`) and the Northpeak investor update (`moving
  upmarket… enterprise accounts`); recommends picking one ICP statement for the
  investor comms.
- **"Which objection is killing deals — and is it real?"** — identifies
  budget-authority across all three calls (Acme $10k, Brightway $20k, Delta
  spend-freeze) with verbatim quotes, confirms it's real (product validated,
  not the blocker), recommends a sub-threshold pricing pilot. *Does not trigger
  research* — three consistent facts, no contradiction, the corpus answers it.
- **"What runway can I defend in this week's investor update?"** — surfaces the
  18-vs-9 contradiction (Northpeak email vs Devin's board note), *fires Tavily*
  for a burn-rate benchmark (because the topic is contested), and recommends
  presenting 18 months as the floor paired with ~9 months once the AE hires
  load — with the dependency disclosed.

Every claim in every brief carries an inline `[F:uuid]` citation that resolves to
a real fact with a verbatim quote. The architecture story behind each behavior is
in [`DESIGN.md`](./DESIGN.md).

## Repository tour

| Path                     | What lives here                                              |
| ------------------------ | ----------------------------------------------------------- |
| `data/loomwork.json`     | The fixture week — 13 raw items with baked-in contradictions |
| `drizzle/`               | Schema + migrations (7 tables, pgvector columns)            |
| `src/ingest/`            | Content-addressed ingestion of raw items                    |
| `src/extract/`           | LLM seam #1: typed-fact extraction + verbatim-quote gate    |
| `src/entities/`          | Entity resolution (4-step) + deterministic relations graph  |
| `src/signals/`           | Value-signature clustering + one-way promotion ladder       |
| `src/contradictions/`    | Pairwise contradiction detection (typed-value comparison)   |
| `src/answer/`            | Retrieval, gap detection, synthesis (LLM seam #2), citation gate |
| `src/research/`          | Tavily client + fold-findings-as-cited-facts                |
| `src/decisions/`         | Append-only decision log                                    |
| `src/mcp/`               | MCP server (stdio) + the seven tools                        |
| `src/cli/ask.ts`         | The ask → approve/reject CLI                                |

## Connecting to Claude Desktop

The `decision-brain` MCP server exposes the brain to any MCP client over stdio.
It offers seven tools: `ask` (cited brief + a pending decision), `log_decision`
(approve/reject, append-only), the read-only queries `query_facts`,
`query_entities`, `query_signals`, `get_contradictions`, and `ingest_items`
(the only write path into memory).

Add this to your `claude_desktop_config.json`, filling in the absolute paths and
keys for your machine:

```json
{
  "mcpServers": {
    "decision-brain": {
      "command": "/absolute/path/to/pnpm",
      "args": ["tsx", "src/mcp/server.ts"],
      "cwd": "/absolute/path/to/Decision Brain",
      "env": {
        "DATABASE_URL": "postgresql://USER@localhost:5432/decision_brain",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "OPENAI_API_KEY": "sk-...",
        "TAVILY_API_KEY": "tvly-..."
      }
    }
  }
}
```

- **Where this file lives** — on macOS, Claude Desktop loads it from
  `~/Library/Application Support/Claude/claude_desktop_config.json`. Create it if
  it doesn't exist, then fully restart Claude Desktop.
- **Tip** — find your pnpm path with `which pnpm`. If `tsx` isn't resolved, use
  `["exec", "tsx", "src/mcp/server.ts"]` as the `args`.

### Verifying the connection

Open Claude Desktop and look for the tools (🔌) icon in the message box. Under
**decision-brain** you should see all seven tools listed: `ask`, `log_decision`,
`query_facts`, `query_entities`, `query_signals`, `get_contradictions`, and
`ingest_items`.

To test the server without Claude Desktop, run it directly — `pnpm mcp` (alias of
`pnpm dev`) starts the same stdio server.

> All read-path tools are pure SQL. The two LLM seams (extraction + synthesis)
> live inside `ingest_items` and `ask` respectively.

## Tests

```bash
pnpm test        # 42 tests — mocked LLM + mocked Tavily, no live network calls
pnpm typecheck   # tsc --noEmit, strict
```

The suite covers the seams and gates that matter: extraction + verbatim-quote
verification, entity resolution, signal clustering + promotion thresholds,
contradiction rules, and the answer pipeline's retrieval / gap-detection /
citation-validation / append-only logging.

## Architecture

The long version is in [`DESIGN.md`](./DESIGN.md) — that's where I walk through
every call I made, deviations from the brief included. If you only read two
sections, read the one on signal aggregation (why I dropped pure embedding kNN
for value-signature grouping) and the one on why `research_facts = 0` is the
right answer and not a bug.

## Built for

I built this as a take-home for Builders Studio / VSI — thanks for a prompt that
was genuinely fun to build against.

## Web app (added after first review)

The first version was a CLI and an MCP server. The review asked for a frontend
with role-based access, so there's now a Next.js 14 app in `web/` that puts a UI
on the brain: a dashboard, an ingest form, an ask page, and a decisions queue. It
has its own hand-rolled auth — three demo users, a session in a cookie,
permissions by role — and it runs against the same database and the same brain
functions as everything else.

### Run it

```bash
pnpm install
pnpm db:migrate          # apply the schema, including the users/sessions tables
pnpm seed:users          # creates Maya, Devin, Priya
pnpm dev:web             # http://localhost:3000
```

### Demo accounts

```
role        email                       password
founder     maya@loomwork.local         demo
ops_lead    devin@loomwork.local        demo
analyst     priya@loomwork.local        demo
```

Passwords are `demo` because this is a local demo. It would not ship that way;
see [`DESIGN.md`](./DESIGN.md) §16 for what production auth would need.

### Who can do what

```
              ask    ingest   finalize_decision
  founder      ✓       ✓             ✓
  ops_lead     ✓       ✓             ✗
  analyst      ✓       ✗             ✗
```

The full reasoning is in `DESIGN.md` §16. The short version: anyone can ask, ops
leads can also ingest, and only the founder can finalize a decision — that last
rule lives in the data layer, not just the UI.

### Try it

1. Log in as `maya@loomwork.local` and ask something, like "What runway can I
   defend this week?". You get a cited brief, logged as pending.
2. Open the decisions queue. As Maya you see Approve and Reject. Approve it: a
   toast confirms, and the row moves to History with your email on it.
3. Sign out and log in as `devin@loomwork.local`. Same queue, no buttons — just
   an "Awaiting founder review" pill, because ops leads can't finalize.
4. Force the approve action anyway with a direct POST and the server refuses:
   `Role 'ops_lead' cannot finalize decisions — only 'founder' can.` The data
   layer doesn't care that the button was hidden.
5. Log in as `priya@loomwork.local` and open Ingest. Analysts get a read-only
   notice instead of the form.

### Theme

Dark by default, with a toggle in the header that persists to localStorage. Both
modes use the same palette.
