// /legal — redirect to /privacy (Phase P).
//
// This route used to host a single combined Privacy+Terms page written
// for an earlier, anonymous version of the product. That text became
// materially untrue once accounts, email, IP logging, GitHub tokens,
// and billing were added — so it was retired and replaced by the four
// dedicated documents (/privacy, /terms, /cookies, /refunds). This
// redirect keeps old links and footer references working.

import { redirect } from "next/navigation";

export default function LegalRedirect() {
  redirect("/privacy");
}
