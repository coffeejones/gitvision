// Danger zone — placeholder for destructive account actions
// (v0.76 / D4).
//
// Currently only "Delete account" as Coming soon. When we ship it,
// this panel will own the confirmation modal + the account-deletion
// API call.
//
// No state yet → no "use client" directive; this is a pure server
// component for now.

import {
  ComingSoonBadge,
  Row,
  SectionCard,
} from "@/components/account/_primitives";

export function DangerPanel() {
  return (
    <SectionCard
      title="Danger zone"
      description="Permanent actions on your account."
      tone="danger"
    >
      <Row
        label="Delete account"
        description="Permanently remove your account, sessions, and all associated data. This cannot be undone."
        value={<ComingSoonBadge />}
        comingSoon
      />
    </SectionCard>
  );
}
