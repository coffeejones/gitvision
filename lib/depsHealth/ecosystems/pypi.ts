// PyPI (Python) ecosystem plugin.
// Manifests supported:
//   - pyproject.toml  (PEP 621 / Poetry / Hatch / Flit — all TOML dialects)
//   - requirements.txt (and common variants like requirements-dev.txt)
// Registry:  https://pypi.org/pypi/<name>/json
// OSV:       "PyPI"
//
// Python packaging is the most fragmented of the big three — pyproject.toml
// has three popular dialects (PEP 621 [project], Poetry [tool.poetry],
// Hatch/flit [tool.flit]) each with a different dep shape. We parse all of
// them, plus plain requirements.txt. setup.py is skipped — it's executable
// Python, not declarative.

import TOML from "@iarna/toml";
import type { DepScope } from "../../types";
import type { DeclaredPackage, EcosystemPlugin, PackageMeta } from "../types";

/** PEP 503 name normalization — lowercase, runs of _/. → single "-". */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[._]+/g, "-");
}

/** Lane for a requirements*.txt file, by path convention (not project-
 *  specific). A project's RUNTIME manifest sits at the repo root, so only a
 *  root-level "requirements.txt" counts as runtime (the common shape for an
 *  app without a pyproject). Anything else is dev/test/docs/sample tooling
 *  and must NOT drive the repo's verdict:
 *    - nested in a subdirectory — examples/celery/requirements.txt, a
 *      docs/ or sample sub-app's pins, a requirements/ lock dir
 *    - suffixed — requirements-dev.txt, requirements.test.txt
 *  (Flask's false "vulnerable deps" all came from examples/celery/
 *  requirements.txt — an example app's full pinned tree, not Flask's deps.) */
function requirementsScope(path: string): DepScope {
  return path.toLowerCase() === "requirements.txt" ? "runtime" : "dev";
}

// ------------------- Requirement-line parsing -------------------
// Matches lines like:
//   requests==2.31.0
//   requests>=2.0,<3.0
//   requests[security]~=2.31
//   requests @ https://example.com/pkg.tar.gz   (skip — URL-pinned)
//   # comment lines and blank lines are ignored
//   -r other.txt     (skip — we already walk all requirements*.txt separately)
//   -e .             (skip — editable install)
const REQ_LINE_RE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*([=<>!~].*)?$/;

function parseRequirementLine(
  line: string
): { name: string; version: string } | null {
  const stripped = line.split("#")[0].trim(); // strip inline comments
  if (!stripped) return null;
  if (stripped.startsWith("-")) return null; // -r, -e, -c, --index-url, etc.
  if (stripped.includes(" @ ")) return null; // URL-pinned install
  const m = stripped.match(REQ_LINE_RE);
  if (!m) return null;
  const name = m[1];
  // Normalize name: PEP 503 — lowercase and replace _/. with -
  const normalized = name.toLowerCase().replace(/[._]+/g, "-");
  const version = (m[2] ?? "").trim();
  if (!version) {
    // Bare "requests" without version — we'll treat as "*", return anyway so
    // it's counted in totals but the normalizer will reject it for registry
    // lookup (so no meta/CVE query runs).
    return { name: normalized, version: "*" };
  }
  return { name: normalized, version };
}

/** Strip PEP 440 range prefixes down to a concrete baseline version.
 *  Returns null for unresolvable specs (URLs, `*`, environment markers). */
export function normalizePyPiVersion(raw: string): string | null {
  // Drop environment markers: "requests>=2.0; python_version >= '3.7'"
  const noMarker = raw.split(";")[0].trim();
  // Strip leading comparators
  const cleaned = noMarker.replace(/^[=<>!~\s]+/, "");
  if (!cleaned || !/^\d/.test(cleaned)) return null;
  // Take the first version in ">=1.0,<2.0" or "~=2.31"
  const first = cleaned.split(/[,\s|]+/)[0];
  if (!/^\d+/.test(first)) return null;
  return first;
}

// ------------------- pyproject.toml parsing -------------------

interface PyProjectToml {
  project?: {
    name?: string;
    // PEP 621 flat list: ["requests>=2.0", "click~=8.0", ...]
    dependencies?: string[];
    // Optional deps grouped: { dev: [...], test: [...] }
    "optional-dependencies"?: Record<string, string[]>;
  };
  tool?: {
    poetry?: {
      name?: string;
      // Poetry shape: { "package-name": "^1.0" } or { name: { version, ... } }
      dependencies?: Record<string, PoetryDepValue>;
      "dev-dependencies"?: Record<string, PoetryDepValue>;
      group?: Record<string, { dependencies?: Record<string, PoetryDepValue> }>;
    };
    flit?: {
      metadata?: {
        requires?: string[];
      };
    };
  };
}

type PoetryDepValue =
  | string
  | { version?: string; git?: string; path?: string; url?: string };

function extractPoetryVersion(value: PoetryDepValue): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    if (value.git || value.path || value.url) return null;
    if (typeof value.version === "string") return value.version;
  }
  return null;
}

