// Anonymous owner-id stored in localStorage. Used to soft-isolate sessions:
// the landing page filters its session list to "yours + ownerless legacy",
// and mutating API endpoints (rename, delete, refresh) enforce that the
// caller owns the session.
//
// This is NOT authentication. There's no signup, no server-side identity,
// no encryption. Anyone with a session URL can read the session — sharing
// links still works. The only thing this prevents is "stranger sees your
// 47 sessions on the landing page".
//
// Pure client-side: no server-only deps. Safe to import from any "use
// client" component.

const STORAGE_KEY = "gv:owner-id";

/** Cookie name used to mirror the owner-id from localStorage so server
 *  components can read it during SSR. Lets app/page.tsx pick the
 *  workspace vs marketing layout server-side and avoid the post-
 *  hydration flash that happens when the decision lives in client
 *  state only. v0.69+. */
export const OWNER_ID_COOKIE = "gv_owner_id";

/** Mirror an owner-id into a cookie alongside localStorage. Cookies are
 *  the only client-state mechanism the Next.js server can read during
 *  page rendering. We use SameSite=Lax + 1-year max-age so the cookie
 *  survives across browser sessions. No HttpOnly flag because the
 *  client also reads it (the cookie is purely a server-side hint, not
 *  a security boundary). */
function mirrorOwnerIdToCookie(ownerId: string): void {
  if (typeof document === "undefined") return;
  try {
    const oneYearSec = 60 * 60 * 24 * 365;
    document.cookie =
      `${OWNER_ID_COOKIE}=${encodeURIComponent(ownerId)}; ` +
      `path=/; max-age=${oneYearSec}; SameSite=Lax`;
  } catch {
    /* document.cookie can throw in extremely-restricted contexts */
  }
}

/** Generate a v4-style UUID without depending on the Web Crypto API
 *  presence (older browsers, test environments). Pattern matches RFC 4122
 *  v4 — random bits with the version + variant nibbles in their fixed
 *  positions. */
function generateUuid(): string {
  // Prefer crypto.randomUUID when available — strongest entropy source
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback: Math.random-based. Adequate for our purposes (collision
  // would require enormous numbers of users; this isn't a security
  // boundary).
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      s += "-";
    } else if (i === 14) {
      s += "4"; // version 4
    } else if (i === 19) {
      s += hex[(Math.random() * 4) | 8]; // variant 10xx
    } else {
      s += hex[(Math.random() * 16) | 0];
    }
  }
  return s;
}

/** Read the stored owner-id, or generate + persist a fresh one if none
 *  exists. Also mirrors the value into a cookie so server components
 *  can read it during SSR (used by the home route to pick the
 *  workspace vs marketing layout without a post-hydration flash).
 *  Returns null on the server (where localStorage isn't available). */
export function getOrCreateOwnerId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.trim().length > 0) {
      // Re-mirror on every read so legacy users (pre-v0.69, no cookie
      // yet) populate the cookie on first home-page visit. After that,
      // SSR has the value and the flash goes away.
      mirrorOwnerIdToCookie(existing);
      return existing;
    }
    const fresh = generateUuid();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    mirrorOwnerIdToCookie(fresh);
    return fresh;
  } catch {
    // localStorage can throw in private-browsing modes / quota exceeded.
    // Generate an ephemeral id rather than blocking the user — they'll
    // get a new one each visit, which means their sessions become
    // "yours" only within a single browser session. Acceptable degradation.
    return generateUuid();
  }
}

/** Read the stored owner-id without generating one. Returns null when
 *  none is stored or we're on the server. Used by code that wants to
 *  know "have I seen this user before" rather than enforce identity. */
export function getOwnerId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    return existing && existing.trim().length > 0 ? existing : null;
  } catch {
    return null;
  }
}

/** Test helper — clear the stored id so subsequent calls regenerate.
 *  Exposed via the same module as getOrCreateOwnerId so tests can
 *  exercise both code paths without reaching into localStorage by name. */
