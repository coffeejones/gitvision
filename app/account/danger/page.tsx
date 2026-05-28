// /account/danger — destructive account actions (v0.76 / D4).
//
// Currently only Delete account as Coming soon. Kept as a dedicated
// route so it has a stable URL when we wire up the actual deletion
// + confirmation flow.

import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/authSession";
import { userFromSession } from "@/lib/userFromSession";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { AccountShell } from "@/components/AccountShell";
import { DangerPanel } from "@/components/account/DangerPanel";

export const metadata = {
  title: "Danger zone — Account — RepoJury",
  description: "Permanent account actions.",
};

export default async function DangerPage() {
  const session = await getAuthSession();
  if (!session) redirect("/login?next=/account/danger");

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
    <AccountShell user={user} hasPassword={hasPassword} hasGithub={hasGithub}>
      <DangerPanel />
    </AccountShell>
  );
}
