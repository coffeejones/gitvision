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

import { useState } from "react";
import { RepoInputForm } from "@/components/RepoInputForm";

export function WorkspaceInputBar() {
  const [value, setValue] = useState("");
  return <RepoInputForm value={value} onValueChange={setValue} />;
}
