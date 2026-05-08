// Browser-safe types + validation for the v0.74 feedback module.
//
// Why this lives in its own file: the server-side submitFeedback
// implementation in lib/feedback.ts depends on node:fs + node:path
// for disk I/O. If a client component imports anything from
// lib/feedback.ts (even just the types), webpack drags the whole
// node-only dependency tree into the client bundle and fails the
// build.
//
// Splitting the browser-safe surface into this file mirrors the
// pattern AGENTS.md documents for `workspaceTypes.ts` /
// `workspaceSummary.ts`. Client code imports from here; server
// code imports from lib/feedback.ts (which re-imports + re-exports
// these constants for backwards compatibility).

const TYPES = ["bug", "feature", "general", "question"] as const;
export type FeedbackType = (typeof TYPES)[number];

const MAX_DESCRIPTION_LEN = 4000;
const MAX_EMAIL_LEN = 200;

export interface FeedbackInput {
  type: FeedbackType;
  description: string;
  /** Optional — only set when the user opts in to be contacted. */
  email?: string;
  /** Auto-included: the page URL the user was on when submitting. */
  pageUrl?: string;
  /** Auto-included: user agent string for browser-bug context. */
  userAgent?: string;
  /** Auto-included: session id when submitting from inside a session
   *  (lets the maintainer load the same session to investigate). */
  sessionId?: string;
}

export interface ValidationError {
  field: keyof FeedbackInput;
  message: string;
}

/** Synchronous validation. Returns null on success, an error array
 *  otherwise. The API route turns these into 400 responses. Browser-
 *  safe — no I/O, no filesystem. */
export function validateFeedback(
  input: Partial<FeedbackInput>
): ValidationError[] | null {
  const errors: ValidationError[] = [];

  if (!input.type || !TYPES.includes(input.type as FeedbackType)) {
    errors.push({
      field: "type",
      message: `type must be one of ${TYPES.join(", ")}`,
    });
  }

  const desc = (input.description ?? "").trim();
  if (!desc) {
    errors.push({ field: "description", message: "description is required" });
  } else if (desc.length > MAX_DESCRIPTION_LEN) {
    errors.push({
      field: "description",
      message: `description must be ${MAX_DESCRIPTION_LEN} characters or fewer`,
    });
  }

  if (input.email !== undefined && input.email !== "") {
    if (input.email.length > MAX_EMAIL_LEN) {
      errors.push({
        field: "email",
        message: `email must be ${MAX_EMAIL_LEN} characters or fewer`,
      });
    } else if (!/^.+@.+\..+$/.test(input.email)) {
      errors.push({ field: "email", message: "email looks malformed" });
    }
  }

  return errors.length > 0 ? errors : null;
}

export const FEEDBACK_TYPES = TYPES;
export const FEEDBACK_LIMITS = {
  description: MAX_DESCRIPTION_LEN,
  email: MAX_EMAIL_LEN,
};
