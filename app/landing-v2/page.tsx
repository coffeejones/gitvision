// /landing-v2 — back-compat redirect (Phase R).
//
// The CodeTrawl landing was previewed here while it lived alongside the
// old home at "/". It's now the root experience for marketing visitors
// (see app/page.tsx), so this route redirects to "/" to avoid serving
// duplicate content. Kept so any links shared during the preview phase
// keep working.

import { redirect } from "next/navigation";

export default function LandingV2Redirect() {
  redirect("/");
}
