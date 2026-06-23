import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { countDecisions } from "@/lib/brain";
import { Nav } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Pill } from "@/components/ui";
import { roleLabel } from "@/lib/format";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const pendingCount = await countDecisions({ status: "pending" });

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-line px-8 py-4">
        <div className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-em shadow-[0_0_16px_var(--em)]" />
          <span className="font-semibold tracking-wide">Decision Brain</span>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs">
          <span className="text-tm">{user.email}</span>
          <Pill tone="em">{roleLabel(user.role)}</Pill>
          <ThemeToggle />
          <form action="/api/logout" method="POST">
            <button className="text-tm transition hover:text-tp">Sign out</button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-8 py-8">
        <Nav role={user.role} pendingCount={pendingCount} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
