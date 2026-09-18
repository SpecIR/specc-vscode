// Bundles src/extension.ts -> dist/extension.js and vendors pdf.js into media/pdfjs.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const watch = process.argv.includes('--watch');

function vendorPdfjs() {
  const src = path.join(root, 'node_modules', 'pdfjs-dist', 'build');
  const dst = path.join(root, 'media', 'pdfjs');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
}

async function main() {
  vendorPdfjs();
  const ctx = await esbuild.context({
    entryPoints: [path.join(root, 'src', 'extension.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
    outfile: path.join(root, 'dist', 'extension.js'),
    sourcemap: !process.argv.includes('--production'),
    minify: process.argv.includes('--production'),
    logLevel: 'info',
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
