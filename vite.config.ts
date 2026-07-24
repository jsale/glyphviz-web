import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so the built app works when hosted under a subpath
  // (e.g. https://www.iluvdata.org/glyphvizweb/), not just at a domain root.
  base: './',
})
