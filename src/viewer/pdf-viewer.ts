// Bundled by scripts/build.js into media/pdf-viewer.js as a single classic script.
// No cross-origin loads: pdf.js is bundled, the worker source is embedded, and
// the PDF bytes arrive from the extension via postMessage.
import * as pdfjsLib from 'pdfjs-dist';
// Copied from pdfjs-dist by scripts/build.js and inlined as text.
import workerSource from './pdf.worker.txt';

declare function acquireVsCodeApi(): { getState(): any; setState(s: any): void; postMessage(m: any): void };

const vscode = acquireVsCodeApi();
const pagesEl = document.getElementById('pages')!;
const statusEl = document.getElementById('status')!;
const zoomEl = document.getElementById('zoom')!;

const saved = vscode.getState() || {};
let scale: number = saved.scale || 0; // 0 = fit width
let scrollTop: number = saved.scrollTop || 0;
let pdf: pdfjsLib.PDFDocumentProxy | null = null;
let rendering = false;
let pending: Uint8Array | null = null;

function setStatus(text: string) {
  statusEl.textContent = text;
  vscode.postMessage({ type: 'status', text });
}
window.addEventListener('error', (e) => setStatus('Viewer error: ' + e.message));
window.addEventListener('unhandledrejection', (e: any) => setStatus('Viewer error: ' + (e.reason?.message ?? e.reason)));

try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
} catch (e) {
  setStatus('Worker setup failed: ' + (e as Error).message);
}

function saveState() {
  vscode.setState({ scale, scrollTop: window.scrollY });
}
window.addEventListener('scroll', () => { scrollTop = window.scrollY; saveState(); }, { passive: true });

async function load(data: Uint8Array) {
  if (rendering) { pending = data; return; }
  rendering = true;
  pagesEl.classList.add('stale');
  setStatus('Loading…');
  try {
    const doc = await pdfjsLib.getDocument({ data }).promise;
    if (pdf) void pdf.destroy();
    pdf = doc;
    await render();
    setStatus(`${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} · ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    setStatus('Failed to load PDF: ' + ((e as Error)?.message ?? e));
  } finally {
    pagesEl.classList.remove('stale');
    rendering = false;
    if (pending) { const p = pending; pending = null; void load(p); }
  }
}

function effectiveScale(page: pdfjsLib.PDFPageProxy): number {
  if (scale > 0) return scale;
  const width = pagesEl.clientWidth - 24;
  return width / page.getViewport({ scale: 1 }).width;
}

async function render() {
  if (!pdf) return;
  const keep = scrollTop;
  const frag = document.createDocumentFragment();
  const dpr = window.devicePixelRatio || 1;
  let s = 1;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    s = effectiveScale(page);
    const viewport = page.getViewport({ scale: s });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = Math.floor(viewport.width) + 'px';
    canvas.style.height = Math.floor(viewport.height) + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    await page.render({ canvasContext: ctx, viewport }).promise;
    frag.appendChild(canvas);
  }
  pagesEl.replaceChildren(frag);
  zoomEl.textContent = Math.round(s * 100) + '%' + (scale ? '' : ' (fit)');
  window.scrollTo(0, keep);
  scrollTop = keep;
  saveState();
}

function currentScale(): number {
  const m = /(\d+)%/.exec(zoomEl.textContent || '');
  return m ? +m[1] / 100 : 1;
}
async function rerender() {
  if (pdf && !rendering) { rendering = true; try { await render(); } finally { rendering = false; } }
}
document.getElementById('zoomIn')!.onclick = () => { scale = (scale || currentScale()) * 1.2; void rerender(); };
document.getElementById('zoomOut')!.onclick = () => { scale = (scale || currentScale()) / 1.2; void rerender(); };
document.getElementById('fit')!.onclick = () => { scale = 0; void rerender(); };

let resizeTimer: ReturnType<typeof setTimeout>;
window.addEventListener('resize', () => {
  if (!scale) { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => void rerender(), 150); }
});

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg || msg.type !== 'pdf') return;
  void load(msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data));
});

setStatus('Ready');
vscode.postMessage({ type: 'ready' });
