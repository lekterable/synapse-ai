import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    cli: 'src/cli.tsx',
  },
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  outDir: 'dist',
  bundle: true,
  external: ['ink', 'react'],
  noExternal: [],
  clean: true,
  // A separate chunk for ./utils/ink, so Ink loads only when a command renders with it.
  splitting: true,
  sourcemap: false,
  minify: false,
  treeshake: true,
})
