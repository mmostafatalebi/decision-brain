import { Klabel } from "@/components/ui";
import { AskForm } from "./ask-form";

export default function AskPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Klabel className="mb-3">ask the brain</Klabel>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          What do you need to defend?
        </h1>
        <p className="mt-3 max-w-xl text-ts">
          The brain retrieves typed facts, detects contradictions, runs a
          research call only when the corpus disagrees, synthesizes a cited
          brief, validates every citation resolves, and logs the recommendation
          as pending for human review.
        </p>
      </div>
      <AskForm />
    </div>
  );
}
