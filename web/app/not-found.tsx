import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-em shadow-[0_0_16px_var(--em)]" />
          <span className="font-semibold tracking-wide">Decision Brain</span>
        </div>
        <h1 className="font-display text-6xl font-bold tracking-tight">404</h1>
        <p className="klabel mt-3">page not found</p>
        <p className="mt-4 text-ts">
          That route doesn&apos;t exist. The brain only knows dashboard, ingest,
          ask, and decisions.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-md bg-em-deep px-4 py-2 font-medium text-[#06120d] transition-colors hover:bg-em focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-em focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
