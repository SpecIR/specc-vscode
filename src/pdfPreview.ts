import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { escapeHtml, placeholder } from './htmlPreview';
import { Project } from './project';

export class PdfPreview {
  private panel: vscode.WebviewPanel | undefined;
  private project: Project | undefined;
  private pdfPath: string | undefined;
  private loaded = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  boundTo(project: Project): boolean {
    return !!this.panel && this.project?.yamlPath === project.yamlPath;
  }

  async show(project: Project, pdfPath: string): Promise<void> {
    const rebind = this.pdfPath !== pdfPath;
    this.project = project;
    this.pdfPath = pdfPath;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('specc.pdf', 'SpecCompiler PDF', vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(project.rootDir),
          vscode.Uri.file(project.outputDir),
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        ],
      });
      this.panel.onDidDispose(() => { this.panel = undefined; this.loaded = false; }, null, this.context.subscriptions);
      this.loaded = false;
    } else {
      this.panel.reveal(undefined, true);
    }
    this.panel.title = `${path.basename(pdfPath)} · PDF`;
    if (!this.loaded || rebind) this.load();
    else this.refresh();
  }

  /** Ask the running viewer to re-fetch the PDF, keeping scroll and zoom. Loads the viewer if it is not there yet. */
  refresh(): void {
    if (!this.panel || !this.pdfPath) return;
    if (!this.loaded || !fs.existsSync(this.pdfPath)) { this.load(); return; }
    void this.panel.webview.postMessage({ type: 'reload', url: this.pdfUrl() });
  }

  private pdfUrl(): string {
    return this.panel!.webview.asWebviewUri(vscode.Uri.file(this.pdfPath!)).toString() + `?v=${Date.now()}`;
  }

  private load(): void {
    const webview = this.panel!.webview;
    if (!fs.existsSync(this.pdfPath!)) {
      this.loaded = false;
      webview.html = placeholder(
        'No PDF output yet',
        `Expected <code>${escapeHtml(vscode.workspace.asRelativePath(this.pdfPath!))}</code>. Run <b>SpecCompiler: Build Project</b> or save a document to build.`,
      );
      return;
    }
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const lib = webview.asWebviewUri(vscode.Uri.joinPath(media, 'pdfjs', 'pdf.min.mjs'));
    const worker = webview.asWebviewUri(vscode.Uri.joinPath(media, 'pdfjs', 'pdf.worker.min.mjs'));
    const viewer = webview.asWebviewUri(vscode.Uri.joinPath(media, 'pdf-viewer.js'));
    const csp = webview.cspSource;
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.loaded = true;
    webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${csp} blob:; worker-src blob:; connect-src ${csp}; img-src ${csp} blob: data:; style-src ${csp} 'unsafe-inline';">
<style>
  html,body{margin:0;height:100%;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family)}
  #bar{position:sticky;top:0;z-index:2;display:flex;gap:.5rem;align-items:center;padding:.3rem .6rem;background:var(--vscode-editorWidget-background);border-bottom:1px solid var(--vscode-widget-border,#0003);font-size:12px}
  #bar button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:0;padding:.2rem .5rem;border-radius:3px;cursor:pointer}
  #bar button:hover{background:var(--vscode-button-secondaryHoverBackground)}
  #status{margin-left:auto;opacity:.8}
  #pages{padding:12px;display:flex;flex-direction:column;align-items:center;gap:12px}
  canvas{box-shadow:0 1px 6px #0006;background:#fff;max-width:100%}
  #pages.stale{opacity:.5;transition:opacity .2s}
</style></head><body>
<div id="bar">
  <button id="zoomOut" title="Zoom out">−</button><span id="zoom">100%</span><button id="zoomIn" title="Zoom in">+</button>
  <button id="fit" title="Fit width">Fit width</button>
  <span id="status"></span>
</div>
<div id="pages"></div>
<script nonce="${nonce}">
  window.addEventListener('error', function (e) { document.getElementById('status').textContent = 'Viewer error: ' + e.message; });
  window.addEventListener('unhandledrejection', function (e) { document.getElementById('status').textContent = 'Viewer error: ' + (e.reason && e.reason.message || e.reason); });
</script>
<script type="module" nonce="${nonce}">
  import * as pdfjsLib from "${lib}";
  window.__specc = { pdfjsLib, workerUrl: "${worker}", pdfUrl: "${this.pdfUrl()}" };
  await import("${viewer}");
</script>
</body></html>`;
  }
}
