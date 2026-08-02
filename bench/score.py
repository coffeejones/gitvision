#!/usr/bin/env python3
"""Score CodeTrawl against the RealVuln ground truth, on BOTH corpora.

Always reports both. Every rule in SECURITY_LAYER_PLAN.md was narrowed against
the 23 tuned repos, so a precision number from that set alone is a fit, not a
forecast — the held-out 39 are the honest test (§4w).

  BENCH=~/.codetrawl-bench python3 bench/score.py
  python3 bench/score.py --scanner codetrawl-surfaced   # what the panel shows
  python3 bench/score.py --compare                      # vs every other tool
"""
import argparse, collections, glob, json, os, sys

BENCH = os.environ.get("BENCH", os.path.expanduser("~/.codetrawl-bench"))
RV = f"{BENCH}/realvuln"
sys.path.insert(0, RV)
try:
    from parsers.semgrep import SemgrepParser
    from scorer.matcher import load_ground_truth, match_findings
except ImportError:
    sys.exit(f"benchmark not found under {RV} — run bench/bootstrap.sh first")


def corpora():
    """(name, slugs) for each corpus. Held-out = the vc-* seeded business apps."""
    held, tuned = set(), set()
    for gt in glob.glob(f"{RV}/ground-truth/*/ground-truth.json"):
        slug = os.path.basename(os.path.dirname(gt))
        # Only score repos actually on disk.
        for bucket, s in (("heldout", held), ("rvrepos", tuned)):
            if os.path.isdir(f"{BENCH}/{bucket}/{slug}"):
                s.add(slug)
    return [("TUNED (teaching apps)", tuned), ("HELD-OUT (business apps)", held)]


def score(scanner, slugs, results_root):
    tp = fp = fn = traps = trap_total = 0
    for gt in sorted(glob.glob(f"{RV}/ground-truth/*/ground-truth.json")):
        slug = os.path.basename(os.path.dirname(gt))
        if slug not in slugs:
            continue
        d = json.load(open(gt))
        trap_total += len([x for x in d.get("findings", []) if not x.get("is_vulnerable")])
        res = f"{results_root}/{slug}/{scanner}/results.json"
        if not os.path.exists(res):
            continue
        for m in match_findings(SemgrepParser("x").parse(res), load_ground_truth(gt)):
            if m.classification == "TP":
                tp += 1
            elif m.classification == "FN":
                fn += 1
            elif m.classification == "FP":
                fp += 1
                e = m.ground_truth_entry
                if isinstance(e, dict) and e.get("is_vulnerable") is False:
                    traps += 1
    return tp, fp, fn, traps, trap_total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scanner", default="codetrawl-detect")
    ap.add_argument("--results", default=f"{RV}/scan-results")
    ap.add_argument("--compare", action="store_true", help="score every scanner present")
    a = ap.parse_args()

    for name, slugs in corpora():
        if not slugs:
            continue
        print(f"\n{name} — {len(slugs)} repos")
        scanners = [a.scanner]
        if a.compare:
            found = set()
            for d in glob.glob(f"{a.results}/*"):
                if os.path.basename(d) in slugs:
                    found |= {s for s in os.listdir(d)
                              if os.path.exists(os.path.join(d, s, "results.json"))}
            scanners = sorted(found)
        rows = []
        for sc in scanners:
            tp, fp, fn, traps, trap_total = score(sc, slugs, a.results)
            if tp + fp + fn == 0:
                continue
            p = tp / (tp + fp) if tp + fp else 0.0
            r = tp / (tp + fn) if tp + fn else 0.0
            rows.append((sc, tp, fp, p, r, 2 * p * r / (p + r) if p + r else 0.0,
                         trap_total - traps, trap_total))
        rows.sort(key=lambda x: -x[3])
        print(f"  {'scanner':<40} {'TP':>5} {'FP':>5} {'prec':>6} {'recall':>7} {'F1':>6}   traps")
        for sc, tp, fp, p, r, f1, clean, total in rows:
            mark = "  <-- us" if sc.startswith("codetrawl") else ""
            print(f"  {sc:<40} {tp:>5} {fp:>5} {p:>6.3f} {r:>7.3f} {f1:>6.3f}   {clean}/{total}{mark}")


if __name__ == "__main__":
    main()
