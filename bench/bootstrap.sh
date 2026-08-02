#!/usr/bin/env bash
# Rebuild the security benchmark corpora from scratch.
#
# Everything here is re-fetchable, which is the point: the corpora are 3.3 GB
# and do not belong in git, but nothing about them is precious. Run this and
# you have exactly what the numbers in SECURITY_LAYER_PLAN.md were measured on.
#
#   bench/bootstrap.sh              # ~/.codetrawl-bench
#   BENCH=/some/path bench/bootstrap.sh
set -euo pipefail
BENCH="${BENCH:-$HOME/.codetrawl-bench}"
mkdir -p "$BENCH"
echo "bench root: $BENCH"

# 1. The benchmark: ground truth (66 repos), the scorer, the parsers.
if [ ! -d "$BENCH/realvuln/.git" ]; then
  echo "→ cloning Real-Vuln-Benchmark"
  git clone --quiet --filter=blob:none https://github.com/kolega-ai/Real-Vuln-Benchmark.git "$BENCH/realvuln"
else
  echo "→ realvuln present"
fi

# 2. The repos under test, cloned from repo_url in each ground-truth file.
#    TUNED  = the 23 deliberately-vulnerable teaching apps the rules were built against.
#    HELDOUT= the 39 realistic seeded business apps. Keep them SEPARATE: a
#             precision number measured on the tuned set alone is a fit, not a
#             forecast — see SECURITY_LAYER_PLAN.md §4w.
python3 - "$BENCH" <<'PY'
import json, glob, os, subprocess, sys, concurrent.futures as cf
BENCH = sys.argv[1]
jobs = []
for gt in sorted(glob.glob(f"{BENCH}/realvuln/ground-truth/*/ground-truth.json")):
    slug = os.path.basename(os.path.dirname(gt))
    d = json.load(open(gt))
    url, sha = d.get("repo_url", ""), d.get("commit_sha") or ""
    if not url.startswith("https://github.com/"):
        continue
    bucket = "heldout" if slug.startswith("vc-") else "rvrepos"
    dest = f"{BENCH}/{bucket}/{slug}"
    if os.path.isdir(dest):
        continue
    jobs.append((slug, url, sha, dest))

def clone(job):
    slug, url, sha, dest = job
    try:
        subprocess.run(["git", "clone", "--quiet", "--filter=blob:none", url, dest],
                       check=True, capture_output=True, timeout=300)
        if sha:
            subprocess.run(["git", "-C", dest, "checkout", "--quiet", sha],
                           capture_output=True, timeout=120)
        return None
    except Exception:
        return slug

print(f"→ cloning {len(jobs)} corpus repos")
with cf.ThreadPoolExecutor(max_workers=8) as ex:
    failed = [s for s in ex.map(clone, jobs) if s]
if failed:
    print(f"   {len(failed)} unreachable (dead URLs in the benchmark): {', '.join(failed[:5])}")
PY

# 3. Production apps — the false-positive gate. Well-built code where nearly
#    every finding is noise. No rule ships until these three are quiet.
mkdir -p "$BENCH/pyprobe"
for r in zulip/zulip netbox-community/netbox saleor/saleor; do
  name="${r#*/}"
  [ -d "$BENCH/pyprobe/$name" ] && { echo "→ $name present"; continue; }
  echo "→ cloning $name (production FP gate)"
  git clone --quiet --depth 1 --filter=blob:none "https://github.com/$r.git" "$BENCH/pyprobe/$name"
done

echo
echo "done. now:  BENCH=$BENCH bench/run.sh"
