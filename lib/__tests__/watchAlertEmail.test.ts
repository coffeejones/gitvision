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
});
