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
 *  exists. Returns null on the server (where localStorage isn't available)
 *  — server-rendered code shouldn't depend on owner-id; the landing page
 *  filters client-side after hydration. */
export function getOrCreateOwnerId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.trim().length > 0) return existing;
    const fresh = generateUuid();
    window.localStorage.setItem(STORAGE_KEY, fresh);
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

/** Pure filter helper: keep sessions that either have no ownerId
 *  (legacy, pre-v0.26) or whose ownerId matches the caller's. Pre-
 *  hydration the caller passes ownerId=null, in which case we don't
 *  filter at all (server-rendered first paint shows everything;
 *  client narrows the list once localStorage is read). Generic so it
 *  works with both Session and SessionSummary records. */
export function filterSessionsByOwner<T extends { ownerId?: string }>(
  sessions: readonly T[],
  ownerId: string | null
): T[] {
  if (!ownerId) return [...sessions];
  return sessions.filter((s) => !s.ownerId || s.ownerId === ownerId);
}
