"use client";

// Inline analyze-input for the workspace dashboard (v0.68 / C3).
//
// Power-users on /workspace want to spin up a new analysis without
// bouncing back to the marketing landing page. This thin client
// wrapper hosts the URL value state and reuses the same
// RepoInputForm the landing uses — so submit logic, deep-link
// detection, subdir scoping, and progress UI all stay identical
// between the two surfaces.
//
// Wrapper exists because RepoInputForm is fully controlled (the
// landing pre-fills it from "Try a demo" clicks). On workspace we
// don't have those triggers; we just need a local-state shell.

import { useEffect, useState } from "react";
import { RepoInputForm } from "@/components/RepoInputForm";
import { CH } from "@/components/chambers/theme";
import { PENDING_REPO_KEY } from "@/lib/pendingRepo";

export function WorkspaceInputBar() {
  const [value, setValue] = useState("");
  const [autoRun, setAutoRun] = useState(false);

  // Resume-after-signup: a logged-out visitor who pasted a repo on the landing
  // had it stashed under PENDING_REPO_KEY and was sent to /signup?next=/cases.
  // They land here — pull the stash, prefill, and let RepoInputForm auto-run it
  // so the repo they wanted isn't silently dropped. Read once on mount and
  // clear immediately so a later visit doesn't re-trigger.
  useEffect(() => {
    let stashed: string | null = null;
    try {
      stashed = sessionStorage.getItem(PENDING_REPO_KEY);
      if (stashed) sessionStorage.removeItem(PENDING_REPO_KEY);
    } catch {
      /* sessionStorage unavailable — nothing to resume */
    }
    if (stashed) {
      setValue(stashed);
      setAutoRun(true);
    }
  }, []);

  return (
    <RepoInputForm
      value={value}
      onValueChange={setValue}
      autoRun={autoRun}
      // CodeTrawl workspace: a bitumen, hairline, shadow-free bar that sits in
      // the page rather than the lifted-card look used on the marketing landing.
      surface={CH.panel}
      borderColor={CH.border}
      flat
      // De-green the submit button + soften the focus ring → neutral bone.
      accent={CH.accent}
      accentOn={CH.accentText}
    />
  );
}
