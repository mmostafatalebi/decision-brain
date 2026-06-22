"use client";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "./actions";

const initialState: { error?: string } = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-em-deep px-4 py-2.5 font-medium text-[#06120d] transition hover:bg-em disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState(loginAction, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-9 flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-em shadow-[0_0_16px_var(--em)]" />
          <span className="font-semibold tracking-wide">Decision Brain</span>
        </div>

        <p className="klabel mb-3">Sign in</p>
        <h1 className="mb-8 font-display text-4xl font-semibold tracking-tight">
          Welcome <em className="italic text-em">back</em>.
        </h1>

        <form action={formAction} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="email" className="klabel block">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="w-full rounded-md border border-line bg-panel px-3 py-2.5 text-tp outline-none transition placeholder:text-tg focus:border-em"
              placeholder="maya@loomwork.local"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="klabel block">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-md border border-line bg-panel px-3 py-2.5 text-tp outline-none transition placeholder:text-tg focus:border-em"
              placeholder="demo"
            />
          </div>

          {state.error ? (
            <p className="text-sm text-rose" role="alert">
              {state.error}
            </p>
          ) : null}

          <SubmitButton />
        </form>

        <p className="mt-8 font-mono text-xs leading-relaxed text-tg">
          Demo accounts — password{" "}
          <span className="text-tm">demo</span>:
          <br />
          maya@loomwork.local · devin@loomwork.local · priya@loomwork.local
        </p>
      </div>
    </div>
  );
}
