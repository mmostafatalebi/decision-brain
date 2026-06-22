import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { eq } from "drizzle-orm";
import { ask } from "../answer/index.js";
import { finalizeDecision } from "../decisions/log.js";
import { factsByIds } from "../answer/store.js";
import { db, pool } from "../db/client.js";
import { users } from "../../drizzle/schema.js";

/**
 * Minimal human-approval CLI. The brain recommends; the human approves or
 * rejects; the exchange lands in the append-only decision log. No UI deps.
 *
 *   pnpm cli ask "What runway can I defend this week?"
 *   pnpm cli ask --as=devin@loomwork.local "..."   # acts as a different user
 *
 * The acting user is who approves/rejects; only a founder can finalize (the
 * data-layer check in finalizeDecision enforces it).
 */

function parseQuestion(argv: string[]): string | null {
  const args = argv.slice(2);
  const rest = args[0] === "ask" ? args.slice(1) : args;
  // Drop the --as=<email> flag so it doesn't leak into the question text.
  const q = rest
    .filter((a) => !a.startsWith("--as="))
    .join(" ")
    .trim();
  return q.length > 0 ? q : null;
}

function short(s: string, n = 100): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function main(): Promise<void> {
  const question = parseQuestion(process.argv);
  if (!question) {
    console.error('Usage: pnpm cli ask [--as=<email>] "your question"');
    process.exit(2);
  }

  // Who's acting: --as=<email> flag, else env, else Maya.
  const asEmail =
    process.argv.find((a) => a.startsWith("--as="))?.split("=")[1] ??
    process.env.DECISION_BRAIN_USER ??
    "maya@loomwork.local";
  const userRows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, asEmail))
    .limit(1);
  const cliUser = userRows[0];
  if (!cliUser) {
    console.error(`User not found: ${asEmail}. Run 'pnpm seed:users' first.`);
    process.exit(1);
  }
  console.log(`Acting as: ${asEmail} (role: ${cliUser.role})`);

  console.log(`\n❓ ${question}\n`);
  console.log("Thinking (retrieve → gap-detect → research → synthesize)…\n");

  const { decision_id, brief } = await ask(question);

  // Resolve cited facts to source + quote for a readable provenance block.
  const cited = await factsByIds(brief.cited_fact_ids);
  const citeMap = new Map(cited.map((f) => [f.id, f]));

  console.log("─".repeat(72));
  console.log("ANSWER\n");
  console.log(brief.answer);
  console.log(`\nConfidence: ${(brief.confidence * 100).toFixed(0)}%`);

  if (brief.contradictions_noted.length > 0) {
    console.log("\nContradictions noted:");
    for (const c of brief.contradictions_noted) {
      console.log(`  • ${c.reconciliation}`);
      const a = citeMap.get(c.fact_a_id);
      const b = citeMap.get(c.fact_b_id);
      if (a) console.log(`      [${a.sourceRef}] "${short(a.verbatimQuote, 80)}"`);
      if (b) console.log(`      [${b.sourceRef}] "${short(b.verbatimQuote, 80)}"`);
    }
  }

  if (brief.open_gaps.length > 0) {
    console.log("\nOpen gaps:");
    for (const g of brief.open_gaps) console.log(`  • ${g}`);
  }

  console.log("\nCitations:");
  for (const id of brief.cited_fact_ids) {
    const f = citeMap.get(id);
    if (f) console.log(`  [F:${id.slice(0, 8)}…] ${f.sourceRef} — "${short(f.verbatimQuote, 90)}"`);
  }

  console.log(`\n👉 RECOMMENDATION: ${brief.recommendation}`);
  console.log("─".repeat(72));

  const rl = createInterface({ input: stdin, output: stdout });
  const choice = (await rl.question("\nApprove / Reject / Note? [a/r/n] "))
    .trim()
    .toLowerCase();

  let humanDecision: "approved" | "rejected" = "approved";
  let note: string | undefined;
  if (choice === "r") {
    humanDecision = "rejected";
  } else if (choice === "n") {
    note = (await rl.question("Note: ")).trim();
    const follow = (await rl.question("Approve or reject with this note? [a/r] "))
      .trim()
      .toLowerCase();
    humanDecision = follow === "r" ? "rejected" : "approved";
  }
  rl.close();

  try {
    await finalizeDecision(decision_id, humanDecision, cliUser.id, note);
    console.log(`\n✅ Decision logged (${humanDecision}). ID: ${decision_id}\n`);
  } catch (err) {
    // e.g. a non-founder trying to finalize — the data layer refuses. The brief
    // still exists as a pending decision; it just isn't finalized.
    console.error(`\n⛔ ${err instanceof Error ? err.message : String(err)}`);
    console.error(`   Decision ${decision_id} remains pending.\n`);
    process.exitCode = 1;
  }
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end();
    process.exit(1);
  });
