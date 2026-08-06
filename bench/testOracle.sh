#!/usr/bin/env bash
# GROUND TRUTH for the blast-radius claim "these are the tests worth running".
#
# Runs each test file ALONE with coverage and records which source files it
# actually executes. Inverts into: for every source file, the exact set of test
# files that exercise it — no mutation, no approximation, no third party.
set -uo pipefail
OUT="${1:-${BENCH:-$HOME/.codetrawl-bench}/oracles/cov}"; mkdir -p "$OUT"
TOTAL=$(find lib components app \( -name '*.test.ts' -o -name '*.test.tsx' \) 2>/dev/null | wc -l | tr -d ' ')
echo "test files: $TOTAL"
i=0
find lib components app \( -name '*.test.ts' -o -name '*.test.tsx' \) 2>/dev/null | sort | while read -r f; do
  i=$((i+1))
  key=$(echo "$f" | tr '/' '_')
  if [ ! -f "$OUT/$key.json" ]; then
    npx vitest run "$f" --coverage.enabled --coverage.provider=v8 \
        --coverage.reporter=json --coverage.reportsDirectory="$OUT/tmp-$key" \
        >/dev/null 2>&1
    [ -f "$OUT/tmp-$key/coverage-final.json" ] && mv "$OUT/tmp-$key/coverage-final.json" "$OUT/$key.json"
    rm -rf "$OUT/tmp-$key"
  fi
  [ $((i % 20)) -eq 0 ] && echo "  $i/$TOTAL"
done
echo "done -> $OUT"
