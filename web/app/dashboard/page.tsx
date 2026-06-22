import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-line px-8 py-5">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-em shadow-[0_0_16px_var(--em)]" />
          <span className="font-semibold tracking-wide">Decision Brain</span>
        </div>
        <div className="flex items-center gap-5 font-mono text-xs">
          <span className="text-tm">{user.email}</span>
          <span className="uppercase tracking-wider text-em">
            {user.role.replace("_", " ")}
          </span>
          <ThemeToggle />
          <form action="/api/logout" method="POST">
            <button className="text-tm transition hover:text-tp">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-8 py-16">
        <p className="klabel mb-3">Phase 2 · auth + theming</p>
        <h1 className="mb-6 font-display text-5xl font-bold tracking-tight">
          Welcome,{" "}
          <em className="font-semibold italic text-em">
            {user.name.split(" ")[0]}
          </em>
          .
        </h1>
        <p className="max-w-2xl text-lg text-ts">
          The full dashboard, ingest, ask, and decisions queue land in Phase 4.
          The VSI design polish lands in Phase 5. Right now you&apos;re seeing the
          auth seam — log in, get a session, theme toggles, sign out.
        </p>
      </main>
    </div>
  );
}
