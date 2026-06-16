// /news — product updates inside the Chambers shell.

import type { Metadata } from "next";
import { NewsView } from "@/components/chambers/NewsView";

export const metadata: Metadata = {
  title: "News — CodeTrawl",
  description: "What's new in CodeTrawl, and what's coming next.",
};

export default function NewsPage() {
  return <NewsView />;
}
