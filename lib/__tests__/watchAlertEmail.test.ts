import { describe, it, expect } from "vitest";
import { watchAlertEmail } from "../email/templates/watchAlert";
import type { WatchAlert } from "../watchMonitor";

function alert(over: Partial<WatchAlert>): WatchAlert {
  return {
    watchId: "w",
    userId: "u",
    sessionId: "s1",
    repoFullName: "octocat/repo",
    headSha: "abc123",
    severity: "regression",
    gradeFrom: null,
    gradeTo: null,
    scoreDelta: -5,
    criticalDelta: 0,
    lenses: [],
    riskDrifts: [],
    summary: "B→C · Security regressed",
    ...over,
  };
}

describe("watchAlertEmail", () => {
  it("single alert: repo-specific subject + a link to its verdict", () => {
    const e = watchAlertEmail({
      alerts: [alert({ gradeFrom: "B", gradeTo: "C" })],
      siteUrl: "https://codetrawl.com",
    });
    expect(e.subject).toContain("octocat/repo");
    expect(e.subject).toContain("C");
    expect(e.html).toContain("octocat/repo");
    expect(e.html).toContain("B→C · Security regressed");
    expect(e.html).toContain("https://codetrawl.com/session/s1/verdict");
    expect(e.text).toContain("octocat/repo");
  });

  it("multiple alerts: batched subject + a link to the workspace", () => {
    const e = watchAlertEmail({
      alerts: [
        alert({ sessionId: "s1" }),
        alert({ repoFullName: "acme/api", sessionId: "s2" }),
      ],
      siteUrl: "https://codetrawl.com",
    });
    expect(e.subject).toContain("2 watched repos");
    expect(e.html).toContain("https://codetrawl.com/cases");
    expect(e.text).toContain("octocat/repo");
    expect(e.text).toContain("acme/api");
  });

  it("renders a blast-radius line when a repo has risk drift", () => {
    const e = watchAlertEmail({
      alerts: [
        alert({
          riskDrifts: [
            { file: "src/auth.ts", from: 12, to: 31, delta: 19 },
            { file: "src/util/session.ts", from: 8, to: 19, delta: 11 },
          ],
        }),
      ],
      siteUrl: "https://codetrawl.com",
    });
    expect(e.html).toContain("Blast radius grew:");
    expect(e.html).toContain("auth.ts blast 12→31");
    expect(e.html).toContain("session.ts blast 8→19");
    expect(e.text).toContain("auth.ts blast 12→31");
  });

  it("drift-only alert (no grade drop) gets a blast-radius subject", () => {
    const e = watchAlertEmail({
      alerts: [
        alert({
          gradeFrom: null,
          gradeTo: null,
          summary: "1 file's blast grew",
          riskDrifts: [{ file: "src/auth.ts", from: 12, to: 31, delta: 19 }],
        }),
      ],
      siteUrl: "https://codetrawl.com",
    });
    expect(e.subject).toContain("blast radius grew");
  });
});
