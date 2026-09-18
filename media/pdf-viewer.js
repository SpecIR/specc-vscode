// Minimal pdf.js viewer for the SpecCompiler PDF preview: renders all pages
// into canvases, supports zoom / fit-width, and reloads in place on
// { type: 'reload', url } messages while keeping the scroll position.
const { pdfjsLib, workerUrl, pdfUrl } = window.__specc;
const vscode = acquireVsCodeApi();
const pagesEl = document.getElementById('pages');
const statusEl = document.getElementById('status');
const zoomEl = document.getElementById('zoom');

const saved = vscode.getState() || {};
let scale = saved.scale || 0;     // 0 = fit width
let scrollTop = saved.scrollTop || 0;
let pdf = null;
let rendering = false;
let pendingUrl = null;

async function setupWorker() {
  // Workers must be same-origin; the resource scheme is not, so load the worker source as a blob.
  const src = await (await fetch(workerUrl)).text();
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
}

function setStatus(text) { statusEl.textContent = text; }

function saveState() {
  vscode.setState({ scale, scrollTop: window.scrollY });
}
window.addEventListener('scroll', () => { scrollTop = window.scrollY; saveState(); }, { passive: true });

async function load(url) {
  if (rendering) { pendingUrl = url; return; }
  rendering = true;
  pagesEl.classList.add('stale');
  setStatus('Loading…');
  try {
    const data = await (await fetch(url, { cache: 'no-store' })).arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data }).promise;
    if (pdf) pdf.destroy();
    pdf = doc;
    await render();
    setStatus(`${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} · ${new Date().toLocaleTimeString()}`);
  } catch (e) {
    setStatus('Failed to load PDF: ' + (e && e.message ? e.message : e));
  } finally {
    pagesEl.classList.remove('stale');
    rendering = false;
    if (pendingUrl) { const u = pendingUrl; pendingUrl = null; load(u); }
  }
}

function effectiveScale(page) {
  if (scale > 0) return scale;
  const width = pagesEl.clientWidth - 24;
  return width / page.getViewport({ scale: 1 }).width;
}

async function render() {
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
    const ctx = canvas.getContext('2d');
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

document.getElementById('zoomIn').onclick = () => { scale = (scale || currentScale()) * 1.2; rerender(); };
document.getElementById('zoomOut').onclick = () => { scale = (scale || currentScale()) / 1.2; rerender(); };
document.getElementById('fit').onclick = () => { scale = 0; rerender(); };
function currentScale() { const m = /(\d+)%/.exec(zoomEl.textContent); return m ? +m[1] / 100 : 1; }
async function rerender() { if (pdf && !rendering) { rendering = true; try { await render(); } finally { rendering = false; } } }

let resizeTimer;
window.addEventListener('resize', () => { if (!scale) { clearTimeout(resizeTimer); resizeTimer = setTimeout(rerender, 150); } });

window.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (msg && msg.type === 'reload') load(msg.url);
});

setupWorker().then(() => load(pdfUrl));
