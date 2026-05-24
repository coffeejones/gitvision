"use client";

// Connections settings — GitHub link/unlink + Google placeholder
// (v0.76 / D4).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link as LinkIcon, Unlink, Mail, ShieldCheck } from "lucide-react";
import { TOK } from "@/lib/theme";
import { authClient } from "@/lib/authClient";
import { GithubIcon } from "@/components/GithubIcon";
import {
  ComingSoonBadge,
  FlashBanner,
  Row,
  RowAction,
  SectionCard,
  type Flash,
} from "@/components/account/_primitives";

interface Account {
  id: string;
  providerId: string;
  accountId: string;
  hasPassword: boolean;
}

interface Props {
  githubAccount: Account | null;
  githubLogin: string | null;
  signInMethodCount: number;
  /** Whether the user's stored GitHub OAuth token actually has the
   *  `repo` scope granted (queried server-side via GitHub's
   *  X-OAuth-Scopes response header). When true, the panel shows a
   *  "Private repos: access granted" status; when false, it shows
   *  the Re-authorize CTA. v0.81+. */
  hasRepoScope: boolean;
}

export function ConnectionsPanel({
  githubAccount,
  githubLogin,
  signInMethodCount,
  hasRepoScope,
}: Props) {
  const router = useRouter();
  const [flash, setFlash] = useState<Flash>({ kind: "none" });
  const [busy, setBusy] = useState<null | "link" | "unlink" | "reauth">(null);

  const connected = !!githubAccount;
  const wouldLockOut = connected && signInMethodCount <= 1;

  function showSuccess(message: string) {
    setFlash({ kind: "success", message });
    setTimeout(() => setFlash({ kind: "none" }), 4000);
    router.refresh();
  }
  function showError(message: string) {
    setFlash({ kind: "error", message });
  }

  async function handleConnect() {
    if (busy) return;
    setBusy("link");
    try {
      await authClient.linkSocial({
        provider: "github",
        callbackURL: "/account/connections",
      });
    } catch {
      showError("Couldn't connect GitHub. Try again.");
      setBusy(null);
    }
  }

  async function handleReauthorize() {
    if (busy) return;
    setBusy("reauth");
    try {
      // Re-runs the GitHub OAuth flow against the currently-linked
      // account. Better Auth refreshes the access token using the
      // app's current `scope` config (lib/auth.ts → ["read:user",
      // "user:email", "repo"]), so users who signed up before v0.81
      // — and therefore have a legacy token without `repo` scope —
      // get an upgraded token after this completes. Callers who
      // already have full scope get a fresh token, which is harmless.
      await authClient.linkSocial({
        provider: "github",
        callbackURL: "/account/connections?reauth=ok",
      });
    } catch {
      showError("Couldn't re-authorize GitHub. Try again.");
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    if (busy) return;
    if (wouldLockOut) {
      showError(
        "Set a password first — GitHub is currently your only sign-in method."
      );
      return;
    }
    setBusy("unlink");
    try {
      const result = await authClient.unlinkAccount({ providerId: "github" });
      if (result.error) {
        showError(result.error.message ?? "Couldn't disconnect GitHub.");
        return;
      }
      showSuccess("GitHub disconnected.");
    } catch {
      showError("Network error. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <FlashBanner flash={flash} onClose={() => setFlash({ kind: "none" })} />
      <SectionCard
        title="Connections"
        description="Sign in faster by linking external accounts."
      >
        <Row
          label="GitHub"
          description={
            connected
              ? githubLogin
                ? `Connected as @${githubLogin}.`
                : "Connected."
              : "Not connected. Click Connect to link your GitHub for one-click sign-in."
          }
          value={
            <span
              className="inline-flex items-center gap-2"
              style={{ color: TOK.textSecondary }}
            >
              <GithubIcon size={14} />
              <span className="hidden sm:inline">
                {connected ? "Connected" : "Not connected"}
              </span>
            </span>
          }
          action={
            connected ? (
              <RowAction
                onClick={handleDisconnect}
                disabled={busy !== null || wouldLockOut}
              >
                {busy === "unlink" ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Unlink size={11} />
                )}
                {busy === "unlink" ? "Disconnecting…" : "Disconnect"}
              </RowAction>
            ) : (
              <RowAction onClick={handleConnect} disabled={busy !== null}>
                {busy === "link" ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <LinkIcon size={11} />
                )}
                {busy === "link" ? "Connecting…" : "Connect"}
              </RowAction>
            )
          }
        />
        {wouldLockOut && (
          <div
            className="flex items-start gap-2 mt-2 mb-1 rounded-md px-3 py-2 text-xs"
            style={{
              background: `${TOK.amber}0d`,
              border: `1px solid ${TOK.amber}40`,
              color: TOK.amber,
            }}
          >
            <Mail size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>
              Set a password under Security before disconnecting — it&rsquo;s
              your only way to sign in right now.
            </span>
          </div>
        )}
        {/* Private-repo access sub-row (v0.81+). Two states:
         *
         *    hasRepoScope=true   → "Access granted" status, no CTA.
         *                          (The Disconnect button above is still
         *                          available if the user wants to revoke
         *                          entirely. Re-running OAuth here would
         *                          be noise.)
         *    hasRepoScope=false  → "Re-authorize" CTA. Re-running the
         *                          OAuth flow refreshes the stored access
         *                          token against the current `scope`
         *                          config in lib/auth.ts, so users with
         *                          legacy tokens (no `repo` scope) can
         *                          upgrade without unlinking + reconnecting.
         *
         *  Probe happens server-side via GitHub's X-OAuth-Scopes header
         *  (see lib/githubUserToken.ts → userHasRepoScope). Cached 60s. */}
        {connected && (
          <div
            className="flex items-start justify-between gap-3 mt-3 mb-1 rounded-md px-3 py-2.5"
            style={{
              background: "rgba(255, 255, 255, 0.02)",
              border: `1px solid ${TOK.border}`,
            }}
          >
            <div className="flex items-start gap-2 min-w-0">
              <ShieldCheck
                size={13}
                style={{
                  marginTop: 2,
                  flexShrink: 0,
                  color: hasRepoScope ? TOK.accent : TOK.textMuted,
                }}
              />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span
                  className="text-xs font-medium"
                  style={{ color: TOK.textPrimary }}
                >
                  Private repo access
                </span>
                <span className="text-[11px]" style={{ color: TOK.textMuted }}>
                  {hasRepoScope
                    ? "RepoBaron can analyze your private repositories."
                    : "Re-authorize GitHub to grant RepoBaron access to your private repositories."}
                </span>
              </div>
            </div>
            {hasRepoScope ? (
              <span
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] font-medium flex-shrink-0"
                style={{ color: TOK.accent }}
              >
                <ShieldCheck size={11} />
                Granted
              </span>
            ) : (
              <RowAction
                onClick={handleReauthorize}
                disabled={busy !== null}
              >
                {busy === "reauth" ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <ShieldCheck size={11} />
                )}
                {busy === "reauth" ? "Re-authorizing…" : "Re-authorize"}
              </RowAction>
            )}
          </div>
        )}
        <Row
          label="Google"
          description="Sign in with your Google account."
          value={<ComingSoonBadge />}
          comingSoon
        />
      </SectionCard>
    </>
  );
}
