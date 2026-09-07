// The sliver of node's standard library the TESTS use, declared rather than
// pulled in as @types/node.
//
// This app is browser-only, and tsconfig's `types: ["vite/client"]` is what
// keeps it honest: with node's globals in scope a stray `process.env` or
// `Buffer` would typecheck and then fail at runtime in the one environment that
// matters. So the ambient types stay out and this declares exactly two
// functions, used by exactly one thing — the point-cloud parity and unit tests,
// which have to read fixture BYTES.
//
// Every other fixture in this repo arrives through Vite's `?raw` (a string) or a
// JSON import, and would be the better answer here too. LAS, LAZ and binary PLY
// are not text: a `?raw` import decodes them as UTF-8 and mangles them, and
// base64 sidecars would put 1.7 MB of unreadable text in git next to the 1.25 MB
// of real files it duplicates. Reading the file is the honest option, and vitest
// runs in node, so it works.

declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array
  export function readFileSync(path: string | URL, encoding: 'utf8'): string
}
