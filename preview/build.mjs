// Bundles the views for a browser with the obsidian shim, for screenshots on a headless box.
import esbuild from 'esbuild'
import path from 'node:path'
await esbuild.build({
  entryPoints: ['preview/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'preview/dist/main.js',
  alias: {
    obsidian: path.resolve('preview/obsidian.ts'),
    'node:fs/promises': path.resolve('preview/stubs/node.ts'),
    'node:path': path.resolve('preview/stubs/node.ts'),
    'node:os': path.resolve('preview/stubs/node.ts'),
    'node:child_process': path.resolve('preview/stubs/node.ts'),
  },
  logLevel: 'info',
})
