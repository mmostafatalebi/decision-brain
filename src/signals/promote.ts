import {
  listSignals,
  signalIdsWithUnresolvedContradictions,
  signalSourceMetrics,
  updateSignalStatus,
} from "./store.js";

/**
 * The promotion ladder: candidate → emerging → validated → decision_grade.
 * Deterministic, threshold-based, and ONE-WAY — a signal never demotes and
 * never skips a rung's timestamp. Pure path: NO LLM.
 */

export const RUNGS = [
  "candidate",
  "emerging",
  "validated",
  "decision_grade",
] as const;
export type Rung = (typeof RUNGS)[number];

const RECENCY_DAYS = 60;
const RECENCY_MS = RECENCY_DAYS * 24 * 60 * 60 * 1000;

function rungIndex(status: string): number {
  const i = (RUNGS as readonly string[]).indexOf(status);
  return i < 0 ? 0 : i;
}

export interface PromotionMetrics {
  evidenceCount: number;
  lastSeenAt: Date;
  distinctSources: number;
  maxTier: number;
  /** Phase 6 gate: a signal with an unresolved contradiction can't reach decision_grade. */
  hasContradiction: boolean;
  now: Date;
}

/** Highest rung this signal qualifies for, gated so no rung is skipped. */
export function eligibleRungIndex(m: PromotionMetrics): number {
  const recent = m.now.getTime() - m.lastSeenAt.getTime() <= RECENCY_MS;
  let rung = 0; // candidate
  if (m.evidenceCount >= 2 && recent) rung = 1; // emerging
  if (rung >= 1 && m.evidenceCount >= 4 && m.distinctSources >= 2 && m.maxTier >= 3) {
    rung = 2; // validated
  }
  if (
    rung >= 2 &&
    m.evidenceCount >= 6 &&
    m.distinctSources >= 3 &&
    m.maxTier >= 4 &&
    !m.hasContradiction // Phase 6 gate
  ) {
    rung = 3; // decision_grade
  }
  return rung;
}

export interface PromoteSummary {
  signalsEvaluated: number;
  promotions: { signal_id: string; from: string; to: string }[];
  /** Signals already at decision_grade that now carry a contradiction (logged, NOT demoted). */
  preservedAgainstDemotion: string[];
}

export async function promoteSignals(): Promise<PromoteSummary> {
  const sigs = await listSignals();
  const metrics = await signalSourceMetrics();
  const contradicted = new Set(await signalIdsWithUnresolvedContradictions());
  const metricMap = new Map(metrics.map((m) => [m.signalId, m]));
  const now = new Date();

  const promotions: PromoteSummary["promotions"] = [];
  const preservedAgainstDemotion: string[] = [];

  for (const s of sigs) {
    const m = metricMap.get(s.id) ?? { distinctSources: 0, maxTier: 0 };
    const hasContradiction = contradicted.has(s.id);
    const eligible = eligibleRungIndex({
      evidenceCount: s.evidenceCount,
      lastSeenAt: s.lastSeenAt,
      distinctSources: m.distinctSources,
      maxTier: m.maxTier,
      hasContradiction,
      now,
    });

    const current = rungIndex(s.status);
    const final = Math.max(current, eligible); // one-way: never below current

    // Already decision_grade but now contradicted → preserve (one-way), just log.
    if (s.status === "decision_grade" && hasContradiction) {
      preservedAgainstDemotion.push(s.id);
    }

    if (final > current) {
      const promotedAt = { ...s.promotedAt };
      for (let r = current + 1; r <= final; r++) {
        const rung = RUNGS[r]!;
        if (!promotedAt[rung]) promotedAt[rung] = now.toISOString();
      }
      await updateSignalStatus(s.id, RUNGS[final]!, promotedAt);
      promotions.push({ signal_id: s.id, from: s.status, to: RUNGS[final]! });
    }
  }

  return { signalsEvaluated: sigs.length, promotions, preservedAgainstDemotion };
}
