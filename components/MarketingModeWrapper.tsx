"use client";

// Hides children when the current URL has `?marketing=1` —
// used by the session layout to drop the top toolbar (Share /
// Refresh / Feedback / overflow) so we can take clean screenshots
// of session pages for marketing assets.
//
// Why a client component: layouts can't read searchParams in Next 16.
// We push the "read query param" logic to a small client wrapper.
//
// Usage:
//   <HideOnMarketing>
//     <SessionToolbar ... />
//   </HideOnMarketing>
//
// The sidebar stays visible — it actually adds product credibility
// in screenshots ("see, we have multiple tabs"). Only the top
// toolbar gets hidden, since its buttons (Share, Refresh) are
// session-management chrome that distracts from analysis content.

import { useSearchParams } from "next/navigation";

export function HideOnMarketing({ children }: { children: React.ReactNode }) {
  const params = useSearchParams();
  if (params.get("marketing") === "1") return null;
  return <>{children}</>;
}
