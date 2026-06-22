"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "../../../drizzle/schema";
import { hashPassword, verifyPassword } from "../../../src/auth/hash";
import { generateSessionToken } from "../../../src/auth/session-token";
import { createSession } from "@/lib/auth/session";

export async function loginAction(
  _prev: { error?: string },
  formData: FormData,
): Promise<{ error?: string }> {
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const password = formData.get("password")?.toString();

  if (!email || !password) {
    return { error: "Email and password required" };
  }

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const user = rows[0];

  if (!user) {
    // Burn an equivalent bcrypt cost so a missing user isn't a timing oracle.
    await hashPassword(password);
    return { error: "Invalid credentials" };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return { error: "Invalid credentials" };

  const token = generateSessionToken();
  await createSession(user.id, token);

  // redirect() throws to unwind — control never returns past this line.
  redirect("/dashboard");
}
