// /account/general — Profile basics (v0.76 / D4).
//
// Server Component. Reads the session for hero + general info, then
// hands off to the GeneralPanel client component for the editable
// bits.

import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/authSession";
import { userFromSession } from "@/lib/userFromSession";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { SettingsShell } from "@/components/account/SettingsShell";
import { GeneralPanel } from "@/components/account/GeneralPanel";

export const metadata = {
  title: "General — Account — RepoJury",
  description: "Your profile basics.",
};

export default async function GeneralPage() {
  const session = await getAuthSession();
  if (!session) redirect("/login?next=/account/general");

  // Pull the user's accounts list once so the hero can show "Password"
  // + "GitHub" badges in the signed-in-via line. Pages that actually
  // mutate accounts (Security, Connections) re-fetch and use the
  // full data; this page only needs the existence flags.
  const accountRows = await db
    .select({
      providerId: schema.account.providerId,
      hasPassword: schema.account.password,
    })
    .from(schema.account)
    .where(eq(schema.account.userId, session.user.id));

  const hasPassword = accountRows.some(
    (r) => r.providerId === "credential" && r.hasPassword !== null
  );
  const hasGithub = accountRows.some((r) => r.providerId === "github");
  const user = userFromSession(session);

  return (
    <SettingsShell user={user} hasPassword={hasPassword} hasGithub={hasGithub}>
      <GeneralPanel user={user} />
    </SettingsShell>
  );
}
