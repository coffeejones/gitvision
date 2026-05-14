"""Real-world validation of the PR-bot data pipeline via MCP.

Runs the three-step workflow the MCP server exposes against a real repo
+ ref pair, and prints the output for human inspection.

Workflow:
  1. analyze_repo(repoUrl, ref=<base>)   → baseSessionId
  2. analyze_repo(repoUrl, ref=<head>)   → headSessionId
  3. review_changes(baseSessionId, headSessionId)
                                          → DiffSummary + ranked suggestions

Why Python instead of a TS script: we already have the MCP stdio
plumbing in eval/eval.py, and Python's mcp client handles the production
build's Octokit-ESM quirks correctly. Running this through the real
MCP server (built via `npx tsc -p mcp/tsconfig.json`) gives us
end-to-end validation of the exact same code path Claude Code calls.

Run:
  uv run python validate_workflow.py
  uv run python validate_workflow.py https://github.com/pallets/flask 3.1.2 3.1.3

Args: <repo_url> <base_ref> <head_ref>   (all optional — defaults below)
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

# Reuse the MCP plumbing from eval.py
from eval import GitVisionConfig, call_tool, open_mcp


DEFAULT_REPO = "https://github.com/pallets/flask"
DEFAULT_BASE = "3.1.2"
DEFAULT_HEAD = "3.1.3"


def section(title: str) -> None:
    print()
    print("─" * 72)
    print(f"  {title}")
    print("─" * 72)


def fmt_suggestion(s: dict, n: int) -> str:
    sev = s.get("severity", "?")
    icon = "🔴" if sev == "critical" else "🟡" if sev == "warning" else "🟢"
    lines = [
        f"{n}. {icon} {sev.upper()} · [{s.get('ruleId')}] · impact={s.get('impactScore', 0)}",
        f"   {s.get('text', '')}",
        f"   evidence: {', '.join(s.get('evidence', []))}",
    ]
    return "\n".join(lines)


async def main() -> None:
    load_dotenv(override=True)
    cfg = GitVisionConfig.from_env()

    repo_url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_REPO
    base_ref = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_BASE
    head_ref = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_HEAD

    print(f"Validating: {repo_url}")
    print(f"  base: {base_ref}")
    print(f"  head: {head_ref}")

    async with open_mcp(cfg) as session:
        section(f"1. analyze_repo at base ref ({base_ref})")
        base_args = {"repoUrl": repo_url, "ref": base_ref}
        base_res = await call_tool(session, "analyze_repo", base_args)
        if base_res["is_error"]:
            print(f"  ✗ analyze_repo failed: {base_res['text'][:200]}")
            return
        base_payload = json.loads(base_res["text"])
        base_session_id = base_payload["sessionId"]
        cg = base_payload.get("codeGraph") or {}
        print(f"  ✓ sessionId: {base_session_id}")
        print(f"  functions: {cg.get('functions')}")

        section(f"2. analyze_repo at head ref ({head_ref})")
        head_args = {"repoUrl": repo_url, "ref": head_ref}
        head_res = await call_tool(session, "analyze_repo", head_args)
        if head_res["is_error"]:
            print(f"  ✗ analyze_repo failed: {head_res['text'][:200]}")
            return
        head_payload = json.loads(head_res["text"])
        head_session_id = head_payload["sessionId"]
        cg = head_payload.get("codeGraph") or {}
        print(f"  ✓ sessionId: {head_session_id}")
        print(f"  functions: {cg.get('functions')}")

        section("3. review_changes (diff + top-3 suggestions)")
        rc_res = await call_tool(
            session,
            "review_changes",
            {
                "baseSessionId": base_session_id,
                "headSessionId": head_session_id,
            },
        )
        if rc_res["is_error"]:
            print(f"  ✗ review_changes failed: {rc_res['text'][:200]}")
            return
        rc_payload = json.loads(rc_res["text"])
        summary = rc_payload.get("summary", {})
        print("  Diff summary:")
        print(f"    files changed:        {summary.get('filesChanged')}")
        print(f"    functions added:      {summary.get('functionsAdded')}")
        print(f"    functions removed:    {summary.get('functionsRemoved')}")
        print(f"    functions modified:   {summary.get('functionsModified')}")
        print(f"    net complexity Δ:     {summary.get('netComplexityDelta')}")
        print()
        print("  Top-3 suggestions (PR-comment default):")
        suggestions = rc_payload.get("suggestions", [])
        if not suggestions:
            print("    (no suggestions — rules didn't fire on this diff)")
        else:
            for i, s in enumerate(suggestions, start=1):
                print()
                print(fmt_suggestion(s, i))

        section("4. review_changes with maxResults=20 (uncapped)")
        rc20 = await call_tool(
            session,
            "review_changes",
            {
                "baseSessionId": base_session_id,
                "headSessionId": head_session_id,
                "maxResults": 20,
            },
        )
        rc20_payload = json.loads(rc20["text"])
        all_suggestions = rc20_payload.get("suggestions", [])
        print(f"\n  Total: {len(all_suggestions)}")
        # Per-rule breakdown
        by_rule: dict[str, int] = {}
        for s in all_suggestions:
            rid = s.get("ruleId", "?")
            by_rule[rid] = by_rule.get(rid, 0) + 1
        if by_rule:
            print("\n  Per-rule:")
            for rid, n in sorted(by_rule.items()):
                print(f"    {n:>3} × {rid}")

        section("5. analyze_diff raw changes (for sanity check)")
        ad_res = await call_tool(
            session,
            "analyze_diff",
            {
                "baseSessionId": base_session_id,
                "headSessionId": head_session_id,
            },
        )
        if not ad_res["is_error"]:
            ad_payload = json.loads(ad_res["text"])
            changes = ad_payload.get("changes", [])
            # Sort by impact heuristic for display
            def impact(c: dict) -> float:
                if c.get("complexityDelta") is not None:
                    return abs(c["complexityDelta"])
                return float(c.get("complexityAfter") or c.get("complexityBefore") or 0)
            ranked = sorted(changes, key=impact, reverse=True)
            print(f"\n  Showing top 10 by impact (of {len(changes)} total changes):")
            for c in ranked[:10]:
                container = c.get("containerType")
                qual = f"{container}.{c['name']}" if container else c["name"]
                status = c.get("status", "?")
                detail: str
                if status == "modified":
                    detail = f"{c.get('complexityBefore')} → {c.get('complexityAfter')} (Δ{(c.get('complexityDelta') or 0):+d})"
                    if c.get("bodyChanged") is not None:
                        detail += f", bodyChanged={c['bodyChanged']}"
                elif status == "added":
                    detail = f"complexity={c.get('complexityAfter')}"
                elif status == "removed":
                    detail = f"complexity={c.get('complexityBefore')}"
                else:
                    detail = "(unchanged)"
                print(f"    {status:>9}  {c.get('filePath')}::{qual} — {detail}")

    print()
    print("─" * 72)


if __name__ == "__main__":
    asyncio.run(main())
