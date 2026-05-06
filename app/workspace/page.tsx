// /workspace — back-compat redirect (v0.69+).
//
// The workspace dashboard merged into the home route in v0.69 —
// MarketingHome / WorkspaceHome both live behind "/" now and
// AdaptiveHome picks based on owned-sessions count. Bookmarks and
// older shared links pointing here keep working via this redirect.

import { redirect } from "next/navigation";

export default function WorkspaceRedirect() {
  redirect("/");
}
