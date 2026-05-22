// Build the canonical AccountUser shape from a Better Auth session.
//
// Centralized so every /account/* page projects session.user the
// same way — name + email handled uniformly, emailVerified coerced
// to a strict boolean, createdAt always an ISO string for the
// client-side date formatter.
//
// AccountUser is the type passed into AccountShell + all per-section
// panels. Keep them in sync when adding new fields.

import type { auth } from "./auth";

type SessionMaybeNull = Awaited<ReturnType<typeof auth.api.getSession>>;
export type AuthSession = NonNullable<SessionMaybeNull>;

export interface AccountUser {
  id: string;
  name?: string | null;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  githubLogin?: string | null;
  /** ISO timestamp — client-side renders as a localized date. */
  createdAt: string;
}

export function userFromSession(session: AuthSession): AccountUser {
  const u = session.user;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified === true,
    image: u.image ?? null,
    githubLogin:
      (u as { githubLogin?: string | null }).githubLogin ?? null,
    createdAt:
      u.createdAt instanceof Date
        ? u.createdAt.toISOString()
        : String(u.createdAt),
  };
}
