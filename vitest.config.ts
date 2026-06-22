import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// The web app uses the "@/..." alias (configured in web/tsconfig.json). Mirror
// it here so the web auth test can import the session module the same way the
// Next app does. Inert for the brain tests, which don't use the alias.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "web"),
    },
  },
});
