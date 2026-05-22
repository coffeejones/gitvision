// /account/connections — OAuth provider links (v0.76 / D4).

import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/authSession";
import { userFromSession } from "@/lib/userFromSession";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { AccountShell } from "@/components/AccountShell";
import { ConnectionsPanel } from "@/components/account/ConnectionsPanel";

export const metadata = {
  title: "Connections — Account — RepoBaron",
  description: "Link external accounts for one-click sign-in.",
};

export default async function ConnectionsPage() {
  const session = await getAuthSession();
  if (!session) redirect("/login?next=/account/connections");

  const accountRows = await db
    .select({
      id: schema.account.id,
      providerId: schema.account.providerId,
      accountId: schema.account.accountId,
      hasPassword: schema.account.password,
    })
    .from(schema.account)
    .where(eq(schema.account.userId, session.user.id));

  const accounts = accountRows.map((r) => ({
    id: r.id,
    providerId: r.providerId,
    accountId: r.accountId,
    hasPassword: r.hasPassword !== null,
  }));

  const hasPassword = accounts.some(
    (a) => a.providerId === "credential" && a.hasPassword
  );
  const githubAccount = accounts.find((a) => a.providerId === "github") ?? null;
  const signInMethodCount = (hasPassword ? 1 : 0) + (githubAccount ? 1 : 0);
  const user = userFromSession(session);

  return (
    <AccountShell
      user={user}
      hasPassword={hasPassword}
      hasGithub={!!githubAccount}
    >
      <ConnectionsPanel
        githubAccount={githubAccount}
        githubLogin={user.githubLogin ?? null}
        signInMethodCount={signInMethodCount}
      />
    </AccountShell>
  );
}
