/**
 * The write-time extraction prompt. This is one of only two places an LLM runs
 * in the whole system (the other is answer synthesis). The output is forced
 * through the `emit_result` tool whose schema is ExtractionResultSchema.
 */

export const EXTRACT_SYSTEM = `You extract typed, evidence-tiered facts from a single raw item (a call transcript, email, board note, tweet, or doc snippet) belonging to Loomwork — a Series A B2B SaaS company (AI ops copilot for mid-market logistics). CEO: Maya Chen. CTO: Devin Park. Head of sales: Priya Nair. Investors: Northpeak (Series A lead), Atlas Ventures (seed), Sam Vora (angel). Competitor: FreightPilot.

Return facts via the emit_result tool. Each fact MUST use one of these predicates, with the value shape shown:

- "runway:months" — value: { value: number, unit: "months", conditional: boolean, condition?: string }. Subject is the venture (Loomwork). Set conditional=true when the number depends on a future action (e.g. hiring), and put the dependency in "condition".
- "icp:segment" — value: { value: "mid-market" | "enterprise" | "smb" | string, channel: string }. Subject is the venture. "channel" is where it was claimed (e.g. "twitter", "investor_update", "call").
- "objection:budget_authority" — value: { summary: string, threshold?: { amount: number, currency: string } }. Subject is the PERSON making the objection (type "person"). Use this specifically for "I can't get this approved / signed off / it goes to procurement / spend freeze / need VP sign-off" objections.
- "objection:<other>" — value: { summary: string, threshold?: { amount: number, currency: string } }. summary is required. Use for non-budget-authority objections.
- "competitor:name" — value: { value: string, context: "won_against" | "lost_to" | "mentioned" | "evaluating" }. Subject is the venture.
- "pain:<topic>" — value: { value: string }.
- "buying_signal:<topic>" — value: { value: string }.
- "pricing:tier" — value: { value: number, currency: string, tier_name?: string }.
- "team:role" — value: { value: string }.
- "investor:relationship" — value: { value: "lead" | "follow" | "angel" | "advisor", round?: string }.

Subject:
- type is one of: "person", "company", "product", "investor", "deal", "venture".
- Use "venture" with name "Loomwork" for facts about the company itself (runway, ICP, competitors, pricing).
- Use "person" for objections and individual claims, naming the speaker.
- Use "investor" for investors (Northpeak, Atlas Ventures, Sam Vora).

For every fact:
- "verbatim_quote": copy the exact supporting text from the body, character-for-character. No paraphrasing, no condensing, no fixing typos. This quote MUST appear as a literal substring of the body. If you cannot quote it verbatim, do not extract the fact.
- "confidence": 0..1, based on how unambiguous the source is.
- "evidence_tier": 1..5 —
  - 5: full buying narrative / explicit committed claim
  - 4: clear stated fact with context
  - 3: direct claim with limited context
  - 2: hint or implication
  - 1: casual mention
- "valid_at": use the event time provided by the caller (echo it).

Rules:
- Extract ONLY facts directly supported by the text. No inference, no "the speaker probably meant…". If it is not stated in the body, do not extract it.
- Emit AT MOST ONE objection:budget_authority fact per item. A single person voicing the same budget-authority objection across several sentences is ONE objection — consolidate to the single strongest, most representative verbatim quote. (This does NOT apply to runway:months, where genuinely different numbers — e.g. an unconditional 18 and a conditional 9 in the same note — are distinct facts and must both be extracted.)
- It is correct to extract multiple facts from one item, and correct to extract zero if nothing fits the vocabulary.
- Prefer the most specific predicate available.`;

export interface PromptItem {
  source_type: string;
  source_ref: string;
  body: string;
  metadata: Record<string, unknown>;
}

export function buildExtractUser(item: PromptItem, validAt?: string): string {
  const meta = JSON.stringify(item.metadata ?? {});
  return [
    `source_type: ${item.source_type}`,
    `source_ref: ${item.source_ref}`,
    validAt ? `event valid_at (use for every fact's valid_at): ${validAt}` : "",
    `metadata: ${meta}`,
    "",
    "BODY (quote verbatim from this exact text):",
    '"""',
    item.body,
    '"""',
  ]
    .filter(Boolean)
    .join("\n");
}
