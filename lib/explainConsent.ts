// One-time opt-in before a PRIVATE repository's source leaves the machine.
//
// The per-function AI explainer is the only path in the product that sends file
// contents to a model, so the first time it runs against a private repository
// the reader is asked first. That gate lived inside FunctionInsight, which
// meant it protected the Source view and nothing else: FlowsView calls the same
// endpoint when you click a node on the reach diagram, and it sent private
// source with no prompt at all — the surface a reader is most likely to click
// around in casually.
//
// The flag is deliberately BROWSER-LOCAL and not per-repository. It records
// "this person has been told what the explainer does", which is a fact about
// the reader, not about a repo. Two honest limits follow, and /security states
// them rather than implying more than this is:
//   - it covers every private repo you subsequently open in this browser;
//   - it is not enforced server-side. The server checks WHO is asking (read
//     access, entitlement, budget, rate limit), not that they consented. This
//     is an informed-consent prompt, not an authorization boundary.

const CONSENT_KEY_PRIVATE = "ct-explain-consent-private";

/** True when this browser has already opted in to sending private-repo source
 *  to the explainer. False when storage is unavailable, which errs toward
 *  asking again rather than assuming consent. */
export function hasPrivateExplainConsent(): boolean {
  try {
    return window.localStorage.getItem(CONSENT_KEY_PRIVATE) === "1";
  } catch {
    return false;
  }
}

/** Record the opt-in. Never throws: in private-browsing mode the write fails
 *  and the reader is asked again next time, which is the safe direction. */
export function grantPrivateExplainConsent(): void {
  try {
    window.localStorage.setItem(CONSENT_KEY_PRIVATE, "1");
  } catch {
    /* storage blocked — proceed for this view, ask again next time */
  }
}

/** Whether an explain call against this repository needs the prompt first.
 *  Public repositories never do: their source is already readable by anyone. */
export function needsPrivateExplainConsent(repoPrivate: boolean): boolean {
  return repoPrivate && !hasPrivateExplainConsent();
}
