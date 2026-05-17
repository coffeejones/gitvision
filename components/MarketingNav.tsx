// Sticky top nav for the marketing landing (v0.72 / depth-pass).
//
// Lives at the top of MarketingHome only. WorkspaceHome has its
// own sidebar-based navigation pattern and doesn't need this.
//
// Design intent:
//   - Sticky so it's always reachable while scrolling the long
//     marketing page
//   - Backdrop blur over the page's ambient gradient so the bar
//     reads as glass, not flat paint
//   - Mobile: collapses to Logo + GitHub only. Anchor-links are
//     less useful on small screens where the page scrolls fast
//     anyway, and trying to fit 4 items kills the breathing room
//   - Future-proof: easy slot for Pricing, Sign-in, Docs as the
//     SaaS surface grows
//
// "What's new" is an in-page anchor (#roadmap) — both MarketingHome
// and WorkspaceHome render the Roadmap section so this anchor works
// consistently on either surface.
//
// "PR-bot" points to the GitHub install URL directly (external,
// opens new tab). The marketing-side "Two surfaces" section still
// exists for visitors who scroll there organically, but the nav
// shortcut goes straight to the install screen — that's the action
// most likely to be valuable when someone clicks the nav link.

import Link from "next/link";
import { ArrowUpRight, MessageSquare } from "lucide-react";
import { TOK } from "@/lib/theme";
import { FeedbackLink } from "@/components/FeedbackLink";
import { Logo } from "@/components/Logo";

export function MarketingNav() {
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
      <div className="max-w-6xl mx-auto px-6 sm:px-10 lg:px-16 h-14 flex items-center justify-between">
        {/* Logo — home anchor. Reduced size from the previous in-hero
         *  treatment because nav-bar context naturally calls for a
         *  smaller mark. */}
        <Link
          href="/"
          className="flex items-center transition opacity-90 hover:opacity-100"
        >
          <Logo size={22} wordmark />
        </Link>

        {/* Links — all three always visible. Labels are short enough
         *  ("What's new", "PR-bot", "GitHub") to fit even on phone-
         *  width viewports. If we add more items later (Pricing,
         *  Sign-in, Docs) we'll revisit a hamburger pattern then. */}
        <nav className="flex items-center gap-0.5 sm:gap-2">
          <a
            href="#roadmap"
            className="inline-flex items-center px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm transition hover:bg-white/5"
            style={{ color: TOK.textSecondary }}
          >
            What&apos;s new
          </a>
          <a
            href="https://github.com/apps/gitvision-pr"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm transition hover:bg-white/5"
            style={{ color: TOK.textSecondary }}
          >
            PR-bot
            <ArrowUpRight size={12} />
          </a>
          <a
            href="https://github.com/coffeejones/gitvision"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm transition hover:bg-white/5"
            style={{ color: TOK.textSecondary }}
          >
            GitHub
            <ArrowUpRight size={12} />
          </a>
          {/* Feedback CTA — emphasized during early beta with an
           *  accent-bordered pill instead of a plain link, so testers
           *  see "we want your feedback" before they even scroll. */}
          <FeedbackLink
            className="inline-flex items-center gap-1.5 ml-1 px-3 py-1.5 rounded-md text-xs sm:text-sm transition hover:opacity-80 cursor-pointer"
            style={{
              color: TOK.accent,
              border: `1px solid ${TOK.accent}`,
              background: TOK.accentSoft,
            }}
          >
            <MessageSquare size={12} />
            Feedback
          </FeedbackLink>
        </nav>
      </div>
    </header>
  );
}
