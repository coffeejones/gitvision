// /account — redirect to /account/general (v0.76 / D4).
//
// Previously this page rendered the monolithic AccountPage component.
// In D4 we split account settings into four separate routes
// (general / security / connections / danger) for proper enterprise
// navigation. /account itself just bounces to General as the default
// landing.
//
// Auth gate lives in app/account/layout.tsx — by the time this file
// renders, the visitor is signed in.

import { redirect } from "next/navigation";

export default function AccountIndex() {
  redirect("/account/general");
}
