"use client";

// Shared auth form (v0.75) — used by /login and /signup pages.
//
// Layout:
//   [GitHub OAuth button]   — top, primary CTA for OSS-friendly users
//   ── or ──
//   [Name field]            — signup only
//   [Email field]
//   [Password field]
//   [Submit button]
//   [Link to the other mode]
//
// Why GitHub-first: most of our target audience has a GitHub account
// already and the friction of typing email + password is real. The
// email path stays for users who want to keep their workspace
// independent from any social account.
//
// Errors surface inline above the form (rose tint). We trust Better
// Auth's error messages — they're user-readable enough ("Invalid email
// or password", "Email already exists") to show verbatim.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
import { TOK } from "@/lib/theme";
import { authClient } from "@/lib/authClient";
import { GithubIcon } from "@/components/GithubIcon";

type Mode = "login" | "signup";

interface Props {
  mode: Mode;
  /** Where to redirect on successful auth. Defaults to /. */
  redirectTo?: string;
}

export function AuthForm({ mode, redirectTo = "/" }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      if (isSignup) {
        const result = await authClient.signUp.email({
          email: email.trim(),
          password,
          name: name.trim() || email.trim().split("@")[0],
        });
        if (result.error) {
          setError(result.error.message ?? "Could not create account.");
          setSubmitting(false);
          return;
        }
      } else {
        const result = await authClient.signIn.email({
          email: email.trim(),
          password,
        });
        if (result.error) {
          setError(result.error.message ?? "Wrong email or password.");
          setSubmitting(false);
          return;
        }
      }
      // Success — push and refresh so Server Components re-render with
      // the new session cookie picked up by the Next router.
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Network error — check your connection and try again.");
      setSubmitting(false);
    }
  }

  async function onGitHubLogin() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Better Auth handles the redirect to GitHub itself; we never
      // come back from this call client-side. callbackURL is where
      // GitHub returns the user after authorization.
      await authClient.signIn.social({
        provider: "github",
        callbackURL: redirectTo,
      });
    } catch {
      setError("Couldn't start GitHub login. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="w-full max-w-md rounded-2xl flex flex-col gap-5 p-7"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <header className="flex flex-col gap-1">
        <h1
          className="text-xl font-semibold"
          style={{ color: TOK.textPrimary }}
        >
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          {isSignup
            ? "Map any GitHub repo and save your sessions across devices."
            : "Log in to access your saved sessions."}
        </p>
      </header>

      {/* GitHub OAuth — primary path for our target audience */}
      <button
        type="button"
        onClick={onGitHubLogin}
        disabled={submitting}
        className="h-10 flex items-center justify-center gap-2 rounded-md text-sm font-medium transition cursor-pointer disabled:opacity-50 hover:brightness-110"
        style={{
          background: TOK.surfaceElevated,
          border: `1px solid ${TOK.borderStrong}`,
          color: TOK.textPrimary,
        }}
      >
        <GithubIcon size={16} />
        {isSignup ? "Sign up with GitHub" : "Log in with GitHub"}
      </button>

      {/* OR divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: TOK.border }} />
        <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: TOK.textMuted }}>
          or
        </span>
        <div className="flex-1 h-px" style={{ background: TOK.border }} />
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="flex items-start gap-2 rounded-md px-3 py-2 text-xs"
          style={{
            background: `${TOK.rose}1a`,
            border: `1px solid ${TOK.rose}55`,
            color: TOK.rose,
          }}
        >
          <AlertCircle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Email/password form */}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {isSignup && (
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              autoComplete="name"
              placeholder="Your name"
              className="w-full h-9 rounded-md px-3 text-sm outline-none"
              style={{
                background: TOK.surfaceElevated,
                border: `1px solid ${TOK.border}`,
                color: TOK.textPrimary,
              }}
            />
          </Field>
        )}

        <Field label="Email">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            autoComplete="email"
            placeholder="you@example.com"
            className="w-full h-9 rounded-md px-3 text-sm outline-none"
            style={{
              background: TOK.surfaceElevated,
              border: `1px solid ${TOK.border}`,
              color: TOK.textPrimary,
            }}
          />
        </Field>

        <Field
          label="Password"
          hint={
            isSignup ? (
              "At least 8 characters"
            ) : (
              <Link
                href="/forgot-password"
                className="hover:underline"
                style={{ color: TOK.textMuted }}
              >
                Forgot password?
              </Link>
            )
          }
        >
          <input
            type="password"
            required
            minLength={isSignup ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder="••••••••"
            className="w-full h-9 rounded-md px-3 text-sm outline-none"
            style={{
              background: TOK.surfaceElevated,
              border: `1px solid ${TOK.border}`,
              color: TOK.textPrimary,
            }}
          />
        </Field>

        <button
          type="submit"
          disabled={submitting || !email.trim() || !password}
          className="mt-1 h-10 rounded-md text-sm font-medium transition flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer hover:brightness-110"
          style={{
            background: TOK.accent,
            color: TOK.accentOn,
          }}
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting
            ? isSignup
              ? "Creating account…"
              : "Logging in…"
            : isSignup
              ? "Sign up"
              : "Log in"}
        </button>
      </form>

      {/* Switch mode */}
      <p className="text-xs text-center" style={{ color: TOK.textMuted }}>
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium hover:underline"
              style={{ color: TOK.accent }}
            >
              Log in
            </Link>
          </>
        ) : (
          <>
            New to RepoJury?{" "}
            <Link
              href="/signup"
              className="font-medium hover:underline"
              style={{ color: TOK.accent }}
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** Either a plain hint string (e.g. "At least 8 characters") or
   *  a small interactive element (e.g. the "Forgot password?" link). */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label
          className="text-[11px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: TOK.textMuted }}
        >
          {label}
        </label>
        {hint && (
          <span className="text-[11px]" style={{ color: TOK.textMuted }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
