import type { SessionUser } from "./session";

/**
 * The role → permission matrix. Anyone signed in can produce a brief; ops_lead
 * can also feed memory; only a founder can finalize a decision. This is the
 * contract the API surface enforces — the data layer enforces the finalize
 * boundary again on its own (see src/decisions/log.ts).
 */
export type Permission = "ask" | "ingest" | "finalize_decision";

const PERMISSIONS: Record<SessionUser["role"], readonly Permission[]> = {
  founder: ["ask", "ingest", "finalize_decision"],
  ops_lead: ["ask", "ingest"],
  analyst: ["ask"],
} as const;

export function hasPermission(
  role: SessionUser["role"],
  perm: Permission,
): boolean {
  return PERMISSIONS[role].includes(perm);
}

export class ForbiddenError extends Error {
  readonly role: SessionUser["role"];
  readonly permission: Permission;
  constructor(role: SessionUser["role"], permission: Permission) {
    super(`Role '${role}' lacks permission '${permission}'`);
    this.name = "ForbiddenError";
    this.role = role;
    this.permission = permission;
  }
}
