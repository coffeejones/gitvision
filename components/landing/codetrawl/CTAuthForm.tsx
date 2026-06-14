"use client";

// CodeTrawl-themed login/signup form. Mirrors components/AuthForm.tsx exactly
// (same Better Auth client calls, same redirect/refresh on success) — only the
// copy and class scoping differ. Uses the shared `.auth-*` class names so
// codetrawl.css styles it under the `.ct` shell. GitHub-first, email fallback.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertCircle } from "lucide-react";
import { authClient } from "@/lib/authClient";
import { GithubIcon } from "@/components/GithubIcon";

type Mode = "login" | "signup";

export function CTAuthForm({ mode, redirectTo = "/" }: { mode: Mode; redirectTo?: string }) {
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
        const result = await authClient.signIn.email({ email: email.trim(), password });
        if (result.error) {
          setError(result.error.message ?? "Wrong email or password.");
          setSubmitting(false);
          return;
        }
      }
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
      await authClient.signIn.social({ provider: "github", callbackURL: redirectTo });
    } catch {
      setError("Couldn't start GitHub login. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="case-tag">
        <span className="dot" /> {isSignup ? "Create account" : "Sign in"}
      </div>
      <h1>{isSignup ? "Start sweeping." : "Welcome back."}</h1>
      <p className="sub">
        {isSignup
          ? "Run a survey on any public repo and keep every one across devices."
          : "Pick up where your last sweep left off."}
      </p>

      <button type="button" onClick={onGitHubLogin} disabled={submitting} className="auth-oauth">
        <GithubIcon size={16} />
        Continue with GitHub
      </button>

      <div className="auth-or">or</div>

      {error && (
        <div className="auth-err">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

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
          hint={isSignup ? "At least 8 characters" : <Link href="/forgot-password">Forgot password?</Link>}
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

        <button type="submit" disabled={submitting || !email.trim() || !password} className="auth-submit">
          {submitting && <Loader2 size={14} className="auth-spin" />}
          {submitting
            ? isSignup
              ? "Creating account…"
              : "Signing in…"
            : isSignup
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <p className="auth-switch">
        {isSignup ? (
          <>
            Already have an account? <Link href="/login">Sign in</Link>
          </>
        ) : (
          <>
            New to CodeTrawl? <Link href="/signup">Create an account</Link>
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
