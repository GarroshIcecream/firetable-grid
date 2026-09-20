import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "tsup";

// The package ships built ESM + declarations rather than its own `.ts`.
//
// Shipping source looked cheaper, but it pushed two costs onto every consumer:
// Node refuses to strip types under `node_modules`
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), and a consumer's `tsc`
// compiles our source, so `skipLibCheck` never applies and every *optional*
// peer becomes mandatory — no exceljs meant TS2307 out of `xlsx-sheet.ts`.
// Declarations reference an optional peer in a way `skipLibCheck` can ignore.
//
// One entry per public subpath in `package.json#exports`. Keep the two in step:
// a subpath with no entry here resolves to a file that was never built.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    schema: "src/schema.ts",
    server: "src/server.ts",
    "layout/index": "src/layout/index.ts",
    "react/index": "src/react/index.ts",
  },
  format: ["esm"],
  // Declarations build against `tsconfig.build.json`, which drops tests,
  // examples and bun's ambient types from what consumers receive.
  tsconfig: "tsconfig.build.json",
  dts: true,
  sourcemap: true,
  clean: true,
  // Shared modules become chunks instead of being copied into each entry, so
  // importing both the root and `/react` does not load two palettes.
  splitting: true,
  treeshake: true,
  // Every peer stays external — including the optional ones, which must remain
  // a runtime `import` the consumer can choose not to install.
  external: [
    "@tanstack/react-table",
    "@tanstack/table-core",
    "@tanstack/react-virtual",
    "exceljs",
    "react",
    "react-dom",
    "server-only",
    "zod",
  ],
  // `"use client"` on the React entry points and `"server-only"` on the server
  // one are load-bearing, not decoration: without them a Next.js App Router
  // consumer either renders a hook on the server or bundles `node:stream` into
  // the browser. tsup hoists a directive to the chunk that needs it; the build
  // script greps the output to prove it survived.
  outExtension: () => ({ js: ".js" }),
  onSuccess: async () => restoreClientBoundary(),
});

// esbuild strips directives when it bundles, so a `"use client"` that was
// correct in source silently disappears from dist. It is load-bearing on
// exactly one entry: `react/index` exports `DataGrid`, which a SERVER component
// renders directly - without the directive React runs its hooks on the server,
// which is a hard error. The root and `layout/index` must NOT carry it; they
// are server-safe, and marking either would drag the headless engine into the
// client graph and stop a server route calling `buildCsvString`.
function restoreClientBoundary(): void {
  // `import.meta.dir` is undefined under tsup's config loader; the build always
  // runs from the package root.
  const dist = join(process.cwd(), "dist");
  const directive = '"use client";';
  const target = join(dist, "react/index.js");

  const source = readFileSync(target, "utf8");
  if (!source.startsWith(directive)) {
    writeFileSync(target, `${directive}\n${source}`);
    console.log(`  + ${directive} -> dist/react/index.js`);
  }

  // Verify rather than trust: a tsup upgrade that starts preserving directives
  // (or renames an output) should not quietly leave this unenforced.
  const failures: string[] = [];
  if (!readFileSync(target, "utf8").startsWith(directive)) {
    failures.push(`dist/react/index.js lost ${directive}`);
  }
  if (readFileSync(join(dist, "index.js"), "utf8").startsWith(directive)) {
    failures.push(
      'dist/index.js must NOT carry "use client" - it is the headless entry',
    );
  }
  if (failures.length > 0) {
    console.error(failures.map((f) => `  x ${f}`).join("\n"));
    process.exit(1);
  }
  console.log("  ok client boundaries verified");
}
