// /pr-bot — the RepoJury PR-bot surface. Resolves the Chambers sidebar's
// "PR-bot" nav item (previously a 404). Reuses PRBotCallout — the same
// medium-depth explainer + tier-aware install/upgrade CTA shown at the
// bottom of a session's PRs tab — so there's one source of truth for the
// bot's pitch. Standalone TOK-themed page (matching /help, /pricing) with
// a back link to the workspace; a fuller in-shell "gate status" surface
// can come later.

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { getUserTier } from "@/lib/billing/gates";
import { PRBotCallout } from "@/components/views/PRBotCallout";
import { TOK } from "@/lib/theme";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "PR-bot — RepoJury",
  description:
    "RepoJury-PR: one grounded review comment on every pull request. Same deterministic signal layer as the workspace, zero LLM cost.",
};

export default async function PRBotPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const tier = session?.user ? await getUserTier(session.user.id) : "open-case";

  return (
    <main
      className="min-h-screen"
      style={{ background: TOK.bg, color: TOK.textPrimary }}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10 sm:px-10 sm:py-14">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1.5 text-sm transition hover:underline"
          style={{ color: TOK.textMuted }}
        >
          <ArrowLeft size={14} />
          Back to workspace
        </Link>
        <PRBotCallout userTier={tier} />
      </div>
    </main>
  );
}
