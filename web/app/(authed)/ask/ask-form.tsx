"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { askQuestion } from "./actions";
import { Card, Klabel, Pill } from "@/components/ui";
import { Ladder } from "@/components/ladder";
import { confidenceTone, tierToLadder } from "@/lib/format";

const STEPS = [
  "retrieving facts",
  "checking for gaps",
  "researching",
  "synthesizing",
  "validating citations",
];

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-em focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

function StepCycler() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    // We don't stream real pipeline state; cycle through the five stages over
    // ~20s. Honest theater — these are the actual pipeline stages.
    const id = setInterval(
      () => setStep((s) => Math.min(s + 1, STEPS.length - 1)),
      4000,
    );
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-1.5 rounded-md border border-line bg-panel-2 px-4 py-3">
      {STEPS.map((label, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                active
                  ? "animate-pulse bg-em"
                  : done
                    ? "bg-em-deep"
                    : "bg-line-2"
              }`}
            />
            <span
              className={`font-mono text-xs uppercase tracking-wider ${
                active ? "text-em" : done ? "text-ts" : "text-tm"
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FormFooter() {
  const { pending } = useFormStatus();
  if (pending) return <StepCycler />;
  return (
    <button
      type="submit"
      className={`rounded-md bg-em-deep px-4 py-2.5 font-medium text-[#06120d] transition-colors hover:bg-em ${FOCUS}`}
    >
      Generate brief
    </button>
  );
}

export function AskForm() {
  const [state, formAction] = useFormState(askQuestion, null);

  return (
    <div className="space-y-8">
      <form action={formAction} className="space-y-4">
        <textarea
          name="question"
          required
          rows={3}
          placeholder="What runway can I defend in this week's investor update?"
          className={`w-full rounded-md border border-line bg-panel px-4 py-3 font-display text-lg italic text-tp outline-none transition-colors placeholder:text-tg focus:border-em ${FOCUS}`}
        />
        <FormFooter />
      </form>

      {state && !state.ok ? (
        <Card className="border-l-2 border-l-rose">
          <p className="text-sm text-rose">{state.error}</p>
        </Card>
      ) : null}

      {state && state.ok ? (
        <div className="space-y-7">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <Klabel>recommendation</Klabel>
              <Pill tone={confidenceTone(state.confidence)}>
                {Math.round(state.confidence * 100)}% confidence
              </Pill>
            </div>
            <Card>
              <p className="font-display text-2xl leading-snug text-tp">
                {state.recommendation}
              </p>
            </Card>
          </div>

          <div>
            <Klabel className="mb-3">cited facts · {state.facts.length}</Klabel>
            <div className="space-y-2">
              {state.facts.map((f) => {
                const ladder = tierToLadder(f.tier);
                return (
                  <Card key={f.id} className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Ladder position={ladder.position} label={ladder.label} />
                      <Pill tone="muted">{f.predicate}</Pill>
                      <span className="ml-auto font-mono text-xs text-tm">
                        {f.sourceRef}
                      </span>
                    </div>
                    <p className="rounded-md bg-panel-2 px-3 py-2 font-mono text-xs text-ts">
                      &ldquo;{f.quote}&rdquo;
                    </p>
                  </Card>
                );
              })}
            </div>
          </div>

          <div>
            <Klabel className="mb-3">research used</Klabel>
            {state.research.length === 0 ? (
              <p className="text-sm text-tm">
                No external research needed — the corpus answered.
              </p>
            ) : (
              <div className="space-y-1.5">
                {state.research.map((r, i) => (
                  <a
                    key={i}
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`block rounded-md border border-line bg-panel px-3 py-2 text-sm text-cyan transition-colors hover:border-line-2 ${FOCUS}`}
                  >
                    <span className="text-tp">{r.title}</span>
                    <span className="ml-2 font-mono text-xs text-tm">
                      ({r.query})
                    </span>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div>
            <Klabel className="mb-3">open gaps</Klabel>
            {state.openGaps.length === 0 ? (
              <p className="text-sm text-tm">None.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5 text-sm text-ts">
                {state.openGaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            )}
          </div>

          <Card className="border-l-2 border-l-amber">
            <p className="text-sm text-ts">
              This recommendation is logged as{" "}
              <span className="font-semibold text-amber">pending</span>. A founder
              approves or rejects it in{" "}
              <Link
                href="/decisions"
                className={`rounded text-em underline ${FOCUS}`}
              >
                decisions
              </Link>
              .
            </p>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
