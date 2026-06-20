import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ask } from "../answer/index.js";
import { finalizeDecision } from "../decisions/log.js";
import { factsByIds } from "../answer/store.js";
import { pool } from "../db/client.js";

/**
 * Minimal human-approval CLI. The brain recommends; the human approves or
 * rejects; the exchange lands in the append-only decision log. No UI deps.
 *
 *   pnpm cli ask "What runway can I defend this week?"
 */

function parseQuestion(argv: string[]): string | null {
  const args = argv.slice(2);
  const rest = args[0] === "ask" ? args.slice(1) : args;
  const q = rest.join(" ").trim();
  return q.length > 0 ? q : null;
}

function short(s: string, n = 100): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function main(): Promise<void> {
  const question = parseQuestion(process.argv);
  if (!question) {
    console.error('Usage: pnpm cli ask "your question"');
    process.exit(2);
  }

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

  await finalizeDecision(decision_id, humanDecision, note);
  console.log(`\n✅ Decision logged (${humanDecision}). ID: ${decision_id}\n`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
