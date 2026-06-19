import { existsSync } from "node:fs";
import { z } from "zod";

// Load .env using Node's native loader (no dotenv dependency). Real process
// env always wins over the file, so CI / shell exports keep priority.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

/**
 * Typed, validated environment. Parsed once at import time so a missing or
 * malformed key fails fast and loudly instead of surfacing deep in a request.
 */
const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  TAVILY_API_KEY: z.string().min(1, "TAVILY_API_KEY is required"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),
  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
});

export type Config = z.infer<typeof EnvSchema>;

function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n` +
        `Copy .env.example to .env and fill in the values.`,
    );
  }
  return parsed.data;
}

export const config = loadConfig();
