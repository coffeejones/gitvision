// The Conscience prompt (agent-loop): the instruction text codifies the loop and
// weaves in a session id when given.

import { describe, it, expect } from "vitest";
import { conscienceMessage, conscienceHandler } from "../prompts/conscience";

describe("conscience prompt message", () => {
  it("codifies the simulate → gate → re-simulate loop", () => {
    const t = conscienceMessage();
    expect(t).toMatch(/simulate_change/);
    expect(t).toMatch(/gate\.pass/);
    expect(t).toMatch(/gate\.blocking/);
    expect(t).toMatch(/re-run `simulate_change`/);
    expect(t).toMatch(/deterministic/i);
  });

  it("weaves the session id in when provided, and reads clean without it", () => {
    expect(conscienceMessage("sess-abc")).toMatch(/sess-abc/);
    expect(conscienceMessage()).not.toMatch(/session `/);
  });

  it("handler returns a single user message with the instruction", () => {
    const r = conscienceHandler({ sessionId: "s1" });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].role).toBe("user");
    expect(r.messages[0].content.type).toBe("text");
    expect(r.messages[0].content.text).toMatch(/s1/);
  });
});
