"use client";
import { useFormState, useFormStatus } from "react-dom";
import { submitItem } from "./actions";
import { Card, Klabel, Pill } from "@/components/ui";
import { Ladder } from "@/components/ladder";
import { tierToLadder } from "@/lib/format";

const SOURCE_TYPES = [
  "email",
  "call_transcript",
  "board_note",
  "tweet",
  "pricing_doc",
  "investor_update",
  "other",
];

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-em focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
const INPUT = `w-full rounded-md border border-line bg-panel px-3 py-2.5 text-tp outline-none transition-colors placeholder:text-tg focus:border-em ${FOCUS}`;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md bg-em-deep px-4 py-2.5 font-medium text-[#06120d] transition-colors hover:bg-em disabled:opacity-60 ${FOCUS}`}
    >
      {pending ? "Extracting…" : "Ingest"}
    </button>
  );
}

const today = new Date().toISOString().slice(0, 10);

export function IngestForm() {
  const [state, formAction] = useFormState(submitItem, null);

  return (
    <div className="space-y-8">
      <form action={formAction} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Source type">
            <select name="source_type" defaultValue="email" className={INPUT}>
              {SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source id">
            <input
              name="source_id"
              required
              placeholder="e.g. acme-call-2026-06-20"
              className={INPUT}
            />
          </Field>
          <Field label="Source url (optional)">
            <input name="source_url" placeholder="https://…" className={INPUT} />
          </Field>
          <Field label="Valid at">
            <input
              type="date"
              name="valid_at"
              defaultValue={today}
              className={INPUT}
            />
          </Field>
        </div>

        <Field label="Content (paste the raw artifact)">
          <textarea
            name="content"
            required
            rows={12}
            placeholder="Paste the email body, call transcript, board note…"
            className={`w-full rounded-md border border-line bg-panel-2 px-3 py-2.5 font-mono text-sm text-tp outline-none transition-colors placeholder:text-tg focus:border-em ${FOCUS}`}
          />
        </Field>

        <SubmitButton />
      </form>

      {state && !state.ok ? (
        <Card className="border-l-2 border-l-rose">
          <Klabel className="mb-1">error</Klabel>
          <p className="text-sm text-rose">{state.error}</p>
        </Card>
      ) : null}

      {state && state.ok ? (
        <div className="space-y-4">
          <Klabel>result</Klabel>
          <div className="flex flex-wrap gap-2">
            <Pill tone="em">{state.factsExtracted} facts extracted</Pill>
            <Pill tone="cyan">{state.signalsTouched} signals touched</Pill>
            <Pill tone={state.itemsSkipped > 0 ? "amber" : "muted"}>
              {state.itemsSkipped} skipped
            </Pill>
          </div>

          {state.facts.length > 0 ? (
            <div className="space-y-2">
              {state.facts.map((f, i) => {
                const ladder = tierToLadder(f.tier);
                return (
                  <Card key={i} className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Ladder position={ladder.position} label={ladder.label} />
                      <Pill tone="muted">{f.predicate}</Pill>
                    </div>
                    <p className="rounded-md bg-panel-2 px-3 py-2 font-mono text-xs text-ts">
                      &ldquo;{f.quote}&rdquo;
                    </p>
                  </Card>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-tm">
              No typed facts cleared the verbatim-quote gate for this item.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="klabel block">{label}</label>
      {children}
    </div>
  );
}
