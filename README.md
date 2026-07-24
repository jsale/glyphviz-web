# GlyphViz Web

A from-scratch WebGL rewrite of [GlyphViz](../glyphviz) — not a port. GlyphViz's
desktop renderer is built on immediate-mode OpenGL (`glBegin`/`glVertex`), which
has no equivalent in WebGL/GLES, so this project reimplements the rendering and
interaction layer from first principles using Three.js.

**Working name only.** "GlyphViz Web" / `glyphviz-web` is a placeholder; a
permanent name (candidates include "GlyphWiz") hasn't been decided yet.

## Relationship to GlyphViz

This project shares GlyphViz's **data contract**, not its code or rendering
pipeline. The `gv_` CSV format (node hierarchy, topology placement math, tags,
Channels animation) is specified in the `glyphviz` repo's
`glyphviz-skill/references/` — treat those docs as the authoritative spec when
implementing the CSV parser and topology math here. (`gaiaviz-skill/` in that
same repo is unrelated to this project — it documents the legacy GaiaViz/ANTz
format for interop only.)

Desktop GlyphViz continues active development in parallel; this is a separate,
slower-paced side track, not a replacement.

## Stack

Three.js + TypeScript + Vite. Chosen for fast time-to-first-render and native
WebXR support (a possible path to the Quest 3 goal already explored on the
desktop side via OpenXR — see the parent repo's XR strategy notes).

## Status

Scaffold only. `npm run dev` renders a spinning placeholder cube — proof the
toolchain works, nothing more. No CSV loader, no topology math, no scene graph
yet.

## Getting started

```
npm install
npm run dev
```
