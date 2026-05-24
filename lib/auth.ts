// Better Auth — server-side config (v0.75 / Phase A of OAuth platform).
//
// This is the canonical auth surface. Server Components, route handlers,
// and server actions read `auth.api.getSession({ headers: await headers() })`
// to know who the caller is. The client-side counterpart lives in
// lib/authClient.ts and is what UI components (LoginForm, SignupForm,
// UserDropdown) interact with.
//
// Design choices documented in PROGRESS.md → "OAuth platform (v0.75)":
//   - Email + password as primary login. GitHub OAuth is offered alongside
//     and can also be linked from the account page after signup.
//   - Email verification is NOT required for v1. Folks can log in
//     immediately after signup. We'll wire Resend + verification flow
//     once we have something to verify (Phase D).
//   - SQLite + Drizzle as the storage layer (see lib/db/index.ts) — one
//     file on disk, matches our file-based invariant. Migration to
//     Postgres later is straightforward (Drizzle handles the swap).
//
// Two GitHub identities — DO NOT CONFUSE:
//   - GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET  → OAuth login (this file)
//   - GITHUB_APP_CLIENT_ID + GITHUB_APP_*      → PR-bot installation
//     (lib/githubApp/*, separate concern)

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "./db";
import { sendEmail } from "./email/send";
import { verificationEmail } from "./email/templates/verification";
import { passwordResetEmail } from "./email/templates/passwordReset";

const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
const githubOAuthConfigured = !!(githubClientId && githubClientSecret);

// Origins Better Auth will accept requests from. Mismatches between
// the Origin header and BETTER_AUTH_URL otherwise produce a generic
// "Invalid origin" error — common in dev when Next.js falls back to
// port 3001/3002 because something else holds 3000.
//
// Locally we trust the common Next.js dev ports. In production
// BETTER_AUTH_URL is the canonical entry (repobaron.com), but we
// also include it here belt-and-suspenders so a misconfigured
// BETTER_AUTH_URL doesn't bring the whole flow down.
const trustedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "https://repobaron.com",
  // Honour an explicit override too — useful for Railway preview
  // deploys where the URL is branch-specific.
  ...(process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : []),
];

export const auth = betterAuth({
  // Accept requests from any of these origins. See declaration above
  // for why we don't rely solely on BETTER_AUTH_URL.
  trustedOrigins,

  // Identity comes from the SQLite database. The four tables (user,
  // session, account, verification) are defined in lib/db/schema.ts
  // and applied via drizzle-kit migrations checked into ./drizzle/.
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),

  // Email + password is the primary path. Verification flow wired
  // through Resend in Phase D2; the actual "must verify before login"
  // gate is left OFF for now (Phase D3 turns it on). That gives us a
  // safety net: if email-send breaks in production, existing users
  // can still log in. We'll flip requireEmailVerification to true
  // once D3 ships a verified working flow end-to-end.
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    /** Called when a user requests a password reset via the
     *  /forgot-password page. Better Auth generates the signed URL;
     *  we wrap it in a branded template + dispatch via Resend. */
    sendResetPassword: async ({ user, url }) => {
      const { subject, html, text } = passwordResetEmail({
        name: user.name,
        link: url,
      });
      const result = await sendEmail({
        to: user.email,
        subject,
        html,
        text,
      });
      if (!result.ok) {
        // Don't throw — Better Auth's reset endpoint shouldn't 500 just
        // because Resend hiccuped. We log loudly so monitoring can
        // catch it, and the user can retry from /forgot-password.
        console.error(
          `[auth] password-reset email failed for ${user.email}: ${result.reason}${
            "error" in result && result.error ? ` (${result.error})` : ""
          }`
        );
      }
    },
  },

  /** Email-verification config — Better Auth calls our sender when
   *  a user signs up (auto), or when /verify-email is requested
   *  again. Same pattern as sendResetPassword. */
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const { subject, html, text } = verificationEmail({
        name: user.name,
        link: url,
      });
      const result = await sendEmail({
        to: user.email,
        subject,
        html,
        text,
      });
      if (!result.ok) {
        console.error(
          `[auth] verification email failed for ${user.email}: ${result.reason}${
            "error" in result && result.error ? ` (${result.error})` : ""
          }`
        );
      }
    },
    /** Fire a verification email at signup time. Doesn't gate login
     *  (requireEmailVerification above stays false until D3) — we
     *  send it as a nice-to-have so the user can verify when ready. */
    sendOnSignUp: true,
  },

  // GitHub OAuth provider — only registered when env vars are set so
  // local dev without GitHub credentials still works (email/password
  // path remains functional). The `github_login` user field gets
  // populated automatically by Better Auth from the GitHub `login`
  // claim, which we surface in the UI as the username badge.
  socialProviders: githubOAuthConfigured
    ? {
        github: {
          clientId: githubClientId!,
          clientSecret: githubClientSecret!,
          // Scopes requested at OAuth authorize time (v0.81+).
          //   - `read:user`   — fetch profile (login, avatar) to populate
          //                     user record + githubLogin custom field.
          //   - `user:email`  — read primary verified email so account
          //                     linking works (we require email-verified
          //                     identity for trustedProviders).
          //   - `repo`        — read repository contents, including PRIVATE
          //                     repos the user owns or has access to.
          //                     Needed for analyzeRepo to fetch metadata,
          //                     commits, languages, README, tarballs for
          //                     a user's private GitHub repos. Without
          //                     this, the user-token only sees public
          //                     repos (same as the server-PAT fallback).
          // Existing users keep their pre-v0.81 token (no `repo` scope)
          // until they re-authorize. The lib/github.ts fallback chain
          // handles the legacy-scope case by deferring to the server
          // PAT for public-only access.
          scope: ["read:user", "user:email", "repo"],
        },
      }
    : undefined,

  // Expose `githubLogin` on the user record. `input: false` means
  // clients can't set it via the signup payload — it's populated
  // server-side from the GitHub profile when an OAuth account is
  // linked. The schema column already exists in lib/db/schema.ts.
  user: {
    additionalFields: {
      githubLogin: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },

  // Auto-link OAuth accounts to existing users when emails match.
  // Default Better Auth behaviour is to refuse this (returns
  // `account_not_linked`) — that's the safe default for a generic
  // app where any provider might lie about email ownership. We opt
  // in for GitHub because:
  //   1. GitHub requires email verification before exposing it via
  //      the OAuth profile, so a matching email genuinely means the
  //      same human.
  //   2. Our intended UX is "one account, multiple login methods".
  //      A user signs up with email/password and later wants the
  //      one-click GitHub button to work — without this flag, that
  //      requires manually unlinking + relinking via /settings.
  // If we ever add Google/Twitter/etc. providers, only add them to
  // `trustedProviders` if their email-verification story is equally
  // strict.
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github"],
    },
  },

  // `nextCookies()` MUST be the last plugin per Better Auth docs —
  // it intercepts server-action responses to set/clear cookies
  // correctly (which Next.js's server-action runtime won't do
  // automatically). Without it, signup/login appear to succeed but
  // the session cookie never reaches the browser.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
