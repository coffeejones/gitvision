// Server-side auth-session helper, deduped via React's cache().
//
// Why cache(): the /account/* route tree has a server-side layout
// gate (redirects unauthenticated users) AND each page reads the
// session to build the user object. Without cache(), that's two
// auth.api.getSession() calls per render. With cache(), the layout
// and the page share one underlying call — React dedupes on
// function identity within a single request render.
//
// Server-only — auth.api uses node:crypto.

import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "./auth";

export const getAuthSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});
