import { randomBytes } from "node:crypto";

/**
 * Opaque server-side session token: 32 bytes of entropy as a 64-char hex
 * string, stored as-is in the sessions primary key. Security comes from the
 * entropy, not from hashing the token. (Trade-off documented in DESIGN.md.)
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}
