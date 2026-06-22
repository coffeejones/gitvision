// Pre-analyzed PUBLIC demo sessions linked from the landing's "try a sample"
// buttons. A logged-out visitor clicks one and SEES the product on a real repo
// instantly — no signup. (Viewing a public session is already anonymous-allowed;
// only *creating* an analysis is login-gated, which keeps the signup funnel for
// "analyze your own repo".)
//
// To wire one: on prod (codetrawl.com), while logged in, analyze the repo so a
// public session exists, open it, and copy the id from the URL
// (/session/<id>/…). Paste that id below. Until an id is filled in, that sample
// falls back to the normal signup-gated analyze flow — so the landing never
// breaks while the demo sessions are being created.

export interface DemoSession {
  /** Short button label on the hero. */
  label: string;
  /** owner/repo — used only as the fallback analyze target if sessionId is "". */
  repo: string;
  /** Stable prod session id for the public demo view. "" until created. */
  sessionId: string;
}

export const DEMO_SESSIONS: DemoSession[] = [
  { label: "zod", repo: "colinhacks/zod", sessionId: "qRUWdkTNh-" },
  { label: "flask", repo: "pallets/flask", sessionId: "2W8VJwPfzl" },
  { label: "gin", repo: "gin-gonic/gin", sessionId: "zHpVZ1Ybto" },
];
