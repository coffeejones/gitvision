// Better Auth — catch-all API route (v0.75).
//
// Handles every /api/auth/* endpoint Better Auth exposes:
//   /api/auth/sign-in/email
//   /api/auth/sign-up/email
//   /api/auth/sign-out
//   /api/auth/sign-in/social        (GitHub OAuth init)
//   /api/auth/callback/github       (OAuth callback)
//   /api/auth/get-session
//   ...etc.
//
// `toNextJsHandler` adapts Better Auth's framework-agnostic handler to
// Next.js's GET/POST exports. We don't need to write per-endpoint
// routes; one catch-all is all Better Auth wants.

import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
