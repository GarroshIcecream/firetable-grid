// Server-only entry point. `xlsx-export` streams a workbook through
// `node:stream` behind a `server-only` guard, so it must never be reachable
// from the package root — see the note in `./index.ts`.
export * from "./xlsx-export";
