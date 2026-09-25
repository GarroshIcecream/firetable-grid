import { createCases } from "./cases";

let suite: ReturnType<typeof createCases>;
let sink = 0;
const api = {
  setup(rows: number, columns: number) {
    suite = createCases(rows, columns);
    return { ...suite.metadata, cases: Object.keys(suite.cases) };
  },
  batch(name: string, iterations: number) {
    const fn = suite.cases[name];
    if (!fn) throw new Error(`Unknown benchmark: ${name}`);
    const start = performance.now();
    for (let i = 0; i < iterations; i++) sink = fn();
    return { elapsedMs: performance.now() - start, result: sink };
  },
};
Object.assign(window, { coreBench: api });
export type CoreBench = typeof api;
