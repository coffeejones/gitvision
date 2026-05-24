// Resolve a user's GitHub OAuth access token from the Better Auth
// `account` table (v0.81+).
//
// Used by analyzeRepo (via runCreateSession / runRefreshSession) to
// scope GitHub API calls to the requesting user — giving each user
// their own 5000 req/hr rate-limit budget and, when the token was
// issued with the `repo` scope, access to their private repositories.
//
// Stored token comes from the Better Auth GitHub OAuth flow:
//   user clicks "Continue with GitHub" → GitHub redirects with code →
//   Better Auth exchanges code for token → token written to
//   account.accessToken where providerId === "github".
//
// Returns null when:
//   - userId is null/undefined (anonymous caller, e.g. a webhook job)
//   - No GitHub account is linked to the user (signed up via
//     email/password and hasn't clicked "Connect GitHub")
//   - The account row exists but has no accessToken stored (rare
//     defensive case; would mean Better Auth completed the OAuth
//     flow without persisting the token)
//
// Callers must treat null as "fall back to server-side GITHUB_TOKEN".
// The fallback chain is implemented in lib/github.ts — analyzeRepo
// constructs a user-scoped Octokit only when this returns non-null.
//
// Kept in a separate file from lib/github.ts so the pure API client
// doesn't grow a DB dependency. Server-only — must never be imported
// from a Client Component.

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Look up the stored GitHub OAuth access token for the given user.
 *  See module header for the full contract. */
export async function getGithubTokenForUser(
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  const rows = await db
    .select({ accessToken: schema.account.accessToken })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, "github"),
      ),
    )
    .limit(1);
  return rows[0]?.accessToken ?? null;
}

/** Inspect the OAuth scopes that GitHub actually granted to the user's
 *  stored token (v0.81+). Used by /account/connections to decide whether
 *  to show the "Re-authorize for private repos" CTA — when `repo` is
 *  already in the granted-scopes list, the prompt would just be noise.
 *
 *  GitHub returns the granted scopes in the `X-OAuth-Scopes` response
 *  header on any authenticated request (we hit /user as the cheapest
 *  call available). This is the only reliable way to know what the
 *  token can do — Better Auth stores the token blob but not its
 *  scopes, and the scopes config in lib/auth.ts is only the REQUESTED
 *  scope set (a user could have authorized a subset, or pre-dated
 *  the v0.81 expansion when only read:user / user:email were asked
 *  for).
 *
 *  Returns:
 *    - string[] when the call succeeded — the array of granted scopes
 *      (may be empty for tokens issued without any scopes, e.g. legacy)
 *    - null when no token exists for the user OR the call failed
 *      (network error, revoked token, etc.). Caller should treat null
 *      conservatively — show the Re-authorize CTA, since we couldn't
 *      confirm the user already has scope. */
export async function getGithubScopesForUser(
  userId: string | null | undefined,
): Promise<string[] | null> {
  const token = await getGithubTokenForUser(userId);
  if (!token) return null;

  try {
    // /user is the canonical "am I authenticated" probe — minimum
    // permission required, returns quickly, no rate-limit concern
    // (cached by GitHub's edge for this purpose).
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "RepoBaron/0.1",
      },
      // Cache for 60s — scope changes require user action (OAuth flow),
      // so even minute-stale data is fine for a UX hint. Avoids
      // hammering GitHub on every /account/connections page-load.
      next: { revalidate: 60 },
    });

    if (!response.ok) return null;

    // Header value looks like: "repo, read:user, user:email" (comma-
    // separated, with optional whitespace). Empty when the token has
    // no scopes (rare — legacy unauthenticated-looking tokens).
    const scopesHeader = response.headers.get("x-oauth-scopes");
    if (!scopesHeader) return [];

    return scopesHeader
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    // Network error, DNS issue, token revoked — caller treats null
    // as "couldn't confirm, show Re-authorize CTA as the safe default".
    return null;
  }
}

/** Convenience: does the user's stored token include the `repo` scope?
 *  Used by ConnectionsPanel to decide whether to surface the private-
 *  repo Re-authorize CTA. Treats null (unknown / probe failed) as
 *  false — show the CTA conservatively. */
export async function userHasRepoScope(
  userId: string | null | undefined,
): Promise<boolean> {
  const scopes = await getGithubScopesForUser(userId);
  return scopes?.includes("repo") ?? false;
}
