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
  splitting: false,
  sourcemap: false,
  minify: false,
  treeshake: true,
})
