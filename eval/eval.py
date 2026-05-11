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
    ground_truth: dict[str, Any]
    primary_metric: str
    # Static prompts (P1-P4) use `prompt`. Template prompts (P5-P7) leave
    # `prompt` empty and use `prompt_template` + `template_kind` — the
    # template renderer fills in seed values picked from MCP output at
    # capture time. Rendered text is stored in truth["_rendered_prompt"]
    # so re-scoring can reuse it without re-rendering.
    prompt: str = ""
    prompt_template: str = ""
    template_kind: str = ""
    # For template_kind="diff_pair": per-repo {base, head} git refs. The
    # capture handler runs analyze_repo at each ref and analyze_diff
    # against the resulting session pair. Shape:
    #   ref_pairs: { "repo_id": { "base": "v3.0.0", "head": "main" } }
    ref_pairs: dict[str, dict[str, str]] = field(default_factory=dict)
    # Cap the number of items used for recall scoring. Set on prompts
    # whose underlying tool can produce huge truth sets (diff_pair can
    # easily return 300+ changes in a real PR). Without it, even a
    # perfect narrative answer scores <5% recall — see the run analysis
    # in eval/strategy/. 0 = no cap (use everything). Default in
    # _handle_diff_pair is 10 when unset.
    truth_top_n: int = 0


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


# ---------------------------------------------------------------------------
# Template handlers — for prompts whose input is selected from MCP output
# (P5/P6/P7). Each handler returns a truth payload that includes the
# rendered prompt text + the structured truth set. Empty payloads (no
# seed available) get marked _skipped and produce untestable cells.
# ---------------------------------------------------------------------------

def _seed_format_kwargs(seed: dict[str, Any]) -> dict[str, Any]:
    """Build the format() kwargs we pass into prompt templates. fn_qualname
    is the most useful field — it's the "Class.method" form when there's
    a container (Java/Ruby/C#/Python class methods) or just the bare name
    for module-level functions (Go/JS top-level). Without this Claude
    can't pass `container` to blast_radius and lands on the wrong
    overload — that's the Ruby P6 regression bug."""
    name = seed.get("name", "?")
    container = seed.get("containerType", "") or ""
    qualname = f"{container}.{name}" if container else name
    return {
        "fn_name": name,
        "fn_file": seed.get("filePath", "?"),
        "fn_complexity": seed.get("complexity", "?"),
        "fn_container": container,
        "fn_qualname": qualname,
    }


async def _handle_hotspot_blast(
    session: ClientSession, prompt: Prompt, session_id: str, repo: TargetRepo
) -> dict[str, Any]:
    """P6: pick the top untested hotspot, capture its blast_radius as truth."""
    uh_args: dict[str, Any] = {"sessionId": session_id, **prompt.ground_truth.get("selector_args", {})}
    uh = await call_tool(session, "untested_hotspots", uh_args)
    uh_data = json.loads(uh["text"]) if uh["text"] else {}
    hotspots = (uh_data.get("hotspots") or [])
    if not hotspots:
        return {"_skipped": True, "_reason": "no untested hotspots for selector"}
    seed = hotspots[0]
    br_args: dict[str, Any] = {
        "sessionId": session_id,
        "file": seed["filePath"],
        "fn": seed["name"],
    }
    if seed.get("containerType"):
        br_args["container"] = seed["containerType"]
    br = await call_tool(session, "blast_radius", br_args)
    br_data = json.loads(br["text"]) if br["text"] else {}
    rendered = prompt.prompt_template.format(**_seed_format_kwargs(seed))
    return {"_seed": seed, "_rendered_prompt": rendered, **br_data}


async def _handle_hotspot_pr(
    session: ClientSession, prompt: Prompt, session_id: str, repo: TargetRepo
) -> dict[str, Any]:
    """P5: simulate PR review on top hotspot. Synthesizes
    untested_hotspots + blast_radius + find_duplicates relevant to the
    same file. Tests Claude's ability to chain signals."""
    uh_args = {"sessionId": session_id, "limit": 5}
    uh = await call_tool(session, "untested_hotspots", uh_args)
    uh_data = json.loads(uh["text"]) if uh["text"] else {}
    hotspots = uh_data.get("hotspots") or []
    if not hotspots:
        return {"_skipped": True, "_reason": "no untested hotspots"}
    seed = hotspots[0]
    co_hotspots = [
        h for h in hotspots[1:]
        if h.get("filePath") == seed.get("filePath") and h.get("name") != seed.get("name")
    ]
    br_args: dict[str, Any] = {
        "sessionId": session_id,
        "file": seed["filePath"],
        "fn": seed["name"],
    }
    if seed.get("containerType"):
        br_args["container"] = seed["containerType"]
    br = await call_tool(session, "blast_radius", br_args)
    br_data = json.loads(br["text"]) if br["text"] else {}
    fd = await call_tool(session, "find_duplicates", {"sessionId": session_id})
    fd_data = json.loads(fd["text"]) if fd["text"] else {}
    relevant_dupes: list[dict[str, Any]] = []
    for g in fd_data.get("groups") or []:
        if any(m.get("filePath") == seed.get("filePath") for m in g.get("members") or []):
            relevant_dupes.append(g)
    rendered = prompt.prompt_template.format(**_seed_format_kwargs(seed))
    return {
        "_seed": seed,
        "_rendered_prompt": rendered,
        "co_hotspots": co_hotspots,
        "blast_radius": br_data,
        "duplicates": relevant_dupes,
    }


