import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config.js";

/**
 * The raw provider call: send a prompt, force structured JSON out, return the
 * parsed-but-unvalidated object. Kept deliberately thin and in its own module
 * so `completeJSON`'s validation + retry logic can be unit-tested by mocking
 * just this function.
 */

// Models are env-overridable. Defaults track the most capable current models.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const LOW_TEMPERATURE = 0.1;

/**
 * Opus 4.7/4.8 and Fable/Mythos reject `temperature` (HTTP 400). For those we
 * omit it — determinism comes from forced tool-use instead. Older Claude models
 * and OpenAI still honor a low temperature.
 */
function anthropicSupportsTemperature(model: string): boolean {
  return !/opus-4-(7|8)|fable|mythos/.test(model);
}

let anthropicClient: Anthropic | undefined;
function anthropic(): Anthropic {
  return (anthropicClient ??= new Anthropic({
    apiKey: config.ANTHROPIC_API_KEY,
  }));
}

let openaiClient: OpenAI | undefined;
function openai(): OpenAI {
  return (openaiClient ??= new OpenAI({ apiKey: config.OPENAI_API_KEY }));
}

export interface RawRequest {
  system: string;
  user: string;
  /** JSON Schema (draft-7) the output must conform to. */
  jsonSchema: Record<string, unknown>;
  /** Tool/function name presented to the model. */
  schemaName: string;
}

async function viaAnthropic(req: RawRequest): Promise<unknown> {
  const model = ANTHROPIC_MODEL;
  const res = await anthropic().messages.create({
    model,
    max_tokens: 8192,
    system: req.system,
    tools: [
      {
        name: req.schemaName,
        description:
          "Emit the structured extraction result. Call this exactly once.",
        // zod-derived JSON Schema; shape matches Anthropic's InputSchema.
        input_schema: req.jsonSchema as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: req.schemaName },
    ...(anthropicSupportsTemperature(model)
      ? { temperature: LOW_TEMPERATURE }
      : {}),
    messages: [{ role: "user", content: req.user }],
  });

  const toolUse = res.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Anthropic response contained no tool_use block");
  }
  return toolUse.input;
}

async function viaOpenAI(req: RawRequest): Promise<unknown> {
  const res = await openai().chat.completions.create({
    model: OPENAI_MODEL,
    temperature: LOW_TEMPERATURE,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${req.system}\n\nReturn ONLY a JSON object that conforms to this JSON Schema:\n${JSON.stringify(
          req.jsonSchema,
        )}`,
      },
      { role: "user", content: req.user },
    ],
  });
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI response contained no content");
  return JSON.parse(content) as unknown;
}

export async function requestRawJSON(req: RawRequest): Promise<unknown> {
  return config.LLM_PROVIDER === "openai"
    ? viaOpenAI(req)
    : viaAnthropic(req);
}
