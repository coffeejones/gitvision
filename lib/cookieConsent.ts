// Cookie consent state (Phase P follow-up).
//
// CodeTrawl's storage splits into two buckets:
//
//   - Essential — the auth session cookie (you can't be logged in
//     without it) and storage strictly needed for an action the user
//     explicitly asked for (e.g. pending-repo, which resumes the exact
//     analysis they requested before signing up). These are exempt
//     from consent under the ePrivacy "strictly necessary" carve-out.
//   - Functional — small conveniences (the first-visit hint, the
//     owner-id workspace filter). These only run if the user accepts.
//
// The banner (CookieNotice) writes the choice here; functional-storage
// call sites read hasFunctionalConsent() before writing, so "Decline"
// actually suppresses functional storage rather than being theater.
//
// Today there's no analytics/tracking at all. If that's added later,
// it belongs behind this same gate (and the banner copy must change to
// name it explicitly).

export type ConsentState = "accepted" | "declined" | null;

const KEY = "rj:cookie-consent";

/** Read the stored choice. null = the user hasn't decided yet (show
 *  the banner). Safe on the server / in private mode (returns null). */
export function getConsent(): ConsentState {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "accepted" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

/** Persist the user's choice. */
export function setConsent(state: "accepted" | "declined"): void {
  try {
    window.localStorage.setItem(KEY, state);
  } catch {
    /* localStorage blocked — the choice just won't persist */
  }
}

/** True only when the user has actively accepted. Functional-storage
 *  call sites gate on this so "Decline" (and the undecided state)
 *  suppress non-essential writes. */
export function hasFunctionalConsent(): boolean {
  return getConsent() === "accepted";
}
