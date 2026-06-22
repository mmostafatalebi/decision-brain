import bcrypt from "bcrypt";

/**
 * Password hashing for the RBAC layer. bcrypt at cost 12 — a deliberate,
 * tunable work factor. Hand-rolled rather than pulling in an auth framework;
 * the production hardening story lives in DESIGN.md.
 */
const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