function pep621Add(
  declared: DeclaredPackage[],
  path: string,
  specs: string[] | undefined,
  scope: DepScope
) {
  if (!specs) return;
  for (const spec of specs) {
    const parsed = parseRequirementLine(spec);
    if (parsed) {
      declared.push({
        name: parsed.name,
        declared: parsed.version,
        sourcePath: path,
        scope,
      });
    }
  }
}

function poetryAdd(
  declared: DeclaredPackage[],
  path: string,
  deps: Record<string, PoetryDepValue> | undefined,
  scope: DepScope
) {
  if (!deps) return;
  for (const [rawName, value] of Object.entries(deps)) {
    if (rawName === "python") continue; // Poetry declares Python runtime here
    const version = extractPoetryVersion(value);
    if (!version) continue;
    declared.push({
      name: normalizeName(rawName),
      declared: version,
      sourcePath: path,
      scope,
    });
  }
}

function parsePyProject(path: string, content: string): DeclaredPackage[] {
  let toml: PyProjectToml;
  try {
    toml = TOML.parse(content) as PyProjectToml;
  } catch {
    return [];
  }

  const declared: DeclaredPackage[] = [];

  // PEP 621 — [project.dependencies] are runtime; optional-dependencies
  // groups (dev/test/docs/...) are dev.
  pep621Add(declared, path, toml.project?.dependencies, "runtime");
  if (toml.project?.["optional-dependencies"]) {
    for (const group of Object.values(toml.project["optional-dependencies"])) {
      pep621Add(declared, path, group, "dev");
    }
  }

  // Poetry — main deps are runtime; dev-dependencies + every group are dev.
  const poetry = toml.tool?.poetry;
  poetryAdd(declared, path, poetry?.dependencies, "runtime");
  poetryAdd(declared, path, poetry?.["dev-dependencies"], "dev");
  if (poetry?.group) {
    for (const g of Object.values(poetry.group)) {
      poetryAdd(declared, path, g.dependencies, "dev");
    }
  }

  // Flit — [tool.flit.metadata.requires] are runtime.
  pep621Add(declared, path, toml.tool?.flit?.metadata?.requires, "runtime");

  return declared;
}

function parseRequirementsTxt(
  path: string,
  content: string
): DeclaredPackage[] {
  const scope = requirementsScope(path);
  const declared: DeclaredPackage[] = [];
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseRequirementLine(line);
    if (parsed) {
      declared.push({
        name: parsed.name,
        declared: parsed.version,
        sourcePath: path,
        scope,
      });
    }
  }
  return declared;
}

// ------------------- Registry -------------------

async function fetchPyPiMeta(
  name: string,
  current: string
): Promise<PackageMeta | null> {
  try {
    const res = await fetch(
      `https://pypi.org/pypi/${encodeURIComponent(name)}/json`,
      {
        headers: {
          "User-Agent": "RepoJury (https://github.com/coffeejones/repobaron)",
          Accept: "application/json",
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();

    const latest: string | null = data.info?.version ?? null;
    // releases is an object keyed by version → array of file uploads.
    // Each file has upload_time and optional yanked flag.
    interface ReleaseFile {
      upload_time?: string;
      yanked?: boolean;
      yanked_reason?: string;
    }
    const releases: Record<string, ReleaseFile[]> = data.releases ?? {};
    const timeOfCurrent = releases[current]?.[0]?.upload_time ?? null;
    const timeOfLatest = latest ? releases[latest]?.[0]?.upload_time ?? null : null;

    // PyPI yanked flag lives on each file entry. If all files for the
    // current version are yanked, treat as deprecated.
    const currentFiles = releases[current] ?? [];
    const allYanked =
      currentFiles.length > 0 &&
      currentFiles.every((f) => f.yanked === true);
    const deprecated = allYanked
      ? `Version ${current} was yanked from PyPI`
      : null;

    return {
      latest,
      timeOfCurrent,
      timeOfLatest,
      deprecated,
    };
  } catch {
    return null;
  }
}

// ------------------- Plugin -------------------

const REQUIREMENTS_FILE_RE = /(^|\/)(?:requirements[^/]*\.txt)$/i;

export const pypiPlugin: EcosystemPlugin = {
  name: "pypi",
  displayName: "PyPI",
  osvEcosystem: "PyPI",

  isManifest(path) {
    if (path === "pyproject.toml" || path.endsWith("/pyproject.toml")) return true;
    if (REQUIREMENTS_FILE_RE.test(path)) return true;
    return false;
  },

  parseManifest(path, content) {
    if (path.endsWith("pyproject.toml")) return parsePyProject(path, content);
    if (REQUIREMENTS_FILE_RE.test(path)) return parseRequirementsTxt(path, content);
    return [];
  },

  selfName(path, content) {
    if (!path.endsWith("pyproject.toml")) return null;
    try {
      const toml = TOML.parse(content) as PyProjectToml;
      const n = toml.project?.name ?? toml.tool?.poetry?.name ?? null;
      return n ? normalizeName(n) : null;
    } catch {
      return null;
    }
  },

  normalizeVersion: normalizePyPiVersion,

  fetchMeta: fetchPyPiMeta,
};
