// Generic JSON codec that survives Map and Set — the plugin resolver contexts
// stored on FileIndex.extras (WorkspaceMap, Java fqnToPath/packageMembers,
// regexFallback importsByFile, …) are Maps, which plain JSON.stringify silently
// turns into `{}`. This codec is LANGUAGE-AGNOSTIC: it knows nothing about any
// plugin's idioms, it only preserves the Map/Set container shape — so persisting
// a plugin's extras needs no per-plugin serializer (invariant #1 intact).
//
// Maps encode as arrays-of-pairs (preserving insertion order → deterministic
// round-trip, which the canonical file ordering already guarantees upstream).

const MAP_TAG = "__ct_map__";
const SET_TAG = "__ct_set__";

/** Recursively replace Maps/Sets with tagged plain-JSON forms. */
export function encodeForJson(value: unknown): unknown {
  if (value instanceof Map) {
    return {
      [MAP_TAG]: [...value].map(([k, v]) => [encodeForJson(k), encodeForJson(v)]),
    };
  }
  if (value instanceof Set) {
    return { [SET_TAG]: [...value].map(encodeForJson) };
  }
  if (Array.isArray(value)) {
    return value.map(encodeForJson);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeForJson(v);
    return out;
  }
  return value; // string | number | boolean | null | undefined
}

/** Inverse of encodeForJson — rebuilds real Map/Set instances. */
export function decodeFromJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decodeFromJson);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1 && keys[0] === MAP_TAG) {
      const entries = obj[MAP_TAG] as [unknown, unknown][];
      return new Map(entries.map(([k, v]) => [decodeFromJson(k), decodeFromJson(v)]));
    }
    if (keys.length === 1 && keys[0] === SET_TAG) {
      const items = obj[SET_TAG] as unknown[];
      return new Set(items.map(decodeFromJson));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = decodeFromJson(v);
    return out;
  }
  return value;
}
