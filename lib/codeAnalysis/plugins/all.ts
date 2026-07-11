// The canonical code-analysis plugin set — and order — used by the production
// pipeline (analyzeRepo). Single source of truth so every consumer analyzes with
// an identical set.
//
// This matters most for the Shadow-Graph patcher: a "simulate" re-analyzes only
// the changed files and splices them into a cached parse layer, and the result
// must be byte-identical to a full re-analysis (the golden-equivalence contract).
// That holds only if the patcher runs the SAME plugins the layer was built with.
// Centralizing the list here means a new language can't be added to analysis
// without every simulate surface picking it up too — the alternative (an inline
// array in github.ts that a service copy silently drifts from) would break the
// contract quietly.

import type { CodeAnalysisPlugin } from "../types";
import { javascriptPlugin } from "./javascript";
import { pythonPlugin } from "./python";
import { goPlugin } from "./go";
import { javaPlugin } from "./java";
import { csharpPlugin } from "./csharp";
import { phpPlugin } from "./php";
import { rubyPlugin } from "./ruby";
import { regexFallbackPlugin } from "./regexFallback";

export const ALL_PLUGINS: CodeAnalysisPlugin[] = [
  javascriptPlugin,
  pythonPlugin,
  goPlugin,
  javaPlugin,
  csharpPlugin,
  phpPlugin,
  rubyPlugin,
  regexFallbackPlugin,
];
