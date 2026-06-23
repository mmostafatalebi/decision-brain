"use client";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { askQuestion } from "./actions";
import { Card, Klabel, Pill } from "@/components/ui";
import { confidenceTone, tierTone } from "@/lib/format";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-em-deep px-4 py-2.5 font-medium text-[#06120d] transition hover:bg-em disabled:opacity-60"
    >
      {pending ? "Thinking (retrieve → gap-detect → research → synthesize)…" : "Generate brief"}
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
          className="w-full rounded-md border border-line bg-panel px-4 py-3 font-display text-lg italic text-tp outline-none placeholder:text-tg focus:border-em"
        />
        <SubmitButton />
      </form>

      {state && !state.ok ? (
        <Card className="border-rose">
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
            <p className="font-display text-2xl leading-snug text-tp">
              {state.recommendation}
            </p>
          </div>

          <div>
            <Klabel className="mb-3">
              cited facts · {state.facts.length}
            </Klabel>
            <div className="space-y-2">
              {state.facts.map((f) => (
                <Card key={f.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Pill tone={tierTone(f.tier)}>E{f.tier}</Pill>
                    <Pill tone="muted">{f.predicate}</Pill>
                    <span className="ml-auto font-mono text-xs text-tm">
                      {f.sourceRef}
                    </span>
                  </div>
                  <p className="rounded-md bg-panel-2 px-3 py-2 font-mono text-xs text-ts">
                    &ldquo;{f.quote}&rdquo;
                  </p>
                </Card>
              ))}
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
                    className="block rounded-md border border-line bg-panel px-3 py-2 text-sm text-cyan transition hover:border-line-2"
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

          <Card className="border-amber">
            <p className="text-sm text-ts">
              This recommendation is logged as{" "}
              <span className="font-semibold text-amber">pending</span>. A founder
              approves or rejects it in{" "}
              <Link href="/decisions" className="text-em underline">
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
