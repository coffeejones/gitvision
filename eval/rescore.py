"""Offline re-scoring of an existing run, with the latest prompts.yaml.

Use case: you've changed how a prompt's ground truth is computed (e.g.
P1's truth shape was wrong, fixed in prompts.yaml) and want to re-score
the existing runs/<ts>/ artifacts WITHOUT re-paying for LLM API calls.

Strategy:
  1. Load existing results.json + manifest.json from a target run dir
  2. For each cell, recompute the ground truth based on the CURRENT
     prompts.yaml definition:
       - If the tool's output is already on disk under a sibling cell
         (e.g. P1 now wants untested_hotspots, P2 already captured it
         for the same repo), reuse that file
       - Otherwise capture via a single MCP call (no LLM cost)
  3. Re-run score_run + categorize using the new truth
  4. Write findings-rescored.md + results-rescored.json next to the
     originals — never overwrite the original artifacts

Run:
    uv run python rescore.py runs/<timestamp>
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

from eval import (
    GitVisionConfig,
    Prompt,
    TargetRepo,
    call_tool,
    categorize,
    open_mcp,
    score_run,
    write_findings,
)


def _load_prompts(yaml_path: Path) -> tuple[list[TargetRepo], list[Prompt]]:
    raw = yaml.safe_load(yaml_path.read_text())
    repos = [TargetRepo(**r) for r in raw["target_repos"]]
    prompts = [Prompt(**p) for p in raw["prompts"]]
    return repos, prompts


def _truth_file(repo_dir: Path, prompt_id: str) -> Path:
    return repo_dir / f"{prompt_id}.json"


def _find_existing_truth_for_tool(
    repo_dir: Path, tool: str, args: dict[str, Any], prompts: list[Prompt]
) -> Path | None:
    """Look across all prompt truth files in this repo for one whose
    prompt definition uses the same (tool, args) — args matter because
    e.g. untested_hotspots(limit=5) and (limit=10) return different
    payloads and shouldn't be aliased."""
    for p in prompts:
        if (
            p.ground_truth.get("tool") == tool
            and p.ground_truth.get("args", {}) == args
        ):
            f = _truth_file(repo_dir, p.id)
            if f.exists():
                return f
    return None


async def _capture_missing_truth(
    cfg: GitVisionConfig,
    repo: TargetRepo,
    prompt: Prompt,
    repo_dir: Path,
) -> dict[str, Any]:
    """One-off MCP call to capture truth for a (repo, prompt) cell where
    the on-disk data doesn't exist or doesn't match the new tool. We
    re-run analyze_repo to get a session, then call the requested tool."""
    print(f"    [capture] {prompt.ground_truth['tool']} for {repo.id} × {prompt.id}")
    args: dict[str, Any] = {"repoUrl": repo.url}
    if repo.subdir:
        args["subdir"] = repo.subdir
    async with open_mcp(cfg) as session:
        ar = await call_tool(session, "analyze_repo", args)
        analyze_payload = json.loads(ar["text"]) if ar["text"] else {}
        session_id = analyze_payload.get("sessionId")
        if not session_id:
            raise RuntimeError(f"analyze_repo for {repo.id} returned no sessionId")
        # Refresh the cached _analyze.json too (it may be stale)
        (repo_dir / "_analyze.json").write_text(json.dumps(analyze_payload, indent=2))
        tool = prompt.ground_truth["tool"]
        tool_args = prompt.ground_truth.get("args", {})
        r = await call_tool(session, tool, {"sessionId": session_id, **tool_args})
        payload = json.loads(r["text"]) if r["text"] else {}
        _truth_file(repo_dir, prompt.id).write_text(json.dumps(payload, indent=2))
        return payload


