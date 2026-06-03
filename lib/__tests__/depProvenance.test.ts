// Dependency provenance — proves the runtime/dev lane classification and
// self-name extraction generalize across ecosystems and project layouts,
// not just the one repo (flask) that surfaced the bug. The fix: only a
// project's RUNTIME deps drive the Security/Supply verdict; dev/test/docs/
// sample/CI pins stay visible but don't FAIL the repo, and a project is
// never listed as its own dependency.

import { describe, it, expect } from "vitest";
import type { DeclaredPackage } from "../depsHealth/types";
import { pypiPlugin } from "../depsHealth/ecosystems/pypi";
import { npmPlugin } from "../depsHealth/ecosystems/npm";
import { cargoPlugin } from "../depsHealth/ecosystems/cargo";

function scopeByName(deps: DeclaredPackage[]): Record<string, string> {
  return Object.fromEntries(deps.map((d) => [d.name, d.scope]));
}

describe("dependency provenance — pypi lanes", () => {
  it("PEP 621: [project.dependencies] are runtime, optional-dependencies are dev", () => {
    const toml = `
[project]
name = "mylib"
dependencies = ["requests>=2.0", "click~=8.0"]

[project.optional-dependencies]
test = ["pytest==7.0"]
docs = ["sphinx==6.0"]
`;
    expect(scopeByName(pypiPlugin.parseManifest("pyproject.toml", toml))).toEqual({
      requests: "runtime",
      click: "runtime",
      pytest: "dev",
      sphinx: "dev",
    });
  });

  it("Poetry: main deps are runtime, dev-dependencies + groups are dev", () => {
    const toml = `
[tool.poetry]
name = "myapp"
[tool.poetry.dependencies]
python = "^3.10"
httpx = "^0.24"
[tool.poetry.dev-dependencies]
black = "^23.0"
[tool.poetry.group.docs.dependencies]
mkdocs = "^1.5"
`;
    expect(scopeByName(pypiPlugin.parseManifest("pyproject.toml", toml))).toEqual({
      httpx: "runtime",
      black: "dev",
      mkdocs: "dev",
    });
  });

  it("a ROOT requirements.txt is the app's runtime manifest", () => {
    const deps = pypiPlugin.parseManifest(
      "requirements.txt",
      "flask==2.3.2\nrequests==2.31.0\n",
    );
    expect(scopeByName(deps)).toEqual({ flask: "runtime", requests: "runtime" });
  });

  it("a NESTED requirements.txt (example/sample sub-app) is dev — the Flask bug", () => {
    // Flask's false "vulnerable deps" all came from this path: an example
    // app's full pinned tree, not Flask's own dependencies.
    const deps = pypiPlugin.parseManifest(
      "examples/celery/requirements.txt",
      "flask==2.3.2\njinja2==3.1.2\nwerkzeug==2.3.3\ncelery==5.2.7\nredis==4.5.4\n",
    );
    expect(deps.every((d) => d.scope === "dev")).toBe(true);
  });

  it("suffixed + nested requirements files are dev", () => {
    // Only basename-requirements*.txt files are scanned at all; of those,
    // only a root "requirements.txt" is runtime.
    expect(pypiPlugin.parseManifest("requirements-dev.txt", "black==23.0")[0].scope).toBe("dev");
    expect(pypiPlugin.parseManifest("docs/requirements.txt", "sphinx==6.0")[0].scope).toBe("dev");
    expect(pypiPlugin.parseManifest("tests/requirements.txt", "pytest==7.0")[0].scope).toBe("dev");
  });

  it("reads the project's own name (PEP 621 + Poetry), PEP 503-normalized", () => {
    expect(pypiPlugin.selfName!("pyproject.toml", `[project]\nname = "Flask"`)).toBe("flask");
    expect(pypiPlugin.selfName!("pyproject.toml", `[tool.poetry]\nname = "My_Pkg"`)).toBe("my-pkg");
    expect(pypiPlugin.selfName!("requirements.txt", "flask==2.0")).toBeNull();
  });
});

describe("dependency provenance — npm lanes", () => {
  it("dependencies + peerDependencies are runtime, devDependencies are dev", () => {
    const json = JSON.stringify({
      name: "my-pkg",
      dependencies: { react: "^18.0" },
      peerDependencies: { "react-dom": "^18.0" },
      devDependencies: { vitest: "^1.0" },
    });
    expect(scopeByName(npmPlugin.parseManifest("package.json", json))).toEqual({
      react: "runtime",
      "react-dom": "runtime",
      vitest: "dev",
    });
  });

  it("reads the package name for self-exclusion", () => {
    expect(npmPlugin.selfName!("package.json", JSON.stringify({ name: "zod" }))).toBe("zod");
    expect(npmPlugin.selfName!("package.json", "{}")).toBeNull();
  });
});

describe("dependency provenance — cargo lanes", () => {
  it("reads the crate name for self-exclusion (null for a virtual workspace)", () => {
    expect(cargoPlugin.selfName!("Cargo.toml", `[package]\nname = "serde"`)).toBe("serde");
    expect(cargoPlugin.selfName!("Cargo.toml", `[workspace]\nmembers = []`)).toBeNull();
  });
});

describe("dependency provenance — exact pin vs range", () => {
  it("pypi: == / === is exact; >=, ~=, * are ranges", () => {
    expect(pypiPlugin.isExactVersion!("==3.1.2")).toBe(true);
    expect(pypiPlugin.isExactVersion!("===3.1.2")).toBe(true);
    expect(pypiPlugin.isExactVersion!(">=3.1.2")).toBe(false);
    expect(pypiPlugin.isExactVersion!("~=2.31")).toBe(false);
    expect(pypiPlugin.isExactVersion!("*")).toBe(false);
  });

  it("npm: plain semver is exact; ^, ~, >=, x are ranges", () => {
    expect(npmPlugin.isExactVersion!("1.2.3")).toBe(true);
    expect(npmPlugin.isExactVersion!("^1.2.3")).toBe(false);
    expect(npmPlugin.isExactVersion!("~1.2.3")).toBe(false);
    expect(npmPlugin.isExactVersion!(">=1.0.0")).toBe(false);
    expect(npmPlugin.isExactVersion!("1.x")).toBe(false);
    expect(npmPlugin.isExactVersion!("*")).toBe(false);
  });

  it("cargo: =X is exact; bare (caret default), ^, ~ are ranges", () => {
    expect(cargoPlugin.isExactVersion!("=1.2.3")).toBe(true);
    expect(cargoPlugin.isExactVersion!("1.2.3")).toBe(false);
    expect(cargoPlugin.isExactVersion!("^1.0")).toBe(false);
    expect(cargoPlugin.isExactVersion!("~1.0")).toBe(false);
  });
});
