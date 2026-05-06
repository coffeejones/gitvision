// Server-side owner-id helpers (v0.69 polish).
//
// Lives separately from lib/ownerId.ts so that browser-safe client
// components can keep importing the localStorage path without
// dragging next/headers into the client bundle.
//
// next/headers is server-only; importing it in a "use client" tree
// fails the production build. Splitting the read path here keeps
// the layering clean: client = localStorage + cookie write, server =
// cookie read.

import { cookies } from "next/headers";
import { OWNER_ID_COOKIE } from "./ownerId";

/** Read the owner-id from the request cookies during a server-side
 *  render. Returns null when no cookie is set (first-time visitor or
 *  legacy user pre-v0.69). The home route uses this to pre-decide
 *  whether to render the workspace dashboard or the marketing
 *  landing — eliminating the post-hydration flash you'd otherwise
 *  get when the decision lives in client state only. */
export async function getOwnerIdFromCookies(): Promise<string | null> {
  try {
    const store = await cookies();
    const value = store.get(OWNER_ID_COOKIE)?.value;
    if (!value || value.trim().length === 0) return null;
    return decodeURIComponent(value);
  } catch {
    // Reading cookies can throw in static-render contexts. Treat as
    // "no owner-id known" — caller falls back to the safe default.
    return null;
  }
}
