import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getFactsLite,
  listHistoryDecisions,
  listPendingDecisions,
  type DecisionFactLite,
  type DecisionListRow,
} from "@/lib/brain";
import { Card, Klabel, Pill } from "@/components/ui";
import { Ladder } from "@/components/ladder";
import { Toast } from "@/components/toast";
import {
  confidenceTone,
  decisionTone,
  relativeTime,
  tierToLadder,
  truncate,
} from "@/lib/format";
import { approveDecision, rejectDecision } from "./actions";

type ResearchRef = { url?: string; title?: string; query?: string };

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-em focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export default async function DecisionsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const user = await getCurrentUser();
  const isFounder = user?.role === "founder";
  const tab = searchParams.tab === "history" ? "history" : "pending";

  const rows =
    tab === "history"
      ? await listHistoryDecisions(50)
      : await listPendingDecisions();

  const allFactIds = [...new Set(rows.flatMap((d) => d.factsUsed))];
  const factList = await getFactsLite(allFactIds);
  const factMap = new Map(factList.map((f) => [f.id, f]));

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <Toast />
      </Suspense>

      <div>
        <Klabel className="mb-3">review queue</Klabel>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Decisions.
        </h1>
      </div>

      <div className="flex gap-1 border-b border-line">
        <Tab href="/decisions?tab=pending" active={tab === "pending"}>
          Pending
        </Tab>
        <Tab href="/decisions?tab=history" active={tab === "history"}>
          History
        </Tab>
      </div>

      {rows.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-3">
          {rows.map((d) => (
            <DecisionRow
              key={d.id}
              d={d}
              facts={d.factsUsed
                .map((id) => factMap.get(id))
                .filter((f): f is DecisionFactLite => f !== undefined)}
              isFounder={isFounder}
              tab={tab}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ tab }: { tab: "pending" | "history" }) {
  if (tab === "history") {
    return (
      <Card>
        <Klabel className="mb-2">no history</Klabel>
        <p className="text-ts">
          Approved and rejected decisions show up here.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <Klabel className="mb-2">queue is clear</Klabel>
      <p className="font-display text-2xl text-tp">Nothing pending.</p>
      <p className="mt-2 text-sm text-tm">
        <Link href="/ask" className={`rounded text-em underline ${FOCUS}`}>
          Ask a question
        </Link>{" "}
        to generate a brief.
      </p>
    </Card>
  );
}

function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px rounded-t border-b-2 px-4 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${FOCUS} ${
        active ? "border-em text-tp" : "border-transparent text-ts hover:text-tp"
      }`}
    >
      {children}
    </Link>
  );
}

function DecisionRow({
  d,
  facts,
  isFounder,
  tab,
}: {
  d: DecisionListRow;
  facts: DecisionFactLite[];
  isFounder: boolean;
  tab: "pending" | "history";
}) {
  const research = (d.researchRefs as ResearchRef[]) ?? [];

  return (
    <Card className="p-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-4 rounded-lg px-5 py-4 transition-colors hover:bg-panel-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg text-tp">
              {d.question}
            </p>
            <p className="mt-0.5 truncate text-sm text-ts">
              {truncate(d.recommendation, 90)}
            </p>
          </div>
          {tab === "history" ? (
            <Pill tone={decisionTone(d.humanDecision)}>
              {d.humanDecision ?? "—"}
            </Pill>
          ) : (
            <Pill tone={confidenceTone(d.confidence)}>
              {Math.round(d.confidence * 100)}%
            </Pill>
          )}
          <span className="hidden w-44 text-right font-mono text-xs text-tm sm:block">
            {facts.length} facts · {research.length} research
          </span>
        </summary>

        <div className="space-y-5 border-t border-line px-5 py-5">
          <div>
            <Klabel className="mb-2">recommendation</Klabel>
            <p className="text-ts">{d.recommendation}</p>
          </div>

          {facts.length > 0 ? (
            <div>
              <Klabel className="mb-2">cited facts</Klabel>
              <div className="space-y-2">
                {facts.map((f) => {
                  const ladder = tierToLadder(f.evidenceTier);
                  return (
                    <div
                      key={f.id}
                      className="rounded-md border border-line bg-panel-2 p-3"
                    >
                      <div className="mb-1.5 flex items-center gap-3">
                        <Ladder
                          position={ladder.position}
                          label={ladder.label}
                        />
                        <Pill tone="muted">{f.predicate}</Pill>
                        <span className="ml-auto font-mono text-xs text-tm">
                          {f.sourceRef}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-ts">
                        &ldquo;{f.verbatimQuote}&rdquo;
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {d.openGaps.length > 0 ? (
            <div>
              <Klabel className="mb-2">open gaps</Klabel>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ts">
                {d.openGaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {tab === "history" ? (
            <p className="font-mono text-xs text-tm">
              {d.humanDecision} by {d.finalizedByEmail ?? "—"} ·{" "}
              {relativeTime(d.decidedAt)}
              {d.humanNote ? ` · "${d.humanNote}"` : ""}
            </p>
          ) : isFounder ? (
            <form className="flex items-center gap-2 pt-1">
              <input type="hidden" name="decision_id" value={d.id} />
              <input
                name="note"
                placeholder="note (optional)"
                className={`flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-tp outline-none transition-colors placeholder:text-tg focus:border-em ${FOCUS}`}
              />
              <button
                formAction={approveDecision}
                className={`rounded-md bg-em-deep px-4 py-2 text-sm font-medium text-[#06120d] transition-colors hover:bg-em ${FOCUS}`}
              >
                Approve
              </button>
              <button
                formAction={rejectDecision}
                className={`rounded-md border border-rose px-4 py-2 text-sm font-medium text-rose transition-colors hover:bg-panel-2 ${FOCUS}`}
              >
                Reject
              </button>
            </form>
          ) : (
            <Pill tone="amber">Awaiting founder review</Pill>
          )}
        </div>
      </details>
    </Card>
  );
}
