// Bundles src/extension.ts -> dist/extension.js and src/viewer/pdf-viewer.ts (with pdf.js
// and its worker source embedded) -> media/pdf-viewer.js.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const watch = process.argv.includes('--watch');

const production = process.argv.includes('--production');

async function main() {
  // Worker source is inlined into the viewer bundle (workers cannot be loaded cross-origin in webviews).
  fs.copyFileSync(
    path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'),
    path.join(root, 'src', 'viewer', 'pdf.worker.txt'),
  );
  // sql.js (wasm) is required at runtime from media/ so the .wasm can be located next to it.
  for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) {
    fs.copyFileSync(path.join(root, 'node_modules', 'sql.js', 'dist', f), path.join(root, 'media', f));
  }
  const viewer = await esbuild.context({
    entryPoints: [path.join(root, 'src', 'viewer', 'pdf-viewer.ts')],
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    loader: { '.txt': 'text' },
    outfile: path.join(root, 'media', 'pdf-viewer.js'),
    minify: production,
    logLevel: 'info',
  });
  const ctx = await esbuild.context({
    entryPoints: [path.join(root, 'src', 'extension.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
    outfile: path.join(root, 'dist', 'extension.js'),
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
  });
  if (watch) {
    await Promise.all([ctx.watch(), viewer.watch()]);
  } else {
    await Promise.all([ctx.rebuild(), viewer.rebuild()]);
    await Promise.all([ctx.dispose(), viewer.dispose()]);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
