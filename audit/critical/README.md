# Critical — fix this week

**Status (2026-05-13): all resolved.** 3 of 5 originally flagged items were
real bugs and have been fixed. The other 2 turned out to be false
positives on verification (moved to the rejected list in
[../README.md](../README.md)).

---

## Fixed

- [x] **SEC** `app/api/debug/code-analysis/route.ts` — production guard added
  - Both GET and POST now short-circuit with 404 when `NODE_ENV === "production"`. Dev + test environments retain access (the endpoint exists for development feedback loops). Verified by regression test in `lib/__tests__/debugEndpointGuard.test.ts`.

- [x] **BUG** `lib/storage.ts` — session writes now atomic
  - Extracted `atomicWriteJson` to shared `lib/atomicWrite.ts`. `lib/storage.ts` (4 call sites), `lib/jobs.ts`, and `lib/feedback.ts` now all use it — previously the latter two had inline copies and `storage.ts` used plain `fs.writeFile`. Resolves the root cause AND closes a DRY issue from the `when-time/` bucket.

- [x] **BUG** `lib/codeAnalysis/runtime.ts` — cached-rejection recovery
  - `ensureRuntime` now clears the singleton on rejection so the next caller re-attempts init. Previous behavior: a single failed boot poisoned the cache forever, leaving the entire code-analysis pipeline broken until process restart. Verified by regression test in `lib/__tests__/runtimeRecovery.test.ts`.

## Verified false positives (do not fix)

- ❌ **`lib/depsHealth/ecosystems/npm.ts:31`** — "scoped npm packages silently fail"
  - **Verified false:** `curl -H "Accept: application/vnd.npm.install-v1+json" "https://registry.npmjs.org/%40types%2Fnode"` returns the full package metadata (200 OK, `name`, `dist-tags.latest`, 2333 versions). The registry handles `%40%2F`-encoded scoped paths correctly. Encoding behavior is RFC-compliant.

- ❌ **`lib/depsHealth/index.ts:46`** — "ref='HEAD' literal sent to GitHub Trees API"
  - **Verified false:** GitHub Trees API accepts the literal string `"HEAD"` as a ref. Tested against `pallets/flask`: `GET /repos/pallets/flask/git/trees/HEAD` returns a valid tree with 15 entries. This is documented GitHub behavior.

Both false positives were "confirmed in both rounds" by the audit — a
useful reminder that LLM-agent consensus is correlation, not truth.
Verification took ~1 minute per item; the saved effort was real (changing
correct-and-working code would have made things worse).

Both moved to the `audit/README.md` rejected list with the verification
evidence.