async def _resolve_truth(
    cfg: GitVisionConfig,
    repo: TargetRepo,
    prompt: Prompt,
    repo_dir: Path,
    prompts: list[Prompt],
) -> dict[str, Any]:
    """Get truth for (repo, prompt) using the CURRENT prompts.yaml shape.

    Resolution order (cheapest first):
      1. If a sibling truth file in the same repo dir already used the
         same tool, reuse it.
      2. Existing per-prompt truth file IF it was captured with the same
         tool (we sniff the JSON shape — primitive heuristic).
      3. Fall back to capturing via MCP (one round trip).
    """
    target_tool = prompt.ground_truth.get("tool")
    target_args = prompt.ground_truth.get("args", {})

    # Path 1: sibling cell with the same (tool, args)
    sibling = _find_existing_truth_for_tool(repo_dir, target_tool, target_args, prompts)
    if sibling and sibling.name != f"{prompt.id}.json":
        return json.loads(sibling.read_text())

    # Path 2: own file, IF it has the right shape
    own = _truth_file(repo_dir, prompt.id)
    if own.exists():
        try:
            data = json.loads(own.read_text())
            if _looks_like_tool_output(data, target_tool):
                return data
        except Exception:
            pass

    # Path 3: capture via MCP (no LLM cost)
    return await _capture_missing_truth(cfg, repo, prompt, repo_dir)


def _looks_like_tool_output(data: Any, tool: str) -> bool:
    if not isinstance(data, dict):
        return False
    if tool == "analyze_repo":
        return "hotspots" in data and "codeGraph" in data
    if tool == "untested_hotspots":
        return "hotspots" in data and "totals" in data
    if tool == "signals":
        return "signals" in data
    if tool == "composite":
        return "untested_hotspots" in data and "find_duplicates" in data
    return False


async def main(run_dir: Path) -> None:
    load_dotenv()
    cfg = GitVisionConfig.from_env()
    eval_dir = Path(__file__).parent
    repos, prompts = _load_prompts(eval_dir / "prompts.yaml")
    repo_by_id = {r.id: r for r in repos}
    prompt_by_id = {p.id: p for p in prompts}

    results = json.loads((run_dir / "results.json").read_text())
    manifest = json.loads((run_dir / "manifest.json").read_text())
    truth_root = run_dir / "ground_truth"

    # Ensure repo dirs exist (in case any captures need to happen)
    for r in repos:
        (truth_root / r.id).mkdir(parents=True, exist_ok=True)

    print(f"=== rescore {run_dir.name} ===")
    print(f"  cells: {len(results)}")

    new_results: list[dict[str, Any]] = []
    for r in results:
        prompt_id = r["prompt_id"]
        repo_id = r["repo_id"]
        prompt = prompt_by_id.get(prompt_id)
        repo = repo_by_id.get(repo_id)
        if prompt is None or repo is None:
            print(f"  skip {prompt_id} × {repo_id} (no longer in prompts.yaml)")
            new_results.append(r)
            continue

        repo_dir = truth_root / repo_id
        truth = await _resolve_truth(cfg, repo, prompt, repo_dir, prompts)
        analyze_path = repo_dir / "_analyze.json"
        ap = json.loads(analyze_path.read_text()) if analyze_path.exists() else {}

        no_score = score_run(r["no_mcp_run"]["text"], prompt, truth, ap)
        with_score = score_run(r["with_mcp_run"]["text"], prompt, truth, ap)
        cat = categorize(no_score, with_score)

        rn = no_score.get("recall")
        rw = with_score.get("recall")
        rn_s = "n/a" if rn is None else f"{rn:.0%}"
        rw_s = "n/a" if rw is None else f"{rw:.0%}"
        print(f"  [{prompt_id} × {repo_id}] recall {rn_s} → {rw_s}  ({cat})")

        new_results.append({
            **r,
            "no_mcp_score": no_score,
            "with_mcp_score": with_score,
            "category": cat,
        })

    out_results = run_dir / "results-rescored.json"
    out_findings = run_dir / "findings-rescored.md"
    out_results.write_text(json.dumps(new_results, indent=2))
    write_findings(out_findings, new_results, manifest)
    print()
    print(f"=== done ===")
    print(f"  findings: {out_findings}")
    print(f"  raw:      {out_results}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: uv run python rescore.py runs/<timestamp>", file=sys.stderr)
        sys.exit(2)
    asyncio.run(main(Path(sys.argv[1]).resolve()))
