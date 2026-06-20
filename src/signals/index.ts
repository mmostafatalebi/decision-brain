import { pathToFileURL } from "node:url";
import { pool } from "../db/client.js";
import { aggregateSignals } from "./cluster.js";
import { promoteSignals } from "./promote.js";

/** Orchestrate signal aggregation, then promotion. Pure path — no LLM. */
async function main(): Promise<void> {
  const agg = await aggregateSignals();
  console.log("aggregateSignals summary:", agg);

  const promo = await promoteSignals();
  console.log("\npromoteSignals summary:", {
    signalsEvaluated: promo.signalsEvaluated,
    promotions: promo.promotions.length,
  });
  for (const p of promo.promotions) {
    console.log(`  ${p.signal_id.slice(0, 8)}… ${p.from} → ${p.to}`);
  }
  if (promo.preservedAgainstDemotion.length > 0) {
    console.warn(
      `\n${promo.preservedAgainstDemotion.length} decision_grade signal(s) carry a contradiction — preserved, not demoted (one-way invariant).`,
    );
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main()
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
