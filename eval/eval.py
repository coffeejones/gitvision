"""GitVision MCP eval — single-file A/B harness.

Pipeline stages run in sequence inside main():
  1. Load config + prompts.yaml
  2. For each target repo: capture ground truth via MCP (cached on disk)
  3. For each (prompt, repo): run baseline + with-MCP variants
  4. Score outputs (existence-based) + auto-categorize
  5. Write findings.md

Output is intentional ROADMAP INPUT — pick prompts apart afterwards by
hand to decide what to fix, what to reframe, what to accept.

Run:  uv run python eval.py
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator

import yaml
from anthropic import Anthropic
from dotenv import load_dotenv
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MAX_TOOL_HOPS = 12
DEFAULT_MODEL = "claude-sonnet-4-6"


@dataclass
class GitVisionConfig:
    """Where the MCP server lives + how to spawn it."""
    repo_path: str
    cmd: str
    args: list[str]

    @classmethod
    def from_env(cls) -> "GitVisionConfig":
        return cls(
            repo_path=os.environ["GITVISION_REPO_PATH"],
            cmd=os.environ.get("GITVISION_MCP_CMD", "node"),
            args=os.environ.get("GITVISION_MCP_ARGS", "mcp/dist/mcp/server.js").split(),
        )


@dataclass
class TargetRepo:
    id: str
    language: str
    url: str
    subdir: str | None
    size_class: str


@dataclass
class Prompt:
    id: str
    description: str
    target_repos: list[str]
    prompt: str
    ground_truth: dict[str, Any]
    primary_metric: str


# ---------------------------------------------------------------------------
# MCP session (stdio client)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def open_mcp(cfg: GitVisionConfig) -> AsyncIterator[ClientSession]:
    params = StdioServerParameters(
        command=cfg.cmd,
        args=cfg.args,
        cwd=cfg.repo_path,
        env={**os.environ},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


async def list_tools_for_anthropic(session: ClientSession) -> list[dict[str, Any]]:
    resp = await session.list_tools()
    return [
        {
            "name": t.name,
            "description": t.description or "",
            "input_schema": t.inputSchema or {"type": "object", "properties": {}},
        }
        for t in resp.tools
    ]


async def call_tool(session: ClientSession, name: str, args: dict[str, Any]) -> dict[str, Any]:
    result = await session.call_tool(name, args)
    text = "\n".join(item.text for item in result.content if hasattr(item, "text") and item.text)
    return {"text": text, "is_error": bool(getattr(result, "isError", False))}


# ---------------------------------------------------------------------------
# Ground truth capture
# ---------------------------------------------------------------------------

COMPOSITE_TOOLS = ["signals", "untested_hotspots", "find_duplicates"]


async def capture_ground_truth(
    session: ClientSession,
    repo: TargetRepo,
    prompts: list[Prompt],
    out_dir: Path,
) -> dict[str, Any]:
    """Returns {prompt_id: truth_payload} + caches the analyze_repo payload
    so the scorer can look up the FULL function list for existence checks."""
    args: dict[str, Any] = {"repoUrl": repo.url}
    if repo.subdir:
        args["subdir"] = repo.subdir
    print(f"  analyze_repo {repo.url} (subdir={repo.subdir})")
    analyze_result = await call_tool(session, "analyze_repo", args)
    analyze_payload = json.loads(analyze_result["text"]) if analyze_result["text"] else {}
    session_id = analyze_payload.get("sessionId")
    if not session_id:
        raise RuntimeError(f"analyze_repo for {repo.id} returned no sessionId")

    # Cache the full analyze_repo payload — scorer uses it for existence
    # checks (was function X mentioned by Claude in repo's actual code graph?)
    repo_dir = out_dir / repo.id
    repo_dir.mkdir(parents=True, exist_ok=True)
    (repo_dir / "_analyze.json").write_text(json.dumps(analyze_payload, indent=2))

    truths: dict[str, Any] = {}
    for prompt in prompts:
        if repo.id not in prompt.target_repos:
            continue
        gt = prompt.ground_truth
        tool = gt.get("tool")

        if tool == "analyze_repo":
            truths[prompt.id] = analyze_payload
            (repo_dir / f"{prompt.id}.json").write_text(json.dumps(analyze_payload, indent=2))
        elif tool == "composite":
            composite: dict[str, Any] = {}
            for sub in COMPOSITE_TOOLS:
                print(f"    {sub} (composite for {prompt.id})")
                r = await call_tool(session, sub, {"sessionId": session_id})
                composite[sub] = json.loads(r["text"]) if r["text"] else {}
            truths[prompt.id] = composite
            (repo_dir / f"{prompt.id}.json").write_text(json.dumps(composite, indent=2))
        else:
            print(f"    {tool} ({prompt.id})")
            r = await call_tool(session, tool, {"sessionId": session_id, **gt.get("args", {})})
            payload = json.loads(r["text"]) if r["text"] else {}
            truths[prompt.id] = payload
            (repo_dir / f"{prompt.id}.json").write_text(json.dumps(payload, indent=2))

    return truths


# ---------------------------------------------------------------------------
# Variant runners
# ---------------------------------------------------------------------------

def _seed_user_message(prompt_text: str, repo: TargetRepo) -> str:
    scope = f" (focus subdirectory: `{repo.subdir}`)" if repo.subdir else ""
    return f"Target repository: {repo.url}{scope}\n\n---\n\n{prompt_text}"


def run_no_mcp(client: Anthropic, model: str, user_msg: str) -> dict[str, Any]:
    t0 = time.monotonic()
    resp = client.messages.create(
        model=model,
        max_tokens=4096,
        temperature=0,
        messages=[{"role": "user", "content": user_msg}],
    )
    return {
        "variant": "no_mcp",
        "text": "".join(b.text for b in resp.content if b.type == "text"),
        "tool_calls": [],
        "usage": resp.usage.model_dump(),
        "latency_s": time.monotonic() - t0,
        "stop_reason": resp.stop_reason,
    }


async def run_with_mcp(
    client: Anthropic,
    model: str,
    user_msg: str,
    cfg: GitVisionConfig,
) -> dict[str, Any]:
    async with open_mcp(cfg) as session:
        tools = await list_tools_for_anthropic(session)
        # Cache the tools array (one breakpoint at end caches everything before).
        if tools:
            tools[-1]["cache_control"] = {"type": "ephemeral"}

        messages: list[dict[str, Any]] = [{"role": "user", "content": user_msg}]
        tool_log: list[dict[str, Any]] = []
        usage_totals = {"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
        t0 = time.monotonic()

        for hop in range(MAX_TOOL_HOPS):
            resp = client.messages.create(
                model=model,
                max_tokens=4096,
                temperature=0,
                tools=tools,
                messages=messages,
            )
            usage_totals["input_tokens"] += resp.usage.input_tokens
            usage_totals["output_tokens"] += resp.usage.output_tokens
            usage_totals["cache_creation_input_tokens"] += getattr(resp.usage, "cache_creation_input_tokens", 0) or 0
            usage_totals["cache_read_input_tokens"] += getattr(resp.usage, "cache_read_input_tokens", 0) or 0

            if resp.stop_reason != "tool_use":
                return {
                    "variant": "with_mcp",
                    "text": "".join(b.text for b in resp.content if b.type == "text"),
                    "tool_calls": tool_log,
                    "usage": usage_totals,
                    "latency_s": time.monotonic() - t0,
                    "stop_reason": resp.stop_reason,
                    "hops": hop + 1,
                }

            messages.append({"role": "assistant", "content": [b.model_dump() for b in resp.content]})
            tool_results: list[dict[str, Any]] = []
            for block in resp.content:
                if block.type != "tool_use":
                    continue
                r = await call_tool(session, block.name, block.input)
                tool_log.append({"hop": hop, "name": block.name, "input": block.input, "is_error": r["is_error"]})
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": r["text"],
                    "is_error": r["is_error"],
                })

            # Strip stale cache markers, mark only latest tool_result.
            for m in messages:
                if isinstance(m.get("content"), list):
                    for b in m["content"]:
                        if isinstance(b, dict) and b.get("type") == "tool_result":
                            b.pop("cache_control", None)
            if tool_results:
                tool_results[-1]["cache_control"] = {"type": "ephemeral"}
            messages.append({"role": "user", "content": tool_results})

        return {
            "variant": "with_mcp",
            "text": "[ERROR: hit MAX_TOOL_HOPS]",
            "tool_calls": tool_log,
            "usage": usage_totals,
            "latency_s": time.monotonic() - t0,
            "stop_reason": "max_hops",
            "hops": MAX_TOOL_HOPS,
        }


# ---------------------------------------------------------------------------
# Existence-based scorer
# ---------------------------------------------------------------------------

# These are loose patterns. We don't try to be precise here — the existence
# check (look up in code graph) is what makes the scoring meaningful.
IDENT_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]{2,})\b")
PATH_RE = re.compile(r"\b([\w./-]+\.(?:go|ts|tsx|js|jsx|py|java|cs|rb|php))\b")


def _truth_items(prompt: Prompt, truth: Any) -> tuple[set[str], set[str]]:
    """Extract (file_paths, identifier_names) from the prompt's ground
    truth payload. Mirrors the existing eval's _truth_shape but trimmed
    to the prompts we actually use."""
    files: set[str] = set()
    idents: set[str] = set()

    if prompt.ground_truth.get("tool") == "signals":
        for sig in (truth.get("signals", {}) or {}).get(prompt.ground_truth["args"].get("bucket", "all"), []) or []:
            if sig.get("id"):
                idents.add(sig["id"])
        # Some signals embed file paths in their evidence
        for bucket_name in ("working", "needsWork", "questions"):
            for sig in (truth.get("signals", {}) or {}).get(bucket_name, []) or []:
                ev = sig.get("evidence")
                if isinstance(ev, dict):
                    for v in ev.values():
                        if isinstance(v, str) and "/" in v and "." in v.rsplit("/", 1)[-1]:
                            files.add(v)
    elif prompt.ground_truth.get("tool") == "untested_hotspots":
        for spot in truth.get("hotspots", []) or []:
            if spot.get("filePath"):
                files.add(spot["filePath"])
            if spot.get("name"):
                idents.add(spot["name"])
    elif prompt.ground_truth.get("tool") == "analyze_repo":
        for h in truth.get("hotspots", []) or []:
            if h.get("path"):
                files.add(h["path"])
    elif prompt.ground_truth.get("tool") == "composite":
        # Pull from all sub-truths.
        for h in (truth.get("untested_hotspots", {}) or {}).get("hotspots", []) or []:
            if h.get("filePath"):
                files.add(h["filePath"])
            if h.get("name"):
                idents.add(h["name"])
        for g in (truth.get("find_duplicates", {}) or {}).get("groups", []) or []:
            for m in g.get("members", []) or []:
                if m.get("filePath"):
                    files.add(m["filePath"])
                if m.get("name"):
                    idents.add(m["name"])

    return files, idents


def score_run(
    text: str,
    prompt: Prompt,
    truth: Any,
    analyze_payload: dict[str, Any],
) -> dict[str, Any]:
    """Score a run against ground truth.

    NOTE on hallucination: I originally designed this around an
    existence check (look up each mentioned function in the repo's
    full code graph). But MCP's `analyze_repo` returns codeGraph
    fields as summary INTS (count of functions), not the full list —
    that data lives on disk in the session, not in the tool response.
    Without exposing a new tool to surface the function list, we fall
    back to the same approach as the existing gitvision-eval: count
    identifiers/files mentioned but not in the prompt's specific
    ground truth as "hallucination". Caveat documented in README:
    this over-counts legitimate-but-uncovered mentions (framework
    names, identifiers in flow-prose). The relative delta between
    with-MCP and no-MCP is still meaningful.

    `analyze_payload` is kept on the signature for forward-compat —
    if we later add a `list_functions` MCP tool, the existence
    check can come back here.
    """
    del analyze_payload  # currently unused; see docstring above
    truth_files, truth_idents = _truth_items(prompt, truth)

    # English-word noise — high-confidence prose tokens that incidentally
    # look like identifiers (capitalized, len>=3) but never appear as
    # function or class names in real codebases.
    NOISE = {
        # Determiners / pronouns / conjunctions
        "The", "This", "That", "These", "Those", "And", "But", "For", "With",
        "From", "Here", "There", "Both", "Each", "All", "Any", "Some", "Most",
        "Only", "Top", "First", "Last", "Next", "Other", "Such", "Its",
        # Modal / aux verbs at sentence-start
        "Has", "Have", "Are", "Was", "Were", "Will", "Would", "Could",
        "Should", "Does", "Did", "Can", "May", "Might",
        # Generic code-domain nouns
        "Function", "File", "Files", "Functions", "Code", "Test", "Tests",
        "Production", "Coverage", "Complexity", "Module", "Package", "Class",
        "Method", "Line", "Lines", "Path", "Name", "Rank", "Risk", "Key",
        "Add", "Top", "Codebase", "Architecture", "Churn", "Central",
        "Takeaway", "Summary", "Hotspots",
        # Common third-person verbs in narrative descriptions
        "Builds", "Drives", "Inspects", "Validates", "Handles", "Converts",
        "Mirrors", "Returns", "Provides", "Implements", "Manages", "Generates",
        "Wraps", "Resolves", "Creates", "Encodes", "Applies", "Performs",
        "Computes", "Defines", "Renders", "Coordinates",
    }
    mentioned_files = set(PATH_RE.findall(text))
    mentioned_idents = {i for i in IDENT_RE.findall(text) if i not in NOISE and len(i) >= 3}

    # Strict identifier shape — requires multi-word boundary so single
    # capitalized English words ("Configuration", "Flask", "Architecture")
    # don't inflate the hallucination count. Matches:
    #   - snake_case (`url_for`, `make_response`)
    #   - camelCase (`processForm`, `BatchingSink` — lowercase→uppercase)
    #   - dotted / qualified (`Flask.url_for`, `RSpec::Core`)
    def looks_like_identifier(s: str) -> bool:
        if "_" in s:
            return True
        if "." in s or "::" in s:
            return True
        if re.search(r"[a-z][A-Z]", s):
            return True
        return False

    # Asymmetric application:
    #   - RECALL uses the lenient set (mentioned_idents) so single-word
    #     lowercase function names like `register` still match truth.
    #   - HALLUCINATION uses the strict set (concrete_idents) so prose
    #     and acronyms (`Architecture`, `JSON`, `CLI`, `Flask`) don't
    #     count as hallucinated identifiers.
    concrete_idents = {i for i in mentioned_idents if looks_like_identifier(i)}

    matched_files = mentioned_files & truth_files
    matched_idents = mentioned_idents & truth_idents
    truth_total = len(truth_files) + len(truth_idents)
    recall = ((len(matched_files) + len(matched_idents)) / truth_total) if truth_total else None

    # Hallucination (precision-style): of the *identifier-shaped* things
    # Claude mentioned, how many weren't in the prompt's truth? Still
    # over-counts (truth set is narrow on purpose), but no longer flags
    # English prose. Relative delta is the signal.
    unmatched_files = mentioned_files - truth_files
    unmatched_idents = concrete_idents - truth_idents
    total_concrete = len(mentioned_files) + len(concrete_idents)
    unmatched_total = len(unmatched_files) + len(unmatched_idents)
    hallucination = (unmatched_total / total_concrete) if total_concrete else None

    return {
        "recall": recall,
        "hallucination": hallucination,
        "matched_truth_items": sorted(matched_files | matched_idents),
        "unmatched_files": sorted(unmatched_files)[:10],
        "unmatched_idents": sorted(unmatched_idents)[:20],
        "total_mentioned": total_concrete,
        "total_truth": truth_total,
    }


# ---------------------------------------------------------------------------
# Auto-categorization
# ---------------------------------------------------------------------------

def categorize(
    no_mcp: dict[str, Any],
    with_mcp: dict[str, Any],
) -> str:
    """Recall + delta is the primary signal.

    Hallucination is kept on per-cell records as a *diagnostic*, but not
    used here. The metric over-counts legitimate concrete mentions
    (framework names, class references not in the narrow truth set) and
    misleads more than it informs. See score_run docstring.
    """
    r_with = with_mcp.get("recall")
    r_no = no_mcp.get("recall")

    if r_with is None:
        return "untestable"  # no truth — needs human review

    # Anything below 30% absolute is a real gap regardless of delta —
    # even if MCP doubled a 5% baseline to 10%, the answer is still bad.
    if r_with < 0.3:
        return "gap"

    delta = (r_with - r_no) if r_no is not None else None

    # Solid absolute recall — demo material.
    if r_with >= 0.8:
        return "strong"

    # MCP delivered a meaningful lift even if absolute isn't ace yet.
    if delta is not None and delta >= 0.3:
        return "lifted"

    # MCP barely beat no-MCP — tool may be wrong shape for this prompt.
    if delta is not None and delta < 0.1:
        return "weak-tool"

    return "acceptable"


CATEGORY_DESCRIPTIONS = {
    "strong": "Recall ≥ 80%. Demo / validate / screenshot.",
    "lifted": "MCP added ≥ 30pp to recall. Real tool impact even if absolute isn't perfect yet.",
    "acceptable": "Moderate recall + modest gain. No action needed unless context says otherwise.",
    "weak-tool": "MCP barely beats baseline (delta < 10pp). Reframe — tool may be wrong shape.",
    "gap": "Recall < 30% even with MCP. Architectural debt — plugin / tool needs work.",
    "untestable": "No truth available — needs human read.",
}


# ---------------------------------------------------------------------------
# Findings markdown
# ---------------------------------------------------------------------------

def write_findings(out_path: Path, results: list[dict[str, Any]], manifest: dict[str, Any]) -> None:
    lines: list[str] = []
    lines.append("# Findings\n")
    lines.append(f"_Run {manifest['timestamp']} · model={manifest['model']} · {len(results)} (prompt × repo) cells_\n")

    # Category summary up top
    by_cat: dict[str, int] = {}
    for r in results:
        by_cat[r["category"]] = by_cat.get(r["category"], 0) + 1
    lines.append("## Summary by category\n")
    lines.append("| Category | Count | What it means |")
    lines.append("|---|---|---|")
    for cat in ("strong", "lifted", "acceptable", "weak-tool", "gap", "untestable"):
        if by_cat.get(cat, 0) > 0:
            lines.append(f"| **{cat}** | {by_cat[cat]} | {CATEGORY_DESCRIPTIONS[cat]} |")
    lines.append("")

    # Per-cell detail
    lines.append("## Per-cell results\n")
    lines.append("| Prompt | Repo | Lang | Category | Recall (no/with) | Hallucination (no/with) | Tool calls | Latency |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for r in results:
        rn = r["no_mcp_score"].get("recall")
        rw = r["with_mcp_score"].get("recall")
        hn = r["no_mcp_score"].get("hallucination")
        hw = r["with_mcp_score"].get("hallucination")
        rstr = f"{rn:.0%} / {rw:.0%}" if rn is not None and rw is not None else "—"
        hstr = f"{hn:.0%} / {hw:.0%}" if hn is not None and hw is not None else "—"
        tools = r["with_mcp_run"].get("tool_calls", [])
        latency = r["with_mcp_run"].get("latency_s", 0)
        lines.append(
            f"| {r['prompt_id']} | {r['repo_id']} | {r['language']} | "
            f"**{r['category']}** | {rstr} | {hstr} | {len(tools)} | {latency:.1f}s |"
        )
    lines.append("")

    # Cross-language breakdown — surfaces plugin parity bias
    lines.append("## Cross-language recall (with MCP)\n")
    by_lang: dict[str, list[float]] = {}
    for r in results:
        rw = r["with_mcp_score"].get("recall")
        if rw is not None:
            by_lang.setdefault(r["language"], []).append(rw)
    if by_lang:
        lines.append("| Language | Avg recall | Cells |")
        lines.append("|---|---|---|")
        for lang in sorted(by_lang):
            vals = by_lang[lang]
            lines.append(f"| {lang} | {sum(vals) / len(vals):.0%} | {len(vals)} |")
        lines.append("")

    # Per-cell deep dive — useful for hand-reading
    lines.append("## Cell deep-dive\n")
    for r in results:
        lines.append(f"### {r['prompt_id']} × {r['repo_id']} (`{r['language']}`)\n")
        lines.append(f"**Category:** `{r['category']}`\n")
        lines.append(f"**With-MCP tool calls:** {len(r['with_mcp_run'].get('tool_calls', []))}")
        tools_used = sorted({tc['name'] for tc in r['with_mcp_run'].get('tool_calls', [])})
        if tools_used:
            lines.append(f" — `{', '.join(tools_used)}`\n")
        else:
            lines.append("\n")
        rw = r["with_mcp_score"]
        if rw.get("matched_truth_items"):
            lines.append(f"**Matched truth items ({len(rw['matched_truth_items'])}):** "
                         f"{', '.join(f'`{x}`' for x in rw['matched_truth_items'][:10])}"
                         f"{' ...' if len(rw['matched_truth_items']) > 10 else ''}")
        if rw.get("unmatched_idents"):
            lines.append(f"**Mentioned but not in truth (idents):** "
                         f"{', '.join(f'`{x}`' for x in rw['unmatched_idents'][:10])}"
                         f"{' ...' if len(rw['unmatched_idents']) > 10 else ''}")
        if rw.get("unmatched_files"):
            lines.append(f"**Mentioned but not in truth (files):** "
                         f"{', '.join(f'`{x}`' for x in rw['unmatched_files'][:10])}")
        lines.append("\n_Manual notes:_\n\n- ")
        lines.append("\n---\n")

    out_path.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------

def _filter_subset(
    items: list[Any],
    env_var: str,
    key: str,
) -> list[Any]:
    """Filter items by comma-separated env-var subset (e.g. TARGET_LANGUAGES=ts,go)."""
    raw = os.environ.get(env_var, "").strip()
    if not raw:
        return items
    wanted = {x.strip() for x in raw.split(",") if x.strip()}
    return [it for it in items if getattr(it, key, None) in wanted]


async def main() -> None:
    load_dotenv()
    here = Path(__file__).parent
    config = yaml.safe_load((here / "prompts.yaml").read_text(encoding="utf-8"))

    repos = [TargetRepo(**r) for r in config["target_repos"]]
    prompts = [Prompt(**p) for p in config["prompts"]]

    # Optional subsetting via env vars
    repos = _filter_subset(repos, "TARGET_LANGUAGES", "language") or repos
    prompts = [p for p in prompts if not os.environ.get("PROMPT_IDS")
               or p.id in os.environ["PROMPT_IDS"].split(",")]

    # Drop repos that aren't referenced by any active prompt
    active_repo_ids = {rid for p in prompts for rid in p.target_repos}
    repos = [r for r in repos if r.id in active_repo_ids]

    model = os.environ.get("ANTHROPIC_MODEL", DEFAULT_MODEL)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_root = here / "runs" / timestamp
    run_root.mkdir(parents=True, exist_ok=True)
    truth_root = run_root / "ground_truth"
    truth_root.mkdir(parents=True, exist_ok=True)

    print(f"\n=== eval run {timestamp} ===")
    print(f"  model: {model}")
    print(f"  repos: {len(repos)} ({', '.join(r.id for r in repos)})")
    print(f"  prompts: {len(prompts)} ({', '.join(p.id for p in prompts)})")
    print()

    cfg = GitVisionConfig.from_env()

    # Stage 1: ground truth per repo (one MCP session per repo, all
    # tools called inside it — analyze_repo session ID lives 10 min so
    # this is efficient).
    truths: dict[str, dict[str, Any]] = {}
    analyze_payloads: dict[str, dict[str, Any]] = {}
    print("=== ground truth ===")
    async with open_mcp(cfg) as session:
        for repo in repos:
            print(f"[{repo.id}]")
            truths[repo.id] = await capture_ground_truth(session, repo, prompts, truth_root)
            analyze_payloads[repo.id] = json.loads(
                (truth_root / repo.id / "_analyze.json").read_text()
            )

    # Stage 2: A/B runs
    print("\n=== runs ===")
    client = Anthropic(max_retries=8)
    results: list[dict[str, Any]] = []

    # Write manifest up front so a mid-run crash still leaves a record
    # of what was attempted. result_count gets refreshed at end.
    manifest = {
        "timestamp": timestamp,
        "model": model,
        "repos": [r.__dict__ for r in repos],
        "prompts": [p.__dict__ for p in prompts],
        "result_count": 0,
    }
    (run_root / "manifest.json").write_text(json.dumps(manifest, indent=2))

    for prompt in prompts:
        for repo_id in prompt.target_repos:
            if repo_id not in {r.id for r in repos}:
                continue  # filtered out
            repo = next(r for r in repos if r.id == repo_id)
            print(f"\n[{prompt.id} × {repo.id}]")
            user_msg = _seed_user_message(prompt.prompt, repo)

            print("  no_mcp...")
            no_mcp_run = run_no_mcp(client, model, user_msg)
            print(f"    {no_mcp_run['latency_s']:.1f}s, {no_mcp_run['usage']['output_tokens']}out")

            print("  with_mcp...")
            with_mcp_run = await run_with_mcp(client, model, user_msg, cfg)
            print(f"    {with_mcp_run['latency_s']:.1f}s, "
                  f"{len(with_mcp_run['tool_calls'])} tool calls, "
                  f"{with_mcp_run['usage']['output_tokens']}out")

            # Score
            truth = truths[repo.id].get(prompt.id, {})
            ap = analyze_payloads[repo.id]
            no_mcp_score = score_run(no_mcp_run["text"], prompt, truth, ap)
            with_mcp_score = score_run(with_mcp_run["text"], prompt, truth, ap)
            cat = categorize(no_mcp_score, with_mcp_score)
            print(f"    category: {cat}")

            results.append({
                "prompt_id": prompt.id,
                "repo_id": repo.id,
                "language": repo.language,
                "size_class": repo.size_class,
                "no_mcp_run": no_mcp_run,
                "with_mcp_run": with_mcp_run,
                "no_mcp_score": no_mcp_score,
                "with_mcp_score": with_mcp_score,
                "category": cat,
            })

            # Incremental save — survive any mid-run crash (rate limits,
            # network, MCP stdio hiccup, etc.) without losing scored cells.
            manifest["result_count"] = len(results)
            (run_root / "manifest.json").write_text(json.dumps(manifest, indent=2))
            (run_root / "results.json").write_text(json.dumps(results, indent=2))
            write_findings(run_root / "findings.md", results, manifest)

    # Stage 3: final write (same data; loop already wrote, but keep for clarity)
    manifest["result_count"] = len(results)
    (run_root / "manifest.json").write_text(json.dumps(manifest, indent=2))
    (run_root / "results.json").write_text(json.dumps(results, indent=2))
    write_findings(run_root / "findings.md", results, manifest)

    print(f"\n=== done ===")
    print(f"  findings: {run_root / 'findings.md'}")
    print(f"  raw:      {run_root / 'results.json'}")


if __name__ == "__main__":
    asyncio.run(main())
