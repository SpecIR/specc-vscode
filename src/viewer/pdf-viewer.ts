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
let loading = false;
let pending: Uint8Array | null = null;
let renderVersion = 0;
let observer: IntersectionObserver | null = null;
const activeRenders = new Set<pdfjsLib.RenderTask>();

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
  if (loading) { pending = data; return; }
  loading = true;
  pagesEl.classList.add('stale');
  setStatus(`Loading ${formatBytes(data.byteLength)}…`);
  try {
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const old = pdf;
    stopRendering();
    pdf = doc;
    if (old) await old.destroy();
    await layoutPages(doc);
    setStatus(`${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} · ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    setStatus('Failed to load PDF: ' + ((e as Error)?.message ?? e));
  } finally {
    pagesEl.classList.remove('stale');
    loading = false;
    if (pending) { const p = pending; pending = null; void load(p); }
  }
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function effectiveScale(page: pdfjsLib.PDFPageProxy): number {
  if (scale > 0) return scale;
  const width = Math.max(1, pagesEl.clientWidth - 24);
  return width / page.getViewport({ scale: 1 }).width;
}

function stopRendering(): number {
  renderVersion++;
  observer?.disconnect();
  observer = null;
  for (const task of activeRenders) task.cancel();
  activeRenders.clear();
  return renderVersion;
}

/**
 * Create lightweight page shells first, then rasterize only pages near the
 * viewport. Large documents therefore show their first page immediately and
 * do not allocate a canvas for every page at once.
 */
async function layoutPages(doc: pdfjsLib.PDFDocumentProxy) {
  const version = stopRendering();
  const keep = scrollTop;
  pagesEl.replaceChildren();
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const shell = entry.target as HTMLElement;
      observer?.unobserve(shell);
      const page = pageByShell.get(shell);
      if (page) void renderPage(shell, page, version);
    }
  }, { rootMargin: '1200px 0px' });

  let s = 1;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    if (version !== renderVersion) return;
    s = effectiveScale(page);
    const viewport = page.getViewport({ scale: s });
    const shell = document.createElement('div');
    shell.className = 'page';
    shell.style.width = Math.floor(viewport.width) + 'px';
    shell.style.height = Math.floor(viewport.height) + 'px';
    const pageNumber = document.createElement('span');
    pageNumber.className = 'page-number';
    pageNumber.textContent = String(i);
    shell.appendChild(pageNumber);
    pageByShell.set(shell, page);
    pagesEl.appendChild(shell);
    observer.observe(shell);

    // Do not wait for IntersectionObserver before painting the opening page.
    if (i === 1) {
      observer.unobserve(shell);
      void renderPage(shell, page, version);
    }
  }
  zoomEl.textContent = Math.round(s * 100) + '%' + (scale ? '' : ' (fit)');
  window.scrollTo(0, keep);
  scrollTop = keep;
  saveState();
}

const pageByShell = new WeakMap<HTMLElement, pdfjsLib.PDFPageProxy>();

async function renderPage(shell: HTMLElement, page: pdfjsLib.PDFPageProxy, version: number) {
  if (version !== renderVersion || shell.dataset.state) return;
  shell.dataset.state = 'rendering';
  const viewport = page.getViewport({ scale: effectiveScale(page) });
  // Capping DPR avoids hundreds of megabytes of canvas backing stores on
  // high-density displays while preserving crisp text.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
  canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
  canvas.style.width = Math.floor(viewport.width) + 'px';
  canvas.style.height = Math.floor(viewport.height) + 'px';
  shell.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    shell.dataset.state = 'failed';
    setStatus(`Failed to render page ${page.pageNumber}: canvas is unavailable`);
    return;
  }
  ctx.scale(dpr, dpr);
  const task = page.render({ canvasContext: ctx, viewport });
  activeRenders.add(task);
  try {
    await task.promise;
    if (version === renderVersion) shell.dataset.state = 'rendered';
  } catch (e) {
    if (version === renderVersion && (e as Error)?.name !== 'RenderingCancelledException') {
      shell.dataset.state = 'failed';
      setStatus(`Failed to render page ${page.pageNumber}: ${(e as Error)?.message ?? e}`);
    }
  } finally {
    activeRenders.delete(task);
  }
}

function currentScale(): number {
  const m = /(\d+)%/.exec(zoomEl.textContent || '');
  return m ? +m[1] / 100 : 1;
}
async function rerender() {
  if (!pdf || loading) return;
  try {
    pagesEl.classList.add('stale');
    await layoutPages(pdf);
  } catch (e) {
    setStatus('Failed to redraw PDF: ' + ((e as Error)?.message ?? e));
  } finally {
    pagesEl.classList.remove('stale');
  }
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
  let data: Uint8Array;
  if (msg.data instanceof ArrayBuffer) data = new Uint8Array(msg.data);
  else if (ArrayBuffer.isView(msg.data)) data = new Uint8Array(msg.data.buffer, msg.data.byteOffset, msg.data.byteLength);
  else if (Array.isArray(msg.data)) data = new Uint8Array(msg.data);
  else {
    setStatus('Failed to receive PDF: expected binary data from the extension');
    return;
  }
  if (data.byteLength === 0) {
    setStatus('Failed to receive PDF: the transferred file is empty');
    return;
  }
  void load(data);
});

setStatus('Ready');
vscode.postMessage({ type: 'ready' });
