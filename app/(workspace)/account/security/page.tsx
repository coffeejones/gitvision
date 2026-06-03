// /account/security — Password + email verification + sessions
// (v0.76 / D4).

import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/authSession";
import { userFromSession } from "@/lib/userFromSession";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { SettingsShell } from "@/components/account/SettingsShell";
import { SecurityPanel } from "@/components/account/SecurityPanel";

export const metadata = {
  title: "Security — Account — RepoJury",
  description: "Manage your password and sign-in security.",
};

export default async function SecurityPage() {
  const session = await getAuthSession();
  if (!session) redirect("/login?next=/account/security");

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
      <SecurityPanel user={user} hasPassword={hasPassword} />
    </SettingsShell>
  );
}
