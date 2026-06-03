"use client";

// General settings — display name, email, joined date (v0.76 / D4).
//
// Inline name editing via authClient.updateUser({ name }). Email is
// read-only here; changing email is a more complex feature (re-
// verification, uniqueness check) reserved for a later iteration.

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, MailCheck } from "lucide-react";
import { TOK } from "@/components/account/theme";
import { authClient } from "@/lib/authClient";
import {
  Badge,
  FlashBanner,
  Row,
  RowAction,
  SectionCard,
  type Flash,
} from "@/components/account/_primitives";
import type { AccountUser } from "@/lib/userFromSession";

export function GeneralPanel({ user }: { user: AccountUser }) {
  const router = useRouter();
  const [flash, setFlash] = useState<Flash>({ kind: "none" });

  function showSuccess(message: string) {
    setFlash({ kind: "success", message });
    setTimeout(() => setFlash({ kind: "none" }), 4000);
    router.refresh();
  }
  function showError(message: string) {
    setFlash({ kind: "error", message });
  }

  return (
    <>
      <FlashBanner flash={flash} onClose={() => setFlash({ kind: "none" })} />
      <SectionCard
        title="General"
        description="The basics about your account."
      >
        <NameRow user={user} onSuccess={showSuccess} onError={showError} />
        <Row
          label="Email"
          description="Used for sign-in and notifications."
          value={
            <span className="inline-flex items-center gap-2">
              {user.email}
              {user.emailVerified && (
                <Badge
                  tone="accent"
                  icon={<MailCheck size={10} />}
                  label="Verified"
                />
              )}
            </span>
          }
        />
        <Row label="Member since" value={formatJoined(user.createdAt)} />
      </SectionCard>
    </>
  );
}

function NameRow({
  user,
  onSuccess,
  onError,
}: {
  user: AccountUser;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name ?? "");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      onError("Name can't be empty.");
      return;
    }
    if (trimmed === user.name) {
      setEditing(false);
      return;
    }
    setSubmitting(true);
    try {
      const result = await authClient.updateUser({ name: trimmed });
      if (result.error) {
        onError(result.error.message ?? "Couldn't update name.");
        return;
      }
      onSuccess("Name updated.");
      setEditing(false);
    } catch {
      onError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    setName(user.name ?? "");
    setEditing(false);
  }

  return (
    <Row
      label="Display name"
      description="How you appear inside RepoJury."
      value={!editing ? user.name || "—" : undefined}
      action={
        !editing && (
          <RowAction onClick={() => setEditing(true)}>
            <Pencil size={11} />
            Edit
          </RowAction>
        )
      }
      expanded={
        editing && (
          <div className="flex items-center gap-2 mt-3">
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              maxLength={64}
              className="flex-1 h-9 rounded-md px-3 text-sm outline-none"
              style={{
                background: TOK.surfaceElevated,
                border: `1px solid ${TOK.border}`,
                color: TOK.textPrimary,
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
            />
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              className="h-9 px-3 rounded-md text-xs transition cursor-pointer disabled:opacity-50"
              style={{
                background: "transparent",
                border: `1px solid ${TOK.border}`,
                color: TOK.textSecondary,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="h-9 px-3 rounded-md text-xs font-medium transition flex items-center gap-1.5 cursor-pointer disabled:opacity-40 hover:brightness-110"
              style={{
                background: TOK.accent,
                color: TOK.accentOn,
              }}
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        )
      }
    />
  );
}

function formatJoined(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
