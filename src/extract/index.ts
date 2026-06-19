import { completeJSON } from "../llm/provider.js";
import { EXTRACT_SYSTEM, buildExtractUser } from "../llm/extract-prompt.js";
import { ExtractionResultSchema, type ExtractionResult } from "./schema.js";

export interface RawItemInput {
  id: string;
  source_type: string;
  source_ref: string;
  body: string;
  metadata: Record<string, unknown>;
}

/**
 * The write-time extraction seam. Builds the prompt from the raw item, passes
 * the item's event time (metadata.valid_at) so facts are stamped with the
 * real-world time, and returns the schema-validated result.
 */
export async function extractFactsFromItem(
  rawItem: RawItemInput,
): Promise<ExtractionResult> {
  const validAt =
    typeof rawItem.metadata?.["valid_at"] === "string"
      ? (rawItem.metadata["valid_at"] as string)
      : undefined;

  const user = buildExtractUser(
    {
      source_type: rawItem.source_type,
      source_ref: rawItem.source_ref,
      body: rawItem.body,
      metadata: rawItem.metadata,
    },
    validAt,
  );

  return completeJSON({
    system: EXTRACT_SYSTEM,
    user,
    schema: ExtractionResultSchema,
    maxRetries: 1,
  });
}
