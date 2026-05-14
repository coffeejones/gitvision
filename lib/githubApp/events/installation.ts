// installation event handler.
//
// Receives installation lifecycle events:
//   - `created` — app was just installed on one or more repos
//   - `deleted` — app was uninstalled (Commit 8 will GC their sessions)
//   - `suspend` / `unsuspend` — temporary disable (no action needed v1)
//   - `new_permissions_accepted` — user accepted new perms (no action v1)
//
// Commit 3 scope: parse + log + return appropriate HandleResult.
// Real housekeeping (delete sessions on uninstall) lands in Commit 8.
//
// Design: eval/strategy/github-app-skeleton-2026-05.md.

import { z } from "zod";

import type { HandleResult } from "../webhook";

const SUPPORTED_ACTIONS = new Set(["created", "deleted"]);

const InstallationEventSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number(),
    account: z
      .object({
        login: z.string(),
        type: z.string().optional(),
      })
      .optional(),
  }),
  // `repositories` is present on created/deleted; absent on suspend.
  repositories: z
    .array(z.object({ full_name: z.string(), private: z.boolean() }))
    .optional(),
});

export type InstallationEvent = z.infer<typeof InstallationEventSchema>;

export async function handleInstallationEvent(
  payload: unknown,
  deliveryId?: string | null,
): Promise<HandleResult> {
  const parsed = InstallationEventSchema.safeParse(payload);
  if (!parsed.success) {
    console.warn(
      `[github-app] installation payload failed validation delivery=${deliveryId ?? "—"}: ${parsed.error.message}`,
    );
    return { status: "error", reason: "invalid installation payload" };
  }

  const { action, installation, repositories } = parsed.data;
  const accountLogin = installation.account?.login ?? "—";
  const repoCount = repositories?.length ?? 0;
  const logCtx = `delivery=${deliveryId ?? "—"} installation=${installation.id} account=${accountLogin} action=${action} repos=${repoCount}`;

  if (!SUPPORTED_ACTIONS.has(action)) {
    console.log(`[github-app] skip installation ${logCtx}`);
    return { status: "skipped", reason: `action=${action}` };
  }

  // Commit 3 stub: log + return accepted. Real housekeeping in Commit 8.
  console.log(`[github-app] installation ${logCtx}`);
  return { status: "accepted", reason: action };
}
