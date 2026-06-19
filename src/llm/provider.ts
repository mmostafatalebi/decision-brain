import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { config } from "../config.js";
import { requestRawJSON } from "./raw.js";

export type LLMProvider = "anthropic" | "openai";

export function getProvider(): LLMProvider {
  return config.LLM_PROVIDER;
}

/** Thrown when the LLM can't produce schema-valid JSON even after a retry. */
export class ExtractionError extends Error {
  readonly rawResponse: unknown;
  override readonly cause: unknown;
  constructor(message: string, rawResponse: unknown, cause?: unknown) {
    super(message);
    this.name = "ExtractionError";
    this.rawResponse = rawResponse;
    this.cause = cause;
  }
}

function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // Inline refs ($refStrategy: "none") so the tool input_schema is self-contained.
  const js = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;
  delete js["$schema"];
  return js;
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}

/**
 * Run an LLM call constrained to a Zod schema. The provider returns JSON, which
 * we validate with `schema.parse`. On a validation failure we append the error
 * to the prompt and retry once (configurable). A second failure throws
 * `ExtractionError` with the offending raw response attached.
 */
export async function completeJSON<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxRetries?: number;
}): Promise<T> {
  const { system, schema } = opts;
  const maxRetries = opts.maxRetries ?? 1;
  const jsonSchema = toJsonSchema(schema);

  let user = opts.user;
  let lastRaw: unknown;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      lastRaw = await requestRawJSON({
        system,
        user,
        jsonSchema,
        schemaName: "emit_result",
      });
      const parsed = schema.safeParse(lastRaw);
      if (parsed.success) return parsed.data;
      lastErr = parsed.error;
      user = `${opts.user}\n\nYour previous response failed validation: ${formatZodError(
        parsed.error,
      )}. Return a corrected JSON that matches the schema exactly.`;
    } catch (err) {
      // Transport error or unparseable output — treat as a failed attempt.
      lastErr = err;
      user = `${opts.user}\n\nYour previous response could not be parsed: ${
        err instanceof Error ? err.message : String(err)
      }. Return valid JSON that matches the schema exactly.`;
    }
  }

  throw new ExtractionError(
    `LLM output failed schema validation after ${maxRetries + 1} attempt(s)`,
    lastRaw,
    lastErr,
  );
}
