"use client";

// Sticky top nav for the marketing landing (v0.75 / OAuth platform).
//
// Reads the session via Better Auth's `useSession()` hook so it
// re-renders reactively when the user logs in/out (e.g. after the
// UserDropdown's "Log out" or completing a signup flow) without a
// full page reload.
//
// Why a Client Component and not a Server Component with `await
// auth.api.getSession(...)`: this nav is imported by WorkspaceHome,
// which is itself a Client Component (`"use client"`). Server
// Components can't be imported from Client Components, so going async
// here would break the WorkspaceHome import chain. The trade-off:
// we accept a brief "logged-out flash" for returning users while
// useSession() fetches, since the initial server-rendered HTML has
// no session data. In practice this is ~100–200ms and only affects
// already-logged-in users.
//
// Lives at the top of MarketingHome AND WorkspaceHome (both surfaces
// share it). The WorkspaceHome usage was the reason we removed the
// separate sidebar nav back in v0.72.
//
// Visual hierarchy in the right-hand cluster (logged-out):
//   Sign up   = off-white filled button (textPrimary on bg) — strongest
//               CTA. Linear/Stripe pattern: contrast does the work,
//               not color. Matches the body-CTA so the page reads as
//               one design system, not two.
//   Feedback  = ghost-bordered pill — neutral border + secondary
//               text, no accent fill. The accent-green version
//               competed with the body-CTA and made the nav look
//               like a different surface.
//   Log in    = ghost link — quiet, for returning users
//   GitHub / PR-bot / What's new = subtle secondary links
//
// Logged-in state replaces Log in + Sign up with the UserDropdown
// (avatar + menu). Feedback pill stays — feedback shouldn't require
// an account.

import Link from "next/link";
import { ArrowUpRight, MessageSquare } from "lucide-react";
import { TOK } from "@/lib/theme";
import { authClient } from "@/lib/authClient";
import { FeedbackLink } from "@/components/FeedbackLink";
import { Logo } from "@/components/Logo";
import { UserDropdown } from "@/components/UserDropdown";

export function MarketingNav() {
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user ?? null;

  return (
    <header
      className="sticky top-0 z-50"
      style={{
        // 70% TOK.bg = rgba(20,20,27,0.7) so the gradient + content
        // underneath bleeds through enough to look "glassy" once the
        // backdrop blur runs over it. Border-bottom is so subtle it
        // only shows once a user has scrolled past the hero, separating
        // the bar from the content below.
        backgroundColor: "rgba(20,20,27,0.7)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: `1px solid ${TOK.border}`,
      }}
    >
      <div className="max-w-7xl mx-auto px-6 sm:px-10 lg:px-12 h-14 flex items-center justify-between">
        {/* Logo — home anchor. */}
        <Link
          href="/"
          className="flex items-center transition opacity-90 hover:opacity-100"
        >
          <Logo size={30} wordmark />
        </Link>

        {/* Right-hand nav cluster. Secondary links collapse on phone
         *  widths to make room for the auth CTAs. */}
        <nav className="flex items-center gap-0.5 sm:gap-2">
          {/* Hidden on phones — secondary nav links. */}
          <a
            href="#roadmap"
            className="hidden md:inline-flex items-center px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm transition hover:bg-white/5"
            style={{ color: TOK.textSecondary }}
          >
            What&apos;s new
          </a>
          <a
            href="https://github.com/apps/repobaron-pr"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm transition hover:bg-white/5"
            style={{ color: TOK.textSecondary }}
          >
            PR-bot
            <ArrowUpRight size={12} />
          </a>
          <a
            href="https://github.com/coffeejones/repobaron"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm transition hover:bg-white/5"
            style={{ color: TOK.textSecondary }}
          >
            GitHub
            <ArrowUpRight size={12} />
          </a>

          {/* Feedback CTA — ghost pill (subtle border, secondary
           *  text). Still distinguishable from plain links because
           *  it carries a border, but no longer competes with the
           *  Sign-up CTA on color. Beta-emphasis comes from the icon
           *  + dedicated pill shape, not from green-on-green. */}
          <FeedbackLink
            className="hidden sm:inline-flex items-center gap-1.5 ml-1 px-3 py-1.5 rounded-md text-xs sm:text-sm transition hover:bg-white/5 cursor-pointer"
            style={{
              color: TOK.textSecondary,
              border: `1px solid rgba(255, 255, 255, 0.1)`,
            }}
          >
            <MessageSquare size={12} />
            Feedback
          </FeedbackLink>

          {/* Auth slot. While the session is still being fetched
           *  client-side, render nothing (just a placeholder spacer)
           *  to avoid a layout shift between "Log in / Sign up"
           *  flashing in and then being replaced by the dropdown. */}
          {isPending ? (
            <div className="ml-1 sm:ml-2 w-[80px] h-8" aria-hidden />
          ) : user ? (
            <div className="ml-1 sm:ml-2">
              <UserDropdown
                user={{
                  id: user.id,
                  name: user.name,
                  email: user.email,
                  image: user.image ?? null,
                  githubLogin:
                    (user as { githubLogin?: string | null }).githubLogin ??
                    null,
                }}
              />
            </div>
          ) : (
            <>
              {/* Log in — ghost link, low visual weight. Hidden on
               *  the smallest phones; "Sign up" is the primary CTA
               *  and Log in is reachable from there anyway. */}
              <Link
                href="/login"
                className="hidden sm:inline-flex items-center px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm transition hover:bg-white/5"
                style={{ color: TOK.textSecondary }}
              >
                Log in
              </Link>
              {/* Sign up — off-white filled button, strongest CTA.
               *  Always visible. Matches the body Sign-up CTA so the
               *  whole page reads as one design system. */}
              <Link
                href="/signup"
                className="inline-flex items-center ml-1 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition hover:opacity-90"
                style={{
                  background: TOK.textPrimary,
                  color: TOK.bg,
                }}
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
