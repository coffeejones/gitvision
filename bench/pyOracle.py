#!/usr/bin/env python3
"""Blast-radius ground truth for a PYTHON repo.

Two phases, same as the TypeScript side:
  coverage  — which tests EXECUTE each source file (used to pick live mutation
              sites; on its own it over-counts badly)
  mutation  — which tests FAIL when the file is broken. This is the honest
              denominator.

  python3 bench/pyOracle.py <repo> coverage
  python3 bench/pyOracle.py <repo> mutate <file> [<file> ...]
"""
import json, os, re, subprocess, sys

REPO = os.path.abspath(sys.argv[1])
PY = os.path.join(REPO, ".venv/bin/python")
COV = "/tmp/pycov"


def test_files():
    out = []
    for root, _, files in os.walk(os.path.join(REPO, "tests")):
        for f in files:
            if f.startswith("test_") and f.endswith(".py"):
                out.append(os.path.relpath(os.path.join(root, f), REPO))
    return sorted(out)


def run_pytest(args, timeout=900):
    return subprocess.run([PY, "-m", "pytest", *args], cwd=REPO,
                          capture_output=True, text=True, timeout=timeout)


def failing():
    """Test FILES with at least one failure."""
    r = run_pytest(["tests", "-q", "--no-header", "-p", "no:randomly"])
    return {m.group(1) for m in re.finditer(r"^FAILED (\S+?)::", r.stdout, re.M)}


def coverage_phase():
    os.makedirs(COV, exist_ok=True)
    files = test_files()
    print(f"test files: {len(files)}", file=sys.stderr)
    for i, t in enumerate(files, 1):
        key = t.replace("/", "@")           # "@" cannot appear in a path here,
        out = f"{COV}/{key}.json"           # so this inversion is lossless.
        if os.path.exists(out):
            continue
        subprocess.run([PY, "-m", "coverage", "run", "--source", "src",
                        "-m", "pytest", t, "-q", "--no-header"],
                       cwd=REPO, capture_output=True, timeout=900)
        j = subprocess.run([PY, "-m", "coverage", "json", "-o", "-", "-q"],
                           cwd=REPO, capture_output=True, text=True, timeout=300)
        try:
            data = json.loads(j.stdout)
            hit = {f: v["executed_lines"] for f, v in data.get("files", {}).items()
                   if v.get("executed_lines")}
            open(out, "w").write(json.dumps({"test": t, "executed": hit}))
        except Exception:
            pass
        if i % 5 == 0:
            print(f"  {i}/{len(files)}", file=sys.stderr)
    print(f"done -> {COV}", file=sys.stderr)


FLIPS = [(" == ", " != "), (" != ", " == "), (" >= ", " < "), (" <= ", " > "),
         ("True", "False"), ("False", "True"), (" and ", " or ")]


def executed_lines(rel):
    hit = set()
    if not os.path.isdir(COV):
        return hit
    for f in os.listdir(COV):
        if not f.endswith(".json"):
            continue
        try:
            d = json.load(open(f"{COV}/{f}"))
        except Exception:
            continue
        for path, lines in d.get("executed", {}).items():
            if os.path.normpath(path) == os.path.normpath(rel):
                hit.update(lines)
    return hit


def mutants(src, live, maxn):
    """Spread mutants across the file. Reassigning the loop variable does NOT
    skip iterations in Python — the first version did that and clustered every
    mutant in the imports at the top, reporting zero guards for files the suite
    covers thoroughly. Track the next allowed index explicitly."""
    out, lines = [], src.split("\n")
    stride = max(1, len(lines) // (maxn + 1))
    next_ok = 0
    for i, line in enumerate(lines):
        if len(out) >= maxn:
            break
        if i < next_ok:
            continue
        t = line.strip()
        if not t or t.startswith("#") or t.startswith('"') or t.startswith("'"):
            continue
        if live and (i + 1) not in live:
            continue
        for a, b in FLIPS:
            if a not in line:
                continue
            copy = list(lines)
            copy[i] = line.replace(a, b, 1)
            out.append(("\n".join(copy), f"L{i+1}: {a.strip()}->{b.strip()}"))
            next_ok = i + stride
            break
    return out


def mutate_phase(targets, maxn):
    base = failing()
    print(f"baseline failures (excluded): {sorted(base) or 'none'}", file=sys.stderr)
    result = {}
    for rel in targets:
        path = os.path.join(REPO, rel)
        original = open(path).read()
        live = executed_lines(rel)
        muts = mutants(original, live, maxn)
        guards = set()
        try:
            for text, _what in muts:
                open(path, "w").write(text)
                guards |= (failing() - base)
        finally:
            open(path, "w").write(original)
        result[rel] = sorted(guards)
        print(f"  {rel}: {len(muts)} mutants over {len(live)} live lines -> "
              f"{len(guards)} guarding test files", file=sys.stderr)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    mode = sys.argv[2]
    if mode == "coverage":
        coverage_phase()
    else:
        mutate_phase(sys.argv[3:], int(os.environ.get("MUTANTS", "3")))
