export type Tone = "em" | "amber" | "rose" | "cyan" | "muted";

export function relativeTime(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function confidenceTone(c: number): Tone {
  if (c >= 0.7) return "em";
  if (c >= 0.4) return "amber";
  return "rose";
}

export function tierTone(tier: number): Tone {
  if (tier >= 4) return "em";
  if (tier === 3) return "cyan";
  if (tier === 2) return "amber";
  return "muted";
}

export function decisionTone(status: string | null): Tone {
  if (status === "approved") return "em";
  if (status === "rejected") return "rose";
  return "amber";
}

export function roleLabel(role: string): string {
  return role.replace("_", " ");
}

/**
 * Map a fact's evidence tier (E1–E5) onto the promotion-ladder vocabulary, so a
 * cited fact's evidence strength reads as a position on the same ladder the
 * architecture describes (candidate → emerging → validated → decision_grade).
 */
export function tierToLadder(tier: number): {
  position: number;
  label: string;
} {
  if (tier >= 5) return { position: 3, label: "decision_grade" };
  if (tier === 4) return { position: 2, label: "validated" };
  if (tier === 3) return { position: 1, label: "emerging" };
  return { position: 0, label: "candidate" };
}
