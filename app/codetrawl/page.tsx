// /codetrawl — back-compat redirect.
//
// This was the sandbox route where the CodeTrawl landing was built on the
// feat/codetrawl-landing branch, kept noindex while it lived alongside the old
// home at "/". CodeTrawl is now the root experience (see app/page.tsx), so this
// redirects to "/" to avoid serving duplicate content. Kept so any links shared
// during the preview phase keep working. (The no-login demo at
// /codetrawl/workspace still lives under this path.)

import { redirect } from "next/navigation";

export default function CodeTrawlRedirect() {
  redirect("/");
}
