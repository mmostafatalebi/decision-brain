"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { hasPermission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";

const ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/ingest", label: "Ingest", perm: "ingest" as const },
  { href: "/ask", label: "Ask" },
  { href: "/decisions", label: "Decisions" },
];

export function Nav({
  role,
  pendingCount,
}: {
  role: SessionUser["role"];
  pendingCount: number;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex w-48 shrink-0 flex-col gap-1 py-2">
      {ITEMS.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);

        // Analysts can see the Ingest surface but not use it.
        if (item.perm === "ingest" && !hasPermission(role, "ingest")) {
          return (
            <div
              key={item.href}
              className="border-l-2 border-transparent px-3 py-2 opacity-40"
            >
              <span className="font-mono text-xs uppercase tracking-wider text-tm">
                {item.label}
              </span>
              <span className="klabel mt-0.5 block text-[10px]">read-only</span>
            </div>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center justify-between border-l-2 px-3 py-2 font-mono text-xs uppercase tracking-wider transition ${
              active
                ? "border-em text-tp"
                : "border-transparent text-ts hover:text-tp"
            }`}
          >
            <span>{item.label}</span>
            {item.href === "/decisions" && pendingCount > 0 ? (
              <span className="rounded-full border border-line bg-panel-2 px-1.5 py-0.5 text-[10px] text-amber">
                {pendingCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
