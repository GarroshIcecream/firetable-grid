import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import * as barrel from "../src";
import * as schema from "../src/schema";

// `threshold.ts` and `enum-color.ts` are zod-free on purpose: the grid's cell
// renderers import their resolvers on every cell, so zod (~388 KB raw) in the
// same module lands in the client bundle of the grid route. Re-exporting the
// schemas from `./index` handed that cost straight back — a barrel makes every
// consumer pay for its heaviest member, and `exports` offered no deep import to
// escape through. Measured at the time: a root import of `applyAST` bundled to
// 124.77 KB against 2.88 KB for the same symbol imported from its own module.
//
// This walks the static import graph rather than bundling, so it stays fast and
// pins the invariant itself: nothing reachable from the package root may pull a
// heavy optional peer.

const SRC = resolve(import.meta.dir, "../src");
const HEAVY_OPTIONAL_PEERS = ["zod", "exceljs", "server-only"];

// `import type` / `export type` are erased before anything reaches a bundle,
// so they must not count — `xlsx-sheet.ts` names exceljs only for its types.
const STATEMENT_RE =
  /\b(?:import|export)\s+(type\s+)?(?:[\s\S]*?\s)?from\s*["']([^"']+)["']/g;
const BARE_IMPORT_RE = /\bimport\s*["']([^"']+)["']/g;
const DYNAMIC_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Specifiers this module pulls in at RUNTIME, type-only imports excluded. */
function specifiersIn(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(STATEMENT_RE)) {
    if (m[1]) continue; // `import type ... from` — erased
    out.push(m[2]);
  }
  for (const m of source.matchAll(BARE_IMPORT_RE)) out.push(m[1]);
  for (const m of source.matchAll(DYNAMIC_RE)) out.push(m[1]);
  return out;
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try the next shape
    }
  }
  throw new Error(`unresolved import "${specifier}" from ${fromFile}`);
}

/** Every bare package specifier statically reachable from `entry`, mapped to
 *  the module that pulls it in — so a failure names the culprit, not just the
 *  package. Dynamic `import()` of a bare specifier is excluded: that is the
 *  deliberate load-on-demand path (exceljs on the export click). */
function reachableBarePackages(entry: string): Map<string, string> {
  const found = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [resolve(entry)];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    const deferred = new Set([...source.matchAll(DYNAMIC_RE)].map((m) => m[1]));

    for (const specifier of specifiersIn(source)) {
      if (specifier.startsWith(".")) {
        const next = resolveRelative(file, specifier);
        if (next) queue.push(next);
        continue;
      }
      if (deferred.has(specifier)) continue;
      if (!found.has(specifier)) {
        found.set(specifier, relative(SRC, file));
      }
    }
  }
  return found;
}

describe("the package root stays free of heavy optional peers", () => {
  const fromRoot = reachableBarePackages(join(SRC, "index.ts"));

  for (const pkg of HEAVY_OPTIONAL_PEERS) {
    test(`"${pkg}" is not statically reachable from ./index.ts`, () => {
      const culprit = fromRoot.get(pkg);
      expect(
        culprit === undefined ? null : `${pkg} pulled in by src/${culprit}`,
      ).toBeNull();
    });
  }

  test("the root does not reach node: builtins either", () => {
    const builtins = [...fromRoot.keys()].filter((s) => s.startsWith("node:"));
    expect(builtins).toEqual([]);
  });
});

describe("the schema entry point carries the zod surface", () => {
  test("./schema statically imports zod", () => {
    const fromSchema = reachableBarePackages(join(SRC, "schema.ts"));
    expect(fromSchema.has("zod")).toBe(true);
  });

  test("the schemas are exported from ./schema, not the root", () => {
    for (const name of [
      "thresholdColorSchema",
      "thresholdListSchema",
      "enumColorMapSchema",
      "stagedDayThresholdListSchema",
    ]) {
      expect(schema).toHaveProperty(name);
      expect(barrel).not.toHaveProperty(name);
    }
  });

  test("the zod-free model and resolvers stay on the root", () => {
    // The split is only worth anything if the per-cell resolvers are still
    // reachable without it.
    for (const name of [
      "resolveThresholdColor",
      "resolveEnumColor",
      "normalizeThresholdColor",
      "THRESHOLD_HUES",
    ]) {
      expect(barrel).toHaveProperty(name);
    }
  });
});

describe("package.json declares the entry points it ships", () => {
  const pkg = JSON.parse(
    readFileSync(resolve(import.meta.dir, "../package.json"), "utf8"),
  );

  test("./schema is exported", () => {
    expect(pkg.exports["./schema"]).toBe("./src/schema.ts");
  });

  test("zod is an optional peer, like the other conditional ones", () => {
    expect(pkg.peerDependenciesMeta.zod?.optional).toBe(true);
  });

  test("sideEffects keeps the stylesheets, which are imported for effect", () => {
    // `"sideEffects": false` would let a bundler drop
    // `import "firetable-grid/styles/palette.css"` entirely.
    expect(pkg.sideEffects).not.toBe(false);
    for (const key of Object.keys(pkg.exports)) {
      if (!key.endsWith(".css")) continue;
      const kept = (pkg.sideEffects as string[]).some((pattern) =>
        pattern.endsWith("*.css"),
      );
      expect(kept).toBe(true);
    }
  });
});
