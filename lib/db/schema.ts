// Better Auth database schema (Drizzle + SQLite).
//
// This file is the canonical schema source. It is initially generated
// by `npx @better-auth/cli@latest generate` (which reads our auth.ts
// config and emits matching table definitions), then committed verbatim.
//
// When we change auth.ts (e.g. add a new `additionalFields` entry to
// `user`), re-run the CLI to refresh this file, then `drizzle-kit
// generate` to emit a versioned SQL migration in ./drizzle/, then
// `drizzle-kit migrate` to apply it.
//
// Tables (per Better Auth core schema):
//   user          — identity (email, name, image, custom fields)
//   session       — active login sessions
//   account       — credential and OAuth provider links per user
//   verification  — email verification + password reset tokens

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  // Custom field — populated server-side when GitHub OAuth account is
  // linked to a user. Lets us display the GitHub handle in the UI
  // without an extra API roundtrip. `input: false` in auth.ts config
  // prevents clients from setting it via the signup payload.
  githubLogin: text("github_login"),
  // Subscription tier — drives feature gating across the app. Default
  // "open-case" for new signups; flipped to "standing-docket" / "full-bench" by the
  // Polar webhook handler when checkout completes or status changes.
  tier: text("tier").notNull().default("open-case"),
  // Polar's identifier for the active subscription. Nullable for
  // Free (no subscription) and for users who cancelled.
  polarSubscriptionId: text("polar_subscription_id"),
  // Subscription lifecycle status from Polar:
  //   "active"   — billing OK, full access
  //   "trialing" — inside a Polar trial (if configured), full access
  //   "canceled" — user cancelled, access until currentPeriodEnd
  //   "revoked"  — payment failed, immediate downgrade
  //   "past_due" — last invoice failed but still in grace period
  // Null when tier === "open-case" (no subscription).
  subscriptionStatus: text("subscription_status"),
  // End of the current billing period. After this, the user either
  // re-bills (active) or drops to Free (open-case) (canceled / revoked).
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
  // True when user has scheduled cancellation but is still in the
  // paid period. UI shows "Plan ends on X" instead of "Renews on X".
  cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
    .notNull()
    .default(false),
  // Daily refresh quota counter for Free tier rate-limiting (5/day).
  // Reset whenever dailyRefreshDate changes (i.e. new day). Plus+
  // tiers have unlimited refreshes — the counter is still updated
  // but never enforced for them.
  //
  // Stored on user row rather than a separate refresh_log table for
  // simplicity: we don't need historical analytics on refreshes, just
  // "how many today". Single UPDATE per refresh, no joins.
  dailyRefreshCount: integer("daily_refresh_count").notNull().default(0),
  // ISO date string (YYYY-MM-DD) of the day the counter was last
  // updated. When the request date != this value, we reset count to 1
  // before checking the quota. Storing as text not timestamp because
  // we only care about calendar-day granularity, and YYYY-MM-DD
  // sorts/compares lexicographically.
  dailyRefreshDate: text("daily_refresh_date"),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// ─────────────────────────────────────────────────────────────────────────
// APP TABLES (not generated by Better Auth). PRESERVE these when re-running
// `npm run auth:schema` — that command regenerates everything above from
// auth.ts and would otherwise drop what follows. Re-paste this block back in.
// ─────────────────────────────────────────────────────────────────────────

// A "watch" keeps a session fresh and alerts on regressions. It points at a
// file-based session (lib/storage); the monitor re-sweeps that session when
// the repo's head SHA moves and diffs the new snapshot against the prior one.
// lastHeadSha drives the cheap change-detect (skip the sweep when unchanged);
// lastAlertedSha dedups so the same regression isn't alerted twice. v0.83+.
export const watch = sqliteTable("watch", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  /** Denormalized "owner/repo" so the watch list renders without loading
   *  every session file. */
  repoFullName: text("repo_full_name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastSweptAt: integer("last_swept_at", { mode: "timestamp" }),
  lastHeadSha: text("last_head_sha"),
  lastAlertedSha: text("last_alerted_sha"),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
});
