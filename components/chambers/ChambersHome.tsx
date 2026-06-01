// ChambersHome — the real post-login home (the "Cases" view inside the
// app shell). Server component: takes the user's projected cases +
// identity, splits them by visibility for the Public / Private tabs,
// and composes the sticky-sidebar shell. Rendered from app/page.tsx for
// signed-in users with cases.

import { ChambersShell } from "./ChambersShell";
import { CasesView } from "./CasesView";
import type { CaseItem } from "./CaseRow";

interface Props {
  cases: CaseItem[];
  user: {
    name?: string | null;
    username?: string | null;
    tierName: string;
    paid: boolean;
  };
}

export function ChambersHome({ cases, user }: Props) {
  const publicCases = cases.filter((c) => !c.isPrivate);
  const privateCases = cases.filter((c) => c.isPrivate);

  return (
    <ChambersShell active="cases" user={user}>
      <CasesView publicCases={publicCases} privateCases={privateCases} />
    </ChambersShell>
  );
}
