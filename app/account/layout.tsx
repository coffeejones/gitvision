// Auth gate for the whole /account/* route tree (v0.76 / D4).
//
// Redirects unauthenticated visitors to /login?next=/account so they
// land back here after signing in. Pages inside this layout can
// assume the caller is signed in (though they still re-read the
// session via getAuthSession() — React's cache() dedupes the call
// across layout + page in a single render).

import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/authSession";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAuthSession();
  if (!session) {
    redirect("/login?next=/account");
  }
  return <>{children}</>;
}
