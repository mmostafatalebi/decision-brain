import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "./session";
import { hasPermission, ForbiddenError, type Permission } from "./permissions";

/** The current user, or a redirect to /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** The current user, or a thrown ForbiddenError if they lack the permission. */
export async function requirePermission(
  perm: Permission,
): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user.role, perm)) {
    throw new ForbiddenError(user.role, perm);
  }
  return user;
}
