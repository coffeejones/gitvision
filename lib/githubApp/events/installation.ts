// installation event handler.
//
// Receives installation lifecycle events:
//   - `created` — app was just installed on one or more repos
//   - `deleted` — app was uninstalled → GC sessions tagged with this
//                 installation id (per design Q3, recommendation A)
//   - `suspend` / `unsuspend` — temporary disable (no action needed v1)
//   - `new_permissions_accepted` — user accepted new perms (no action v1)
//
// Workspace-created sessions for the same repo are NOT touched on
// uninstall — they came from a different consent flow (web UI, user
// explicitly created them) and have installationId=undefined, so the
// storage helper's filter naturally protects them.
//
// Design: eval/strategy/github-app-skeleton-2026-05.md §Q3.

import { z } from "zod";

import { deleteSessionsByInstallation } from "../../storage";
import { deleteReceiptsByInstallation } from "../../receiptStore";
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

export interface InstallationHandlerDeps {
  deleteSessionsByInstallation: typeof deleteSessionsByInstallation;
  deleteReceiptsByInstallation: typeof deleteReceiptsByInstallation;
}

export const defaultInstallationHandlerDeps: InstallationHandlerDeps = {
  deleteSessionsByInstallation,
  deleteReceiptsByInstallation,
};

export async function handleInstallationEvent(
  payload: unknown,
  deliveryId?: string | null,
  deps: InstallationHandlerDeps = defaultInstallationHandlerDeps,
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

  if (action === "deleted") {
    // GC sessions tied to this installation. Per design Q3-A: user
    // uninstalled = they don't want us holding their analysis.
    try {
      const count = await deps.deleteSessionsByInstallation(installation.id);
      // Receipts carry the same installation tag — remove them too, so the
      // owner's PR/commit metadata stops being served from /r/[id].
      const receipts = await deps.deleteReceiptsByInstallation(installation.id);
      console.log(
        `[github-app] installation ${logCtx} deleted_sessions=${count} deleted_receipts=${receipts}`,
      );
    } catch (err) {
      // Both deleters are supposed to never throw, but defense-in-depth: log and
      // continue so the webhook still 200s.
      console.error(
        `[github-app] uninstall GC failed ${logCtx}:`,
        err,
      );
    }
    return { status: "accepted", reason: "deleted" };
  }

  // action === "created" — no housekeeping needed; just log for
  // visibility so we can spot install volume in Railway logs.
  console.log(`[github-app] installation ${logCtx}`);
  return { status: "accepted", reason: action };
}
