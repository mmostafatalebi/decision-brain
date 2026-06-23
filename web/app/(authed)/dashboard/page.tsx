import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { countDecisions, listRecentDecisions } from "@/lib/brain";
import { Card, Klabel, Pill } from "@/components/ui";
import { decisionTone, relativeTime, truncate } from "@/lib/format";

export default async function DashboardPage() {
  // The layout already guaranteed a user; this is just to greet them.
  const user = await getCurrentUser();
  const firstName = user?.name.split(" ")[0] ?? "there";
  const canIngest = user ? hasPermission(user.role, "ingest") : false;

  const [pending, approved, rejected, recent] = await Promise.all([
    countDecisions({ status: "pending" }),
    countDecisions({ status: "approved", sinceDays: 7 }),
    countDecisions({ status: "rejected", sinceDays: 7 }),
    listRecentDecisions(5),
  ]);

  const stats = [
    { label: "Pending decisions", value: pending, tone: "amber" as const },
    { label: "Approved · 7d", value: approved, tone: "em" as const },
    { label: "Rejected · 7d", value: rejected, tone: "rose" as const },
  ];

  return (
    <div className="space-y-10">
      <div>
        <Klabel className="mb-3">overview</Klabel>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Welcome,{" "}
          <em className="italic text-em">{firstName}</em>.
        </h1>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <Klabel className="mb-2">{s.label}</Klabel>
            <p
              className={`font-display text-4xl font-semibold ${
                s.tone === "amber"
                  ? "text-amber"
                  : s.tone === "em"
                    ? "text-em"
                    : "text-rose"
              }`}
            >
              {s.value}
            </p>
          </Card>
        ))}
      </div>

      <div>
        <Klabel className="mb-3">recent activity</Klabel>
        <Card className="divide-y divide-line p-0">
          {recent.length === 0 ? (
            <p className="p-5 text-sm text-tm">No decisions yet.</p>
          ) : (
            recent.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-4 px-5 py-3.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-tp">
                  {truncate(d.question, 70)}
                </span>
                <Pill tone={decisionTone(d.humanDecision)}>
                  {d.humanDecision ?? "pending"}
                </Pill>
                <span className="w-44 truncate font-mono text-xs text-tm">
                  {d.finalizedByEmail ?? "—"}
                </span>
                <span className="w-20 text-right font-mono text-xs text-tg">
                  {relativeTime(d.decidedAt ?? d.createdAt)}
                </span>
              </div>
            ))
          )}
        </Card>
      </div>

      <div>
        <Klabel className="mb-3">quick links</Klabel>
        <div className="grid grid-cols-3 gap-4">
          {canIngest ? (
            <QuickLink
              href="/ingest"
              title="Ingest an item"
              sub="Feed memory a raw artifact"
            />
          ) : (
            <Card className="opacity-40">
              <p className="font-medium">Ingest an item</p>
              <p className="klabel mt-1">read-only role</p>
            </Card>
          )}
          <QuickLink
            href="/ask"
            title="Ask a question"
            sub="Get a cited brief"
          />
          <QuickLink
            href="/decisions"
            title="Review queue"
            sub="Approve or reject"
          />
        </div>
      </div>
    </div>
  );
}

function QuickLink({
  href,
  title,
  sub,
}: {
  href: string;
  title: string;
  sub: string;
}) {
  return (
    <Link href={href}>
      <Card className="transition hover:border-line-2">
        <p className="font-medium text-tp">{title}</p>
        <p className="mt-1 text-sm text-ts">{sub}</p>
      </Card>
    </Link>
  );
}
