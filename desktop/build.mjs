// Bündelt Main-, Preload-, Renderer- und AudioWorklet-Code nach dist/.
import { build } from 'esbuild';

const common = { bundle: true, sourcemap: true, logLevel: 'info' };

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist/preload.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
  build({
    ...common,
    entryPoints: ['src/renderer/app.ts'],
    outfile: 'dist/renderer.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
  }),
  build({
    ...common,
    entryPoints: ['src/renderer/worklet.ts'],
    outfile: 'dist/worklet.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
  }),
]);
