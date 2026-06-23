"use server";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { requirePermission } from "@/lib/auth/require-role";
import { ForbiddenError } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import { facts, rawItems, signals } from "@/lib/schema";
import { aggregateSignals, ingestRawItem, promoteSignals } from "@/lib/brain";

type IngestResult =
  | {
      ok: true;
      factsExtracted: number;
      signalsTouched: number;
      itemsSkipped: number;
      facts: { predicate: string; tier: number; quote: string }[];
    }
  | { ok: false; error: string };

export async function submitItem(
  _prev: IngestResult | null,
  formData: FormData,
): Promise<IngestResult> {
  // API-surface gate. The data layer doesn't re-check ingest (the verbatim-quote
  // verifier is the real safety net there), so this is the enforcement point.
  try {
    await requirePermission("ingest");
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return {
        ok: false,
        error: "Forbidden — ingesting is restricted to ops_lead and founder.",
      };
    }
    throw e;
  }

  const sourceType = String(formData.get("source_type") ?? "").trim();
  const sourceId = String(formData.get("source_id") ?? "").trim();
  const sourceUrl = String(formData.get("source_url") ?? "").trim();
  const validAt = String(formData.get("valid_at") ?? "").trim();
  const body = String(formData.get("content") ?? "")
    .replace(/\r\n/g, "\n")
    .trim();

  if (!sourceType || !sourceId || !body) {
    return {
      ok: false,
      error: "Source type, source id, and content are all required.",
    };
  }

  // Content-address the item (re-ingesting the same body is a no-op).
  const id = createHash("sha256").update(body, "utf8").digest("hex");
  const sourceRef = `${sourceType}/${sourceId}`;
  const metadata: Record<string, unknown> = {
    valid_at: validAt
      ? new Date(validAt).toISOString()
      : new Date().toISOString(),
  };
  if (sourceUrl) metadata["url"] = sourceUrl;

  await db
    .insert(rawItems)
    .values({ id, sourceType, sourceRef, body, metadata })
    .onConflictDoNothing({ target: rawItems.id });

  const result = await ingestRawItem({
    id,
    source_type: sourceType,
    source_ref: sourceRef,
    body,
    metadata,
    ingested_at: new Date(),
  });

  // Refresh the derived signal layer so the new facts are reflected.
  await aggregateSignals();
  await promoteSignals();

  const itemFacts = await db
    .select({
      id: facts.id,
      predicate: facts.predicate,
      evidenceTier: facts.evidenceTier,
      verbatimQuote: facts.verbatimQuote,
    })
    .from(facts)
    .where(eq(facts.rawItemId, id));

  const factIdSet = new Set(itemFacts.map((f) => f.id));
  const allSignals = await db.select({ factIds: signals.factIds }).from(signals);
  const signalsTouched = allSignals.filter((s) =>
    s.factIds.some((fid) => factIdSet.has(fid)),
  ).length;

  return {
    ok: true,
    factsExtracted: result.inserted,
    signalsTouched,
    itemsSkipped: result.rejected,
    facts: itemFacts.slice(0, 5).map((f) => ({
      predicate: f.predicate,
      tier: f.evidenceTier,
      quote: f.verbatimQuote,
    })),
  };
}
