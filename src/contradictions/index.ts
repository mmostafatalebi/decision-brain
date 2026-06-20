import { pathToFileURL } from "node:url";
import { pool } from "../db/client.js";
import { detectContradictions } from "./detect.js";
import { promoteSignals } from "../signals/promote.js";

/**
 * Detect contradictions, then re-run promotion so the decision_grade gate is
 * informed by the new contradiction surface. Pure path — no LLM.
 */
async function main(): Promise<void> {
  const detect = await detectContradictions();
  console.log("detectContradictions summary:", detect);

  const promo = await promoteSignals();
  console.log("\nre-promotion after contradictions:", {
    signalsEvaluated: promo.signalsEvaluated,
    promotions: promo.promotions.length,
    preservedAgainstDemotion: promo.preservedAgainstDemotion.length,
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
