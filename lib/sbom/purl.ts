// package-URL (purl) construction per ecosystem. The purl is the SBOM's unique
// component identifier (CISA minimum element). Spec: https://github.com/package-url/purl-spec

/** Percent-encode a purl segment conservatively (keep the chars purl allows
 *  unencoded; encode the rest). */
function enc(s: string): string {
  return encodeURIComponent(s).replace(/%2F/gi, "/");
}

/** Normalize a PyPI name per PEP 503: lowercase, runs of [-_.] → single "-". */
function normalizePypi(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/**
 * Build a purl for a (ecosystem, name, version). Handles npm scoped names
 * (@scope/pkg → namespace) and PyPI name normalization; unknown ecosystems fall
 * back to pkg:generic.
 */
export function toPurl(
  ecosystem: string,
  name: string,
  version: string,
): string {
  const v = enc(version);
  switch (ecosystem) {
    case "npm": {
      // Scoped: "@scope/pkg" → namespace "@scope", name "pkg".
      if (name.startsWith("@") && name.includes("/")) {
        const slash = name.indexOf("/");
        const scope = name.slice(0, slash); // "@scope"
        const pkg = name.slice(slash + 1);
        return `pkg:npm/${enc(scope)}/${enc(pkg)}@${v}`;
      }
      return `pkg:npm/${enc(name)}@${v}`;
    }
    case "pypi":
      return `pkg:pypi/${enc(normalizePypi(name))}@${v}`;
    case "cargo":
      return `pkg:cargo/${enc(name)}@${v}`;
    default:
      return `pkg:generic/${enc(name)}@${v}`;
  }
}
