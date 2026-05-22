"use client";

// Connections settings — GitHub link/unlink + Google placeholder
// (v0.76 / D4).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link as LinkIcon, Unlink, Mail } from "lucide-react";
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
}

export function ConnectionsPanel({
  githubAccount,
  githubLogin,
  signInMethodCount,
}: Props) {
  const router = useRouter();
  const [flash, setFlash] = useState<Flash>({ kind: "none" });
  const [busy, setBusy] = useState<null | "link" | "unlink">(null);

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
