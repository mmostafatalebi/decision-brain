import { z } from "zod";

/**
 * The write-time extraction seam's contract. Every fact the LLM emits must
 * validate against this exactly; anything that doesn't is retried once, then
 * rejected. See extract-prompt.ts for the allowed predicate vocabulary.
 */
export const SubjectSchema = z.object({
  type: z.enum([
    "person",
    "company",
    "product",
    "investor",
    "deal",
    "venture",
  ]),
  name: z.string().min(1),
  attributes: z.record(z.unknown()).optional(),
});
export type Subject = z.infer<typeof SubjectSchema>;

export const FactSchema = z.object({
  subject: SubjectSchema,
  predicate: z.string().min(1), // see allowed prefixes in extract-prompt.ts
  value: z.unknown(), // JSON-serializable; structure depends on predicate
  evidence_tier: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  verbatim_quote: z.string().min(1),
  quote_offset: z
    .object({ start: z.number().int().min(0), end: z.number().int() })
    .optional(),
  valid_at: z.string().datetime().optional(), // defaults to raw_item.metadata.valid_at
});
export type Fact = z.infer<typeof FactSchema>;

export const ExtractionResultSchema = z.object({
  facts: z.array(FactSchema),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