async def _handle_duplicate_intent(
    session: ClientSession, prompt: Prompt, session_id: str, repo: TargetRepo
) -> dict[str, Any]:
    """P7: pick a duplicate group, use first member as 'intent', other
    members as truth. Tests Claude's ability to find existing utilities
    before writing new code."""
    fd = await call_tool(session, "find_duplicates", {"sessionId": session_id})
    fd_data = json.loads(fd["text"]) if fd["text"] else {}
    groups = fd_data.get("groups") or []
    target_group = next(
        (g for g in groups if len(g.get("members") or []) >= 2), None
    )
    if not target_group:
        return {"_skipped": True, "_reason": "no duplicate group with ≥2 members"}
    members = target_group["members"]
    seed = members[0]
    others = members[1:]
    rendered = prompt.prompt_template.format(
        seed_fn=seed.get("name", "?"),
        seed_file=seed.get("filePath", "?"),
        seed_complexity=seed.get("complexity", "?"),
    )
    return {
        "_seed": seed,
        "_rendered_prompt": rendered,
        "other_members": others,
        "_group_size": len(members),
    }


def _change_priority(c: dict[str, Any]) -> float:
    """Heuristic 'how impactful is this change?' score for sorting top-N.
    Modified functions ranked by complexity-delta magnitude; added/removed
    by the surviving complexity value. Unchanged ranked last."""
    status = c.get("status")
    if status == "modified":
        return abs(c.get("complexityDelta") or 0)
    if status == "added":
        return float(c.get("complexityAfter") or 0)
    if status == "removed":
        return float(c.get("complexityBefore") or 0)
    return 0.0  # unchanged


async def _handle_diff_pair(
    session: ClientSession, prompt: Prompt, session_id: str, repo: TargetRepo
) -> dict[str, Any]:
    """P8 (diff_pair): analyze_repo twice at different refs, then
    analyze_diff for the truth set. Tests the full diff-aware workflow
    end-to-end. session_id (the default-branch session captured at the
    start of capture_ground_truth) is ignored here — we always make our
    own analyze_repo calls so base/head are explicit.

    Truth curation: by default we expose only the top-N changes by
    impact (complexity delta for modified, complexity value for
    added/removed) as the scoring-relevant `changes` field. The full
    list is preserved under `_full_changes` for human inspection but
    not scored — large PRs would otherwise create 300+ truth items
    against which any narrative top-5 answer scores < 5% recall. Set
    `truth_top_n` on the prompt config to override (default 10)."""
    refs = prompt.ref_pairs.get(repo.id)
    if not refs or not refs.get("base") or not refs.get("head"):
        return {
            "_skipped": True,
            "_reason": f"no ref_pairs entry for {repo.id} in prompt.ref_pairs",
        }
    base_ref = refs["base"]
    head_ref = refs["head"]

    base_args: dict[str, Any] = {"repoUrl": repo.url, "ref": base_ref}
    if repo.subdir:
        base_args["subdir"] = repo.subdir
    print(f"      analyze_repo {repo.url} (ref={base_ref})")
    base_result = await call_tool(session, "analyze_repo", base_args)
    base_payload = json.loads(base_result["text"]) if base_result["text"] else {}
    base_session_id = base_payload.get("sessionId")
    if not base_session_id:
        return {"_skipped": True, "_reason": f"analyze_repo at ref={base_ref} returned no sessionId"}

    head_args: dict[str, Any] = {"repoUrl": repo.url, "ref": head_ref}
    if repo.subdir:
        head_args["subdir"] = repo.subdir
    print(f"      analyze_repo {repo.url} (ref={head_ref})")
    head_result = await call_tool(session, "analyze_repo", head_args)
    head_payload = json.loads(head_result["text"]) if head_result["text"] else {}
    head_session_id = head_payload.get("sessionId")
    if not head_session_id:
        return {"_skipped": True, "_reason": f"analyze_repo at ref={head_ref} returned no sessionId"}

    print(f"      analyze_diff (base={base_ref} vs head={head_ref})")
    diff_result = await call_tool(
        session,
        "analyze_diff",
        {"baseSessionId": base_session_id, "headSessionId": head_session_id},
    )
    diff_payload = json.loads(diff_result["text"]) if diff_result["text"] else {}

    rendered = prompt.prompt_template.format(
        ref_base=base_ref,
        ref_head=head_ref,
        repo_name=repo.id,
    )

    # Curate top-N changes for scoring. Sort by impact heuristic, take
    # top N (default 10), and stash the rest under _full_changes (won't
    # be scored — metadata convention).
    top_n = prompt.truth_top_n or 10
    all_changes = list(diff_payload.get("changes") or [])
    all_changes.sort(key=_change_priority, reverse=True)
    curated = all_changes[:top_n]
    overflow = all_changes[top_n:]

    return {
        "_seed": {"base_ref": base_ref, "head_ref": head_ref, "repo": repo.id},
        "_rendered_prompt": rendered,
        "_base_session_id": base_session_id,
        "_head_session_id": head_session_id,
        "_full_changes": overflow,
        "summary": diff_payload.get("summary"),
        "changes": curated,
    }


