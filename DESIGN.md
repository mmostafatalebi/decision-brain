# Design Notes

Hey Michael — this is the part where I explain the *why*, not the *what*. The
README and the code show you how the thing works; this is me walking you through
the calls I made and the ones I went back and forth on. A few of them are
deviations from your brief, and I'd rather tell you about those up front than
have you find them and wonder if I noticed.

I've tried to keep each section to a couple of paragraphs. Read it in one sitting
and you'll know everything I'd tell you if we were looking at the repo together.

**Contents**

1. [Philosophy: LLMs at the seams, algorithms in the path](#1-philosophy-llms-at-the-seams-algorithms-in-the-path)
2. [The three-layer truth model](#2-the-three-layer-truth-model)
3. [Bi-temporal claims and supersession](#3-bi-temporal-claims-and-supersession)
4. [The two provenance gates](#4-the-two-provenance-gates)
5. [Entity resolution: 4-step, JS cosine over per-type pools](#5-entity-resolution-4-step-js-cosine-over-per-type-pools)
6. [Signal aggregation: value-signature grouping](#6-signal-aggregation-value-signature-grouping)
7. [Per-predicate consolidation rule](#7-per-predicate-consolidation-rule)
8. [Contradiction detection](#8-contradiction-detection)
9. [One-way promotion ladder](#9-one-way-promotion-ladder)
10. [Contradiction-aware gap suppression](#10-contradiction-aware-gap-suppression)
11. [`research_facts = 0` is the correct outcome](#11-research_facts--0-is-the-correct-outcome)
12. [Append-only decision log](#12-append-only-decision-log)
13. [What we deliberately did NOT use](#13-what-we-deliberately-did-not-use)
14. [Model choice and the determinism trick](#14-model-choice-and-the-determinism-trick)
15. [Known limitations / next iterations](#15-known-limitations--next-iterations)

---

## 1. Philosophy: LLMs at the seams, algorithms in the path

I put the model at exactly two spots — write-time extraction (one call per raw
item) and read-time synthesis (one call per question). Everything in between is
SQL and pure functions. That's not an aesthetic choice; it's so I can reproduce
any answer the brain gives by re-running deterministic steps. You can check me on
this: `completeJSON`, the only function that talks to an LLM, shows up in just two
read/write paths — `src/extract/` and `src/answer/synthesize.ts` — plus the
entity-resolution tiebreaker I'll get to in §5.

I built it this way for four reasons. The first is that I can throw away the
`signals`, `relations`, and `contradictions` tables, run `pnpm refresh`, and get
the exact same structures back — none of those steps lean on a model, so there's
nothing random to drift. The second is debugging: when a brief comes out wrong,
the bug is either in a fact (go read its verbatim quote) or in the synthesis
prompt. It's never buried in some opaque ranking model I can't inspect. Third is
cost — a question is one synthesis call plus a bounded number of research calls,
not a tree of agent reasoning that fans out until it feels done. And fourth is
the thing your prompt kept hammering: models are great at the fuzzy edges — prose
into typed facts, facts into a defensible brief — and bad, slow, and
non-reproducible at the stuff Postgres already nails, like joins and set
membership. So I gave the model the judgment calls and kept it out of the path.

## 2. The three-layer truth model

Memory is three layers, and each one answers a different question:

- **Learnings** (`facts`) — what was actually claimed, and how strongly? Typed
  facts: a predicate like `runway:months`, a structured value, an evidence tier
  (E1–E5), a confidence, and the verbatim quote it came from. This is the ground
  truth. Everything above it is derived.
- **Signals** (`signals`) — what's the aggregate picture, and how settled is it?
  Facts of the same type and value-signature cluster into a signal that climbs a
  ladder: `candidate → emerging → validated → decision_grade`. One call
  mentioning budget is a learning. Three calls across three accounts is a
  *validated* signal.
- **Decisions** (`decisions`) — what did the brain recommend, on what basis, and
  what did the human decide? A cited brief plus the approve/reject, appended for
  good.

I kept them separate because mashing them together loses information. Put signals
inside facts and you can't ask "is this settled?" without re-aggregating on every
read. Put decisions inside signals and you've thrown away the human's call. Each
layer is queryable on its own terms, and each one is derived purely from the
layer below — the only exception being decisions, which also have to capture the
one thing no algorithm produces: what Maya actually chose.

## 3. Bi-temporal claims and supersession

Every fact has two timestamps. `valid_at` is when the claim was true in the
world; `learned_at` is when I ingested it. They come apart all the time — Maya's
"May investor update" is `valid_at` June 2 but might get ingested weeks later, and
a board note often revises a number someone said on an earlier call. When a newer
fact supersedes an older one, I set `superseded_by` to the newer fact's UUID. I
never delete the old fact.

That buys three things. One, I can reconstruct what the brain knew at any past
moment just by filtering on `learned_at`. Two, contradiction detection over time
only works because facts keep their `valid_at` — the 60-day window in §8 is
meaningless otherwise. Three, a decision logged last week still cites fact UUIDs
that exist today, with their original quotes intact, so "why did the brain say
that?" gives the same answer now as it did then. If I deleted superseded facts,
the decision log would quietly start lying — citing things that no longer exist.

## 4. The two provenance gates

There are two gates, one per LLM seam, and neither one bends.

The write-time gate is the verbatim-quote verifier in `src/extract/verify.ts`.
Every extracted fact's `verbatim_quote` has to be a literal substring of the raw
item's body — exact whitespace, exact case, no fuzzy matching. If the model
paraphrased, condensed, or invented the quote, the fact gets dropped before it
ever hits the database. That's what stops the extractor from putting words in a
source's mouth.

The read-time gate is the citation validator in
`src/answer/validate-citations.ts`. Every `[F:uuid]` in a brief has to resolve to
a real row in `facts`; every UUID in `cited_fact_ids` has to actually appear
inline in the answer; every contradiction the brief notes has to point at a real
`contradictions` row. A made-up UUID gets one retry with the valid id set spelled
out in the prompt, and if it fails again I throw rather than hand back a brief I
can't verify. Between the two gates, a fact can't come from nowhere and a brief
can't cite a fact that doesn't exist — so the provenance holds the whole way
through, and I don't have to take the model's word for any of it.

## 5. Entity resolution: 4-step, JS cosine over per-type pools

`resolveEntity` runs four steps and stops at the first one that hits: normalize
the name (lowercase, strip punctuation, collapse whitespace), then exact/alias
match, then embedding similarity at cosine ≥ 0.85, then — only if more than one
candidate clears 0.85 — an LLM disambiguation call. The first three are
deterministic. The model is a genuine tiebreaker that fires only when two
candidates are actually ambiguous, and on this corpus it never had to fire,
because the extracted names came out clean.

Here's the deliberate deviation: the embedding step computes cosine **in
JavaScript over the small per-type candidate pool**, not with pgvector's `<=>`. I
did that because the pools are tiny — a handful of people, a handful of companies,
a handful of investors. Pulling the pool once and scoring it in a single
in-memory pass beats a `<=>` round-trip per candidate, and it has the nice side
effect of making the resolver a pure function over a data source I can mock, so I
can unit-test the four-step logic without a database. pgvector still does real
work — fact retrieval on the read path runs kNN over a much bigger table — I just
don't reach for the index when the table has eight rows in it. Use the index
where it pays; use a JS pass where it doesn't.

## 6. Signal aggregation: value-signature grouping

This is the deviation I'd most expect you to push on, so let me show my work. Your
brief said to cluster with embedding kNN at a 0.80 threshold, and predicted it'd
"naturally split runway facts by value." I built exactly that first. On the real
embeddings it did the opposite of what we both expected: the six `runway:months`
facts were similar enough to each other that they collapsed into a *single*
cluster — which then promoted straight to `decision_grade` on sheer volume and
buried the 18-vs-9 contradiction completely — while the ICP and budget facts came
in *under* 0.80 and shattered into singletons. I stared at it for a while. There's
no single threshold that's loose enough to merge "budget objection at Acme" with
"budget objection at Brightway" and also tight enough to keep "18 months" apart
from "9 months." The embeddings just don't separate the way the brief assumed they
would.

So I switched the cluster key. Instead of fuzzy distance, I group on
`(predicate-family, value-signature)`. `runway:months` splits on `(value,
conditional)`, so "18/unconditional", "9/conditional", and "18/conditional" land
as three separate signals. `icp:segment` splits on the segment value — enterprise
vs mid-market. Categorical types like budget objection and competitor collapse to
one signal per type, and the long tails (`pain:*`, `buying_signal:*`) coarsen to
family level so they don't blow up the signal count. The embedding is still
computed and stored as the signal centroid — it powers retrieval — it's just not
the thing I cluster on. The proof it's right: 14 clean signals where pure kNN gave
me one runway blob and a pile of singletons, and the 18-vs-9 tension survives as
two distinct signals instead of being averaged into mush. I kept the kNN
primitive (`clusterByEmbedding`, unit-tested) as the documented alternative, but
the production path uses the value key, because these are *typed* facts and the
structured value is a more honest cluster key than cosine distance ever was.

## 7. Per-predicate consolidation rule

The extraction prompt allows at most one `objection:budget_authority` fact per
item, but it lets `runway:months` produce several. That asymmetry is on purpose.
Delta-Logix voices the budget objection twice in the same call — "my hands are
tied, I'd need VP sign-off" and then "the budget authority isn't mine" — and
without the rule that becomes two facts, which inflates the budget count to four
and makes one account count double in the signal. Somebody saying the same thing
twice is still one objection.

Runway is the opposite situation. In the same board note, "~18 months at current
burn" (unconditional) and "closer to 9 months once we hire the two AEs"
(conditional) are genuinely two different facts about two different scenarios.
Squash them together and you've erased the exact tension Q3 is about. So the rule
has to be predicate-specific — fold repeated objections, keep distinct runway
figures — and I put it in the prompt rather than cleaning it up afterward, so the
model produces the right granularity at the source instead of me patching it
downstream.

## 8. Contradiction detection

Typed-value comparison, no model anywhere in it. For numeric predicates
(`runway:months`, `pricing:tier`), I call it a contradiction when the values
differ by more than ±20% *and* their `valid_at` timestamps fall within a 60-day
window. For categorical predicates (`icp:segment`, `competitor:name`,
`objection:*`), it's a different canonical value within 60 days. Before any of
that, I group facts by `(subject_id, predicate)` — only facts about the same
subject with the same predicate can contradict — which is the whole reason the
three budget objections (three different speakers) never get compared and never
throw a false positive.

Two details earned their lines of code. The first is conditional handling:
"18 unconditional" vs "18 conditional" is the *same number* under two framings —
complementary, not contradictory — so I skip it. But "18 unconditional" vs
"9 conditional" is a real contradiction, and the reason string names the condition
verbatim so the brief can quote it back. The second is the `tier_name` guard on
`pricing:tier`: a $99 Starter and a $4,500 Scale tier differ by way more than
20%, but they're different products, not competing claims — so pricing only
compares within the same `tier_name`. Drop that guard and the price ladder
invents three contradictions that aren't there.

## 9. One-way promotion ladder

Promotion only goes up. The case that makes this interesting is a signal that
already reached `decision_grade` back in Phase 5, before contradictions even
existed, and then picks up a contradiction among its facts later. I don't demote
it. I preserve it and have the orchestrator log a `preservedAgainstDemotion`
warning instead. A signal being evaluated for the *first* time with a
contradiction present gets capped at `validated` and can't climb to
`decision_grade` at all.

The reason is reproducibility. If I demoted retroactively, a signal's status would
depend on the *order* I happened to discover facts and contradictions in — run the
same data through twice and you could get two different answers. By keeping
promotion one-way and surfacing the tension as a logged warning (and, further
down, in the brief itself), status stays a clean function of the data plus a
monotonic rule, not of history. The contradiction still shows up where it
actually matters, which is the answer — it just doesn't get to corrupt the
ladder.

## 10. Contradiction-aware gap suppression

Gap detection is what decides whether to spend a Tavily call. The rule: I suppress
a gap — treat the corpus as already answering it — only when there are ≥3
high-tier facts on the topic *and* no contradiction among them. If the topic is
contradicted, the corpus isn't answering the question, it's arguing with itself,
so it's worth going outside for a sanity check even when there are plenty of
facts.

Honestly this is the part of the design that surprised me while I was building it,
and it's exactly why the three questions behave differently. Q3 (runway) has six
high-tier facts — but they contain the 18-vs-9 contradiction, so the gap stays
open and Tavily fires for a burn-rate benchmark. Q2 (budget objection) has three
high-tier facts across three calls that all agree — no contradiction, gap
suppressed, no research call burned. My first version keyed suppression on volume
("research when facts are thin"), and it would've skipped research on Q3 — the one
question that most needed an outside number. Tying it to *agreement* instead of
*count* is what fixed it.

## 11. `research_facts = 0` is the correct outcome

I want to flag this one rather than hide it, because at first glance it looks like
a bug. When the runway question fires research, Tavily comes back with generic SaaS
benchmark articles, I fold them into `raw_items` as `source_type = 'research'`, I
run the Phase 3 extraction pipeline over them — and I get **zero** typed facts out.
That's correct. The extraction prompt is tuned for claims *about Loomwork*, and the
verbatim-quote gate from §4 refuses to let a sentence like "Series A SaaS companies
typically burn $400k/mo" get attributed to Loomwork. The gate is doing its job —
it won't let a generic article pose as a first-party fact about the company.

The research still has provenance and still shapes the answer: the findings go into
the synthesis prompt as labeled, URL-attributed context, and the Q3 brief actually
uses the burn-multiple benchmark in its caveats. It just doesn't dump off-subject
claims into the typed-fact memory. I thought about adding a research-specific
extraction prompt with generic-subject predicates, but that would water down the
Loomwork vocabulary and smear the line between "what we know about Maya's company"
and "what the internet says about SaaS in general." Keeping research as cited
context instead of forged facts was the more careful call, and it's the kind of
constraint I'd rather you hear from me than discover yourself.

## 12. Append-only decision log

The `decisions` table has one way to change a row:
`finalizePending(UPDATE decisions SET human_decision = … WHERE id = … AND
human_decision IS NULL)`. There's no general update function — I never wrote one,
so there's literally no other UPDATE statement that touches this table, and the
`finalizeDecision` signature only accepts the human's call plus an optional note,
so the type system won't even let you pass anything else. A decision finalizes
exactly once; run the finalize again and it matches zero rows and throws.

What you get out of that is a single row that explains itself: the question, the
exact `facts_used` (cited UUIDs), the `signals_used`, the `research_refs` (URLs,
queries, retrieval timestamps), the recommendation, the confidence, the open gaps,
and the human's approve/reject with an optional note — all timestamped at both
`created_at` and `decided_at`. A week later, that row plus the facts it cites
(which I never delete) reconstructs the whole decision. No event sourcing, no log
aggregation. One row, the complete story.

## 13. What we deliberately did NOT use

- **No LangChain / LangGraph / Vercel AI SDK.** They tuck control flow behind
  abstractions. Every LLM call in here is one named function with a typed input
  and a Zod-validated typed output — I can point at both seams, they're not hiding
  inside a chain.
- **No Pinecone / Weaviate / Qdrant / Chroma / Faiss.** pgvector is plenty at this
  size, and keeping the vectors in the same database as the facts means the
  retrieval joins (fact → source → signal → contradiction) are just joins instead
  of a dance across two stores.
- **No Express / Fastify / Hono / Next.js.** MCP-over-stdio is the protocol. An
  HTTP server would drag in auth, CORS, and lifecycle concerns you never asked
  for.
- **No Redis.** Nothing to cache — the read path is plain SQL and quick on cold
  reads. A cache here would be solving a problem I don't have.
- **No Docker for the deliverable.** `pnpm install && pnpm db:migrate && pnpm
  refresh` runs on any Node 20+ box with Postgres + pgvector. It's a few commands,
  not a container build.

## 14. Model choice and the determinism trick

I default to `claude-opus-4-8`, and you can override it with `ANTHROPIC_MODEL`. The
brief is the thing you'll read most carefully, and on a three-question demo the
synthesis quality matters more to me than shaving a few cents per call — so I went
with the strongest model, not the cheapest. Embeddings are OpenAI
`text-embedding-3-small` (1536-dim), and OpenAI is also the fallback provider
behind the `LLM_PROVIDER` switch.

One wrinkle worth calling out: the current Anthropic models reject `temperature`
and `top_p` — they 400 if you send them. So the way I get deterministic structured
output is **forced tool-use**. Extraction and synthesis each define one
`emit_result` tool whose JSON Schema *is* the shape I want back, and `tool_choice`
forces the model to fill it. It can only answer by populating that schema, which is
both steadier than free-form JSON and the reason I never needed a temperature knob
in the first place. `zod-to-json-schema` bridges my Zod schemas — which are the one
source of truth for every seam's shape — into Anthropic's `input_schema` format, so
the validation contract and the tool contract come from the same definition.

## 15. Known limitations / next iterations

- **Research is cited context, not folded facts** (§11). A research-specific
  extraction path with its own vocabulary ("market", "competitor-set") would let
  external benchmarks become real, queryable facts without diluting the Loomwork
  vocabulary — but it's a second prompt to maintain, and I didn't think the demo
  needed it.
- **The tolerance bands are tuned to this corpus.** The ±20% numeric tolerance, the
  60-day window, the 2/4/6-fact promotion thresholds — those are picked for a
  13-item week. In production you'd tune them per predicate from real
  distributions. The thing I care about architecturally is that they're
  deterministic and per-predicate, not the specific numbers.
- **`pain:*` / `buying_signal:*` coarsen to family signals** to keep the count
  readable. At scale, per-topic signals with their own promotion state would carry
  more information; the family rollup is a small-corpus shortcut and I'd revisit it
  with more data.
- **Single tenant.** Cross-venture projection was out of scope, so the schema is
  single-venture (Loomwork) on purpose. If I had another week, multi-tenant
  projection is the first thing I'd reach for.

## 16. Web app and role-based access (added after first review)

I sent the first version — the brain, the CLI, the MCP server — and the main
thing that came back was: add a frontend with role-based access, and enforce the
roles through the stack rather than hiding them in the UI. That last part is the
whole ask. Anyone can gray out a button. The question is what happens when
someone gets past it.

So "through the stack" meant two things to me. The API surface checks permission
before it does anything. And the function that actually writes the decision
checks again, on its own, reading the role straight from the database. The second
check is the one that counts, because it doesn't trust the caller.

The action lives in `web/app/(authed)/decisions/actions.ts`. Before it touches
anything it calls `requirePermission("finalize_decision")`, which pulls the
current session's user and throws if their role isn't allowed. That's the
surface. But `finalizeDecision` in `src/decisions/log.ts` takes a `user_id` and
does its own lookup, `SELECT role FROM users WHERE id = user_id`, and refuses if
the role isn't `founder`:

> Role 'ops_lead' cannot finalize decisions — only 'founder' can. This check runs
> in the data layer, not just at the API surface.

A script that imports `finalizeDecision` directly gets that message. A direct MCP
call gets it. A misconfigured client that skips the route guard gets it. The
route check is there so the UI can fail fast and show something clean; the
data-layer check is the actual contract. I tested it for real: Devin's session
forcing a POST to the approve action comes back 500 and the decision stays
pending, while Maya's goes through and writes her email into the audit row.

Ingest is gated at the API surface but `ingestRawItem` itself has no role check,
and that's on purpose. The protection on ingest isn't the role, it's the
verbatim-quote verifier from Phase 3. Every extracted fact has to quote a literal
substring of the source or it gets dropped before it reaches the facts table. So
even if an analyst found a way to call ingest, they couldn't put a fabricated
fact into typed memory; the worst they could do is add a raw item that produces
zero facts. Approve and reject are a different kind of action. There the role is
the safety check, because the output is a permanent row that says a specific
person signed off. That's the one place where who is calling matters, so that's
the one place the data layer enforces it.

The matrix as it shipped:

```
              ask    ingest   finalize_decision
  founder      ✓       ✓             ✓
  ops_lead     ✓       ✓             ✗
  analyst      ✓       ✗             ✗
```

Everyone who can log in can ask, because asking is a read that produces a
recommendation and changes nothing. Ops leads can also feed the memory, since the
verbatim gate keeps that honest. Only the founder can finalize, because that's
Maya's call and the audit row carries her name.

That audit lives in one column. `decisions.finalized_by_user_id` is a UUID with a
foreign key to `users.id`. It's nullable, on purpose: the decisions from before
the auth work existed don't have a finalizer, and I didn't want to backfill fake
data into them. New finalizations record the user, so "who signed off on this" is
one join, `decisions` to `users` on that column, and you get the email next to
the question and the timestamp.

The first version had no HTTP surface. It ran as a CLI and an MCP server over
stdio. The web app is Next.js 14 living in `web/`, a sibling to `src/`, and the
part I cared about most is what it left alone. Nothing in `src/answer/`,
`src/extract/`, `src/entities/`, `src/signals/`, `src/contradictions/`,
`src/research/`, or `src/llm/` changed. The brain still reads and writes the same
Postgres-with-pgvector it always did. The web layer calls the existing functions
— `ask`, `ingestRawItem`, `finalizeDecision` — and adds its own two tables,
`users` and `sessions`. One repo, one database, one thing to deploy. The brain
files that did change were narrow. `src/decisions/log.ts` gained the role check
inside `finalizeDecision` — a non-founder caller bounces at the data layer.
`src/decisions/store.ts` picked up a handful of read-only queries for the
dashboard and the queue, no new writes. `src/mcp/server.ts` and `src/cli/ask.ts`
grew small bits so the MCP server and the CLI can pass a user identity through.
Nothing else in `src/` moved.

One mapping is worth spelling out so the doc and the screen agree. Facts carry an
`evidence_tier`, E1 through E5. The promotion ladder — candidate, emerging,
validated, decision_grade — belongs to signals, not facts. But the UI draws the
ladder on each cited fact, because "how strong is this evidence" is what someone
reading a brief wants to see, and the ladder is the vocabulary the rest of the
system already speaks. The mapping is in `web/lib/format.ts`, `tierToLadder`: E5
shows as decision_grade, E4 as validated, E3 as emerging, E1 and E2 as candidate.
It's a display choice, not a change to the model. A fact's tier is still its tier
in the database; the ladder is how that tier gets drawn.

This is built for the brief, not for an org's Monday morning. If it were going
live, here's what I'd do next, roughly in order:

- Replace bcrypt-on-Postgres with SSO through an identity provider. Hand-rolled
  login is fine for three demo accounts; it's not how a real company manages who
  Maya is.
- Make it invite-only. There's no self-registration now, and there shouldn't be —
  a founder adds people, not a signup form.
- Add refresh tokens and an idle timeout. Sessions are a flat seven days; a real
  one expires sooner and renews on activity.
- Add a password reset path. Today there's no recovery: lose the password, lose
  the account.
- Rate-limit login and ask. Login for the usual reasons, ask because every call
  spends LLM tokens and a tight loop gets expensive fast.
- Make it multi-tenant. The schema is single-venture; real use means isolating
  Loomwork's data from the next company's.
- Harden the audit trail. The decisions table is append-only at the row level,
  which is good, but a hash chain over the rows would make tampering detectable
  rather than just discouraged.
- Replace `console.error` with structured logging and correlation IDs, so a
  question can be traced from the HTTP request through the brain to the decision
  row.
- Validate input with a schema library instead of by hand. The Server Actions
  parse FormData manually; Zod at the boundary would be tighter.

None of these are hard. They're just not what the brief asked for, and I'd rather
ship the thing it asked for and know exactly what's missing.
