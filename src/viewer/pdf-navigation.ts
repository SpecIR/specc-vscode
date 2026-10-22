import type { PDFDocumentProxy } from 'pdfjs-dist';
import { normalizeTitle, PreviewTarget } from '../previewTargets';
import { highlight, navigationControls, VsCodeApi } from './navigationControls';

export interface PdfLocation { key: string; page: number; y: number }

/** PDF exports do not carry source lines. Match DB entities to bookmarks, then visible text. */
export async function indexPdf(doc: PDFDocumentProxy, targets: PreviewTarget[], cancelled: () => boolean): Promise<PdfLocation[]> {
  const locations = new Map<string, PdfLocation>();
  const destinations = await doc.getDestinations();
  async function locate(key: string, destination: string | any[] | null): Promise<void> {
    const dest = typeof destination === 'string' ? await doc.getDestination(destination) : destination;
    if (!dest || cancelled()) return;
    const pageNumber = (typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0])) + 1;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const top = dest[1]?.name === 'XYZ' ? dest[3] : dest[1]?.name === 'FitH' || dest[1]?.name === 'FitBH' ? dest[2] : null;
    const y = typeof top === 'number' ? viewport.convertToViewportPoint(0, top)[1] / viewport.height : 0;
    locations.set(key, { key, page: pageNumber, y: Math.max(0, Math.min(1, y)) });
  }
  for (const target of targets) {
    if (cancelled()) return [];
    const anchor = target.anchors.find(a => destinations[a]);
    if (anchor) await locate(target.key, destinations[anchor]);
  }
  const walk = async (items: Awaited<ReturnType<PDFDocumentProxy['getOutline']>>) => {
    for (const item of items ?? []) {
      if (cancelled()) return;
      const title = normalizeTitle(item.title).replace(/^\d+(?:\s+\d+)*\s+/, '');
      const target = targets.find(t => !locations.has(t.key) && normalizeTitle(t.title) === title);
      if (target) await locate(target.key, item.dest);
      await walk(item.items);
    }
  };
  await walk(await doc.getOutline());

  // Some LibreOffice exports omit named destinations or outlines. Scan text once per PDF,
  // only when the user navigates, retaining the resulting positions for subsequent jumps.
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    if (cancelled()) return [];
    const missing = targets.filter(t => !locations.has(t.key) && t.title.trim());
    if (!missing.length) break;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const lines: Array<{ text: string; y: number }> = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const y = viewport.convertToViewportPoint(item.transform[4], item.transform[5])[1] / viewport.height;
      const previous = lines.at(-1);
      if (previous && Math.abs(previous.y - y) < 0.005) previous.text += ' ' + item.str;
      else lines.push({ text: item.str, y });
    }
    for (const target of missing) {
      const title = normalizeTitle(target.title);
      if (!title) continue;
      const line = lines.find((line, i) => {
        // Avoid the most common table-of-contents/list-of-figures entries.
        if (/\.{3}|…/.test(line.text)) return false;
        for (let count = 1; count <= 3; count++) {
          const text = normalizeTitle(lines.slice(i, i + count).map(l => l.text).join(' '));
          if (text === title || text.endsWith(' ' + title)) return true;
        }
        return false;
      });
      if (line) locations.set(target.key, { key: target.key, page: pageNumber, y: line.y });
    }
  }
  return [...locations.values()].sort((a, b) => a.page - b.page || a.y - b.y);
}

export class PdfNavigation {
  private targets: PreviewTarget[] = [];
  private generation = 0;
  private index: Promise<PdfLocation[]> | undefined;
  private clicked: { page: number; y: number } | undefined;
  private pending: string | undefined;
  private ready = false;

  constructor(private api: VsCodeApi, private getDoc: () => PDFDocumentProxy | null,
    private pages: HTMLElement, private status: (text: string) => void) {
    navigationControls(api, () => { void this.showSource(); });
    pages.addEventListener('click', event => {
      const shell = (event.target as Element).closest<HTMLElement>('.page');
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      this.clicked = { page: Number(shell.dataset.page), y: (event.clientY - rect.top) / rect.height };
    });
    window.addEventListener('scroll', () => { this.clicked = undefined; }, { passive: true });
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg?.type === 'navigationTargets') {
        // Forward navigation resends metadata. Preserve the expensive PDF index if unchanged.
        if (JSON.stringify(this.targets) !== JSON.stringify(msg.targets)) {
          this.targets = msg.targets;
          this.generation++;
          this.index = undefined;
        }
        this.flush();
      } else if (msg?.type === 'revealTarget') {
        this.pending = msg.key;
        this.flush();
      } else if (msg?.type === 'requestSource') void this.showSource();
    });
  }

  reset(): void {
    this.generation++;
    this.index = undefined;
    this.clicked = undefined;
    this.ready = false;
  }

  loaded(): void {
    this.ready = true;
    // Resume queued jumps only after the host sends metadata for this build.
    this.api.postMessage({ type: 'navigationReady' });
  }

  private flush(): void {
    if (!this.ready || !this.targets.length || !this.pending) return;
    const key = this.pending;
    this.pending = undefined;
    void this.reveal(key);
  }

  private async locations(): Promise<PdfLocation[]> {
    const doc = this.getDoc();
    if (!doc || !this.ready) return [];
    if (!this.index) {
      const generation = this.generation;
      this.status('Finding source locations…');
      this.index = indexPdf(doc, this.targets, () => generation !== this.generation).catch(e => {
        if (generation === this.generation) {
          this.index = undefined;
          this.status('Could not map PDF locations: ' + (e as Error).message);
        }
        return [];
      });
    }
    return this.index;
  }

  private async reveal(key: string): Promise<void> {
    const generation = this.generation;
    const location = (await this.locations()).find(l => l.key === key);
    if (generation !== this.generation) return;
    const shell = location && this.pages.querySelector<HTMLElement>(`[data-page="${location.page}"]`);
    if (!location || !shell) { this.missing(); return; }
    window.scrollTo({ top: window.scrollY + shell.getBoundingClientRect().top + shell.clientHeight * location.y - innerHeight / 3 });
    highlight(shell);
    this.status(`Source location · page ${location.page}`);
  }

  private async showSource(): Promise<void> {
    const generation = this.generation;
    const point = this.clicked ?? this.center();
    const locations = await this.locations();
    if (generation !== this.generation) return;
    if (!point || !locations.length) { this.missing(); return; }
    const location = locations.filter(l => l.page < point.page || (l.page === point.page && l.y <= point.y + 0.01)).at(-1) ?? locations[0];
    this.api.postMessage({ type: 'showSource', key: location.key });
    this.status(`Source location · page ${location.page}`);
  }

  private center(): { page: number; y: number } | undefined {
    const shells = [...this.pages.querySelectorAll<HTMLElement>('.page')];
    const shell = shells.find(el => el.getBoundingClientRect().bottom >= innerHeight / 2) ?? shells.at(-1);
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    return { page: Number(shell.dataset.page), y: Math.max(0, Math.min(1, (innerHeight / 2 - rect.top) / rect.height)) };
  }

  private missing(): void { this.api.postMessage({ type: 'navigationMissing' }); this.status('No matching source location'); }
}
