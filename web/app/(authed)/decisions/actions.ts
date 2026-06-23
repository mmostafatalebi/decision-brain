"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/require-role";
import { finalizeDecision } from "@/lib/brain";

async function finalize(
  decision: "approved" | "rejected",
  formData: FormData,
): Promise<void> {
  // API-surface gate. finalizeDecision then re-checks the role in the data
  // layer — both must pass.
  const user = await requirePermission("finalize_decision");
  const decisionId = String(formData.get("decision_id") ?? "");
  const note = String(formData.get("note") ?? "").trim() || undefined;
  await finalizeDecision(decisionId, decision, user.id, note);
  revalidatePath("/decisions");
  revalidatePath("/dashboard");
}

export async function approveDecision(formData: FormData): Promise<void> {
  await finalize("approved", formData);
}

export async function rejectDecision(formData: FormData): Promise<void> {
  await finalize("rejected", formData);
}
