"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Reads ?toast=approved|rejected (set by the approve/reject redirect), shows a
 * top-right toast, then clears the query after 3s. No state library.
 */
export function Toast() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const toast = params.get("toast");
  const isToast = toast === "approved" || toast === "rejected";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isToast) return;
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      router.replace(pathname);
    }, 3000);
    return () => clearTimeout(t);
  }, [isToast, pathname, router]);

  if (!isToast || !visible) return null;
  const approved = toast === "approved";

  return (
    <div
      role="status"
      className={`fixed right-6 top-6 z-50 rounded-md border border-line bg-panel px-4 py-3 shadow-lg transition-opacity ${
        approved ? "border-l-2 border-l-em" : "border-l-2 border-l-rose"
      }`}
    >
      <p className="klabel mb-0.5">{approved ? "approved" : "rejected"}</p>
      <p className="text-sm text-tp">
        Decision {approved ? "approved" : "rejected"}.
      </p>
    </div>
  );
}