export function _clearOwnerIdForTest(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** The header name we use to send the owner-id to the server. Both client
 *  and server-side code should reference this constant rather than hard-
 *  coding the string. */
export const OWNER_ID_HEADER = "X-Owner-Id";

/** Reserved owner-id for showcase / demo sessions (v0.52). Tagging a
 *  session with this id has two effects:
 *    1. It's hidden from every user's "Your sessions" list — landings
 *       stay clean for both first-time and returning visitors.
 *    2. It's read-only via the v0.26 ownership check on refresh /
 *       rename / delete: no caller's randomly-generated UUID will ever
 *       equal "demo", so the API rejects mutations from the public.
 *  Demo sessions remain reachable by URL — they're meant to be linked
 *  from the landing's "Try a demo" buttons or shared in launch posts. */
export const DEMO_OWNER_ID = "demo";

/** Pure filter helper: keep sessions that either have no ownerId
 *  (legacy, pre-v0.26) or whose ownerId matches the caller's. Pre-
 *  hydration the caller passes ownerId=null, in which case we still
 *  filter out demo sessions so the SSR first paint doesn't briefly
 *  flash showcase content into "Your sessions" before the client
 *  hydrates. Generic so it works with both Session and SessionSummary
 *  records.
 *
 *  Kept for backward compat — new callers should prefer
 *  filterSessionsByUser, which respects the userId field set on
 *  sessions created by logged-in users (v0.76+). */
export function filterSessionsByOwner<T extends { ownerId?: string }>(
  sessions: readonly T[],
  ownerId: string | null
): T[] {
  // Demo sessions are NEVER part of "Your sessions" regardless of
  // ownerId state — including on the SSR pre-hydration paint.
  const nonDemo = sessions.filter((s) => s.ownerId !== DEMO_OWNER_ID);
  if (!ownerId) return [...nonDemo];
  return nonDemo.filter((s) => !s.ownerId || s.ownerId === ownerId);
}

/** User-aware session filter (v0.76 — login-required model).
 *
 *  RepoBaron moved to "login required to create sessions" in v0.76.
 *  Anonymous browsing of a workspace listing no longer makes sense —
 *  if you're not signed in, you have no sessions to list. The
 *  marketing landing shows demo sessions as the "lokkemad"; the
 *  full workspace listing is gated.
 *
 *  Visibility rules:
 *    - Demo sessions (ownerId === "demo")  → always excluded from
 *                                            "Your sessions" listings.
 *                                            They appear separately as
 *                                            click-through cards on the
 *                                            marketing landing.
 *    - Logged-in caller (userId provided):
 *        - Sessions with matching userId  → visible
 *        - Legacy ownerless sessions     → visible (pre-v0.26 open
 *          (neither userId nor ownerId)    sessions, kept "open"
 *                                          for backward compat)
 *        - ownerId-only sessions         → invisible. They were
 *          (no userId)                     created anonymously before
 *                                          v0.76 and have no account
 *                                          to claim them. Direct URL
 *                                          still works for sharing,
 *                                          but they don't surface in
 *                                          the workspace listing.
 *    - Logged-out caller (userId null):
 *        - Returns []. Workspace is gated behind sign-in.
 *
 *  Generic so it works with both Session and SessionSummary. */
export function filterSessionsByUser<
  T extends { ownerId?: string; userId?: string },
>(sessions: readonly T[], userId: string | null): T[] {
  if (!userId) return [];
  const nonDemo = sessions.filter((s) => s.ownerId !== DEMO_OWNER_ID);
  return nonDemo.filter((s) => {
    // Strong claim: account-bound session — only the owner.
    if (s.userId) return s.userId === userId;
    // Legacy open (pre-v0.26, no fields set) — visible to any
    // logged-in user. Pre-existing posture.
    if (!s.ownerId) return true;
    // ownerId-only sessions (pre-v0.76 anonymous): invisible from
    // workspace listings now that anonymous creation is removed.
    return false;
  });
}
