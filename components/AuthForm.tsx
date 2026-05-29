"use client";

// Shared auth form (v0.75; restyled to forensic-dossier in Phase M).
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
// Styling: all `.rj auth-*` classes from repojury.css, so the form
// reads as part of the records-office aesthetic established on the
// landing. The Better Auth client logic is unchanged from the
// TOK-dark version — only the markup + classes moved.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
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
    <div className="auth-card">
      <div className="case-tag">
        <span className="dot" /> {isSignup ? "Case intake" : "Returning counsel"}
      </div>
      <h1>{isSignup ? "Open your first case" : "Welcome back"}</h1>
      <p className="sub">
        {isSignup
          ? "Put any GitHub repo on trial and keep your case files across devices."
          : "Sign in to reopen your saved cases."}
      </p>

      {/* GitHub OAuth — primary path for our target audience */}
      <button
        type="button"
        onClick={onGitHubLogin}
        disabled={submitting}
        className="auth-oauth"
      >
        <GithubIcon size={16} />
        {isSignup ? "Sign up with GitHub" : "Log in with GitHub"}
      </button>

      <div className="auth-or">or</div>

      {/* Error banner */}
      {error && (
        <div className="auth-err">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {/* Email/password form */}
      <form onSubmit={onSubmit}>
        {isSignup && (
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              autoComplete="name"
              placeholder="Your name"
              className="auth-input"
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
            className="auth-input"
          />
        </Field>

        <Field
          label="Password"
          hint={
            isSignup ? (
              "At least 8 characters"
            ) : (
              <Link href="/forgot-password">Forgot password?</Link>
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
            className="auth-input"
          />
        </Field>

        <button
          type="submit"
          disabled={submitting || !email.trim() || !password}
          className="auth-submit"
        >
          {submitting && <Loader2 size={14} className="auth-spin" />}
          {submitting
            ? isSignup
              ? "Opening case…"
              : "Signing in…"
            : isSignup
              ? "Open my case"
              : "Sign in"}
        </button>
      </form>

      {/* Switch mode */}
      <p className="auth-switch">
        {isSignup ? (
          <>
            Already have cases on file? <Link href="/login">Sign in</Link>
          </>
        ) : (
          <>
            New to RepoJury? <Link href="/signup">Open your first case</Link>
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
    <div className="auth-field">
      <div className="row">
        <label className="auth-label">{label}</label>
        {hint && <span className="auth-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
