// /news — product updates. Resolves the Chambers sidebar's "News" nav
// item (previously a 404). Reuses the Roadmap section ("What's new" +
// "What's coming") so the shipped/upcoming list has one source of truth
// shared with the marketing landing. Standalone TOK-themed page (matching
// /help, /pricing) with a back link to the workspace.

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Roadmap } from "@/components/Roadmap";
import { TOK } from "@/lib/theme";

export const metadata: Metadata = {
  title: "News — RepoJury",
  description: "What's new in RepoJury, and what's coming next.",
};

export default function NewsPage() {
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
        <Roadmap />
      </div>
    </main>
  );
}
