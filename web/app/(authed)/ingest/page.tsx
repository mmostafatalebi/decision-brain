import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { Card, Klabel } from "@/components/ui";
import { IngestForm } from "./ingest-form";

export default async function IngestPage() {
  const user = await getCurrentUser();
  const canIngest = user ? hasPermission(user.role, "ingest") : false;

  if (!canIngest) {
    return (
      <div className="max-w-xl space-y-6">
        <div>
          <Klabel className="mb-3">ingest a raw item</Klabel>
          <h1 className="font-display text-4xl font-semibold tracking-tight">
            Feed the memory.
          </h1>
        </div>
        <Card className="border-amber">
          <Klabel className="mb-2">
            role: {user?.role ?? "—"} · permission: read
          </Klabel>
          <p className="text-ts">
            Ingesting is restricted to <span className="text-tp">ops_lead</span>{" "}
            and <span className="text-tp">founder</span>. You can ask questions or
            review decisions — both open to your role.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Klabel className="mb-3">ingest a raw item</Klabel>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Feed the memory.
        </h1>
        <p className="mt-3 max-w-xl text-ts">
          Drop a raw artifact — an investor email, a call transcript, a board
          note, a tweet, a pricing doc. The brain extracts typed facts under a
          verbatim-quote gate: every fact must quote a literal substring of this
          source.
        </p>
      </div>
      <IngestForm />
    </div>
  );
}
