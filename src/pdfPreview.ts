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
  private messageSub: vscode.Disposable | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly output: vscode.OutputChannel) {}

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
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.loaded = false;
        this.messageSub?.dispose();
        this.messageSub = undefined;
      }, null, this.context.subscriptions);
      this.loaded = false;
    } else {
      this.panel.reveal(undefined, true);
    }
    this.panel.title = `${path.basename(pdfPath)} · PDF`;
    if (!this.loaded || rebind) this.load();
    else this.refresh();
  }

  /** Push the current PDF bytes to the running viewer, keeping scroll and zoom. Loads the viewer if it is not there yet. */
  refresh(): void {
    if (!this.panel || !this.pdfPath) return;
    if (!this.loaded || !fs.existsSync(this.pdfPath)) { this.load(); return; }
    this.sendPdf();
  }

  private sendPdf(): void {
    try {
      const data = fs.readFileSync(this.pdfPath!);
      void this.panel!.webview.postMessage({ type: 'pdf', data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) });
    } catch (e) {
      void vscode.window.showErrorMessage(`SpecCompiler: cannot read ${this.pdfPath}: ${(e as Error).message}`);
    }
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
    const viewer = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'pdf-viewer.js'));
    if (!this.messageSub) {
      this.messageSub = webview.onDidReceiveMessage((msg) => {
        if (msg?.type === 'ready') this.sendPdf();
        else if (msg?.type === 'status') this.output.appendLine(`[PDF preview] ${msg.text}`);
      });
      this.context.subscriptions.push(this.messageSub);
    }
    const csp = webview.cspSource;
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    this.loaded = true;
    webview.html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; worker-src blob:; img-src ${csp} blob: data:; style-src ${csp} 'unsafe-inline';">
<style>
  html,body{margin:0;height:100%;background:var(--vscode-editor-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family)}
  #bar{flex-wrap:wrap;position:sticky;top:0;z-index:2;display:flex;gap:.5rem;align-items:center;padding:.3rem .6rem;background:var(--vscode-editorWidget-background);border-bottom:1px solid var(--vscode-widget-border,#0003);font-size:12px}
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
<script nonce="${nonce}" src="${viewer}"></script>
</body></html>`;
  }
}
