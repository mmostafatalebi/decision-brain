import type { ReactNode } from "react";
import type { Tone } from "@/lib/format";

export function Klabel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={`klabel ${className}`}>{children}</p>;
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-line bg-panel p-5 ${className}`}>
      {children}
    </div>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  em: "text-em",
  amber: "text-amber",
  rose: "text-rose",
  cyan: "text-cyan",
  muted: "text-tm",
};

export function Pill({
  tone = "muted",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-line bg-panel-2 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider ${TONE_TEXT[tone]}`}
    >
      {children}
    </span>
  );
}
