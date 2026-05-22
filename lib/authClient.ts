"use client";

// Better Auth — client-side helper (v0.75).
//
// Mirror of lib/auth.ts for browser code. Wraps Better Auth's React
// client so components can call:
//
//   authClient.signIn.email({ email, password })
//   authClient.signIn.social({ provider: "github" })
//   authClient.signUp.email({ email, password, name })
//   authClient.signOut()
//   authClient.useSession()  // hook
//
// Why a separate file: the React client must never be imported from
// Server Components (it pulls in browser-only deps). Keeping it
// isolated in its own "use client" module makes import errors loud
// and obvious if a server file accidentally reaches for it.
//
// `inferAdditionalFields` plugin teaches the client about our custom
// user.githubLogin column so TypeScript autocomplete works end-to-end
// (session.user.githubLogin is typed `string | undefined | null`).

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "./auth";

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
