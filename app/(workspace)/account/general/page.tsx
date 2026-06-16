// /account/general — Profile basics (v0.76 / D4).
//
// Server Component. Reads the session for hero + general info, then
// hands off to the GeneralPanel client component for the editable
// bits.

import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/authSession";
import { userFromSession } from "@/lib/userFromSession";
import { SettingsShell } from "@/components/account/SettingsShell";
import { GeneralPanel } from "@/components/account/GeneralPanel";

export const metadata = {
  title: "General — Account — CodeTrawl",
  description: "Your profile basics.",
};

export default async function GeneralPage() {
  const session = await getAuthSession();
  if (!session) redirect("/login?next=/account/general");

  const user = userFromSession(session);

  return (
    <SettingsShell user={user}>
      <GeneralPanel user={user} />
    </SettingsShell>
  );
}
