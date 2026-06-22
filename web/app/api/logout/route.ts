import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/session";

export async function POST() {
  await clearSession();
  // localhost target is fine for the demo; production would derive it from the
  // request's forwarded host header.
  return NextResponse.redirect(new URL("/login", "http://localhost:3000"), {
    status: 303,
  });
}