TEMPLATE_HANDLERS = {
    "hotspot_blast": _handle_hotspot_blast,
    "hotspot_pr": _handle_hotspot_pr,
    "duplicate_intent": _handle_duplicate_intent,
    "diff_pair": _handle_diff_pair,
}


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

        if prompt.template_kind:
            handler = TEMPLATE_HANDLERS.get(prompt.template_kind)
            if handler is None:
                raise RuntimeError(
                    f"Unknown template_kind '{prompt.template_kind}' for {prompt.id}"
                )
            print(f"    [{prompt.template_kind}] {prompt.id}")
            payload = await handler(session, prompt, session_id, repo)
            truths[prompt.id] = payload
            (repo_dir / f"{prompt.id}.json").write_text(json.dumps(payload, indent=2))
        elif tool == "analyze_repo":
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


def _collect_recursive(
    obj: Any, files: set[str], idents: set[str], skip_keys: tuple[str, ...] = ()
) -> None:
    """Walk a nested dict/list and collect any value under `filePath`,
    `file`, or `name`. Used by templated-prompt truths where the shape
    is irregular (union of multiple tool outputs).

    Convention: keys starting with `_` are metadata (e.g. `_seed`,
    `_rendered_prompt`, `_full_diff`) and are skipped during truth
    collection. This lets handlers stash raw/uncurated data alongside
    the scoring-relevant data without polluting the recall numerator.

    `skip_keys` is the explicit-skip escape hatch (e.g. P7 uses it to
    exclude the seed function from truth — Claude is supposed to
    discover the *other* members of the duplicate group)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in skip_keys:
                continue
            if isinstance(k, str) and k.startswith("_"):
                continue  # metadata convention — see docstring
            if k in ("filePath", "file") and isinstance(v, str):
                files.add(v)
            elif k == "name" and isinstance(v, str):
                idents.add(v)
            else:
                _collect_recursive(v, files, idents, skip_keys)
    elif isinstance(obj, list):
        for item in obj:
            _collect_recursive(item, files, idents, skip_keys)


def _truth_items(prompt: Prompt, truth: Any) -> tuple[set[str], set[str]]:
    """Extract (file_paths, identifier_names) from the prompt's ground
    truth payload. Static prompts (P1-P4) use shape-specific handlers
    below; templated prompts use a generic recursive scanner."""
    files: set[str] = set()
    idents: set[str] = set()

    # Templated prompts (P5/P6/P7) — generic recursive scan
    if prompt.template_kind:
        if (truth or {}).get("_skipped"):
            return files, idents  # empty → recall=None → category="untestable"
        # P7: Claude shouldn't get credit for repeating the seed — those
        # values are part of the *question*, not the answer.
        skip_keys: tuple[str, ...] = ()
        if prompt.template_kind == "duplicate_intent":
            skip_keys = ("_seed",)
        _collect_recursive(truth, files, idents, skip_keys)
        return files, idents

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
    load_dotenv(override=True)  # .env wins over shell exports (some shells set empty ANTHROPIC_API_KEY)
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

            # Templated prompts may have skipped (no seed available);
            # treat as untestable and skip the runs.
            truth = truths[repo.id].get(prompt.id, {})
            if prompt.template_kind and (truth or {}).get("_skipped"):
                print(f"    skipped: {truth.get('_reason', 'no seed')}")
                continue

            prompt_text = truth.get("_rendered_prompt") if prompt.template_kind else prompt.prompt
            prompt_text = prompt_text or prompt.prompt
            user_msg = _seed_user_message(prompt_text, repo)

            print("  no_mcp...")
            no_mcp_run = run_no_mcp(client, model, user_msg)
            print(f"    {no_mcp_run['latency_s']:.1f}s, {no_mcp_run['usage']['output_tokens']}out")

            print("  with_mcp...")
            with_mcp_run = await run_with_mcp(client, model, user_msg, cfg)
            print(f"    {with_mcp_run['latency_s']:.1f}s, "
                  f"{len(with_mcp_run['tool_calls'])} tool calls, "
                  f"{with_mcp_run['usage']['output_tokens']}out")

            # Score (truth already resolved above)
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
