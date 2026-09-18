import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Project } from './project';

/**
 * Injected before any script of index.html. Restores the hash route before the
 * app boots and restores/saves scroll positions of every scrolled element via
 * the webview's persisted state, so a rebuild-driven reload lands where the
 * reader was.
 */
const STATE_SCRIPT = `
(function () {
  var vscode = acquireVsCodeApi();
  var state = vscode.getState() || {};
  if (state.hash && !location.hash) { location.hash = state.hash; }

  function pathOf(el) {
    var parts = [];
    while (el && el !== document.body && el.nodeType === 1) {
      if (el.id) { parts.unshift('#' + CSS.escape(el.id)); break; }
      var i = 1, s = el;
      while ((s = s.previousElementSibling)) { if (s.tagName === el.tagName) i++; }
      parts.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
      el = el.parentElement;
    }
    return parts.join('>');
  }

  var pending = null;
  function save() {
    pending = null;
    var scrolls = {};
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.scrollTop > 0 || el.scrollLeft > 0) {
        scrolls[pathOf(el)] = { top: el.scrollTop, left: el.scrollLeft };
      }
    }
    vscode.setState({ hash: location.hash, scrolls: scrolls, win: [window.scrollX, window.scrollY] });
  }
  function scheduleSave() { if (pending == null) pending = setTimeout(save, 150); }
  document.addEventListener('scroll', scheduleSave, true);
  window.addEventListener('hashchange', scheduleSave);

  // Content is rendered asynchronously after the route resolves: retry restoring
  // until every target can actually reach its saved offset, for up to ~3s.
  function restore() {
    var scrolls = state.scrolls || {};
    var keys = Object.keys(scrolls);
    if (state.win) window.scrollTo(state.win[0], state.win[1]);
    var deadline = Date.now() + 3000;
    (function tick() {
      var done = true;
      for (var i = 0; i < keys.length; i++) {
        var el = null;
        try { el = document.querySelector(keys[i]); } catch (e) {}
        var want = scrolls[keys[i]];
        if (!el) { continue; }
        var canReach = el.scrollHeight - el.clientHeight >= want.top - 1;
        if (canReach) { el.scrollTop = want.top; el.scrollLeft = want.left; }
        else { done = false; }
      }
      if (!done && Date.now() < deadline) requestAnimationFrame(tick);
    })();
  }
  if (document.readyState === 'complete') setTimeout(restore, 0);
  else window.addEventListener('load', function () { setTimeout(restore, 0); });
})();
`;

export class HtmlPreview {
  private panel: vscode.WebviewPanel | undefined;
  private project: Project | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  boundTo(project: Project): boolean {
    return !!this.panel && this.project?.yamlPath === project.yamlPath;
  }

  async show(project: Project): Promise<void> {
    this.project = project;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('specc.html', 'SpecCompiler HTML', vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(project.rootDir), vscode.Uri.file(project.outputDir)],
        enableFindWidget: true,
      });
      this.panel.onDidDispose(() => { this.panel = undefined; }, null, this.context.subscriptions);
    } else {
      this.panel.reveal(undefined, true);
    }
    this.panel.title = `${project.name} · HTML`;
    this.refresh();
  }

  /** Reloads index.html from disk. No-op when the panel is closed. */
  refresh(): void {
    if (!this.panel || !this.project) return;
    const file = this.project.indexHtml;
    if (!fs.existsSync(file)) {
      this.panel.webview.html = placeholder(
        `No HTML output yet`,
        `Expected <code>${escapeHtml(vscode.workspace.asRelativePath(file))}</code>. Run <b>SpecCompiler: Build Project</b> or save a document to build.`,
      );
      return;
    }
    this.panel.webview.html = this.transform(fs.readFileSync(file, 'utf8'), path.dirname(file));
  }

  private transform(html: string, baseDir: string): string {
    const webview = this.panel!.webview;
    const csp = webview.cspSource;
    // Relative asset references (e.g. ../diagrams/x.png) must go through the webview resource scheme.
    html = html.replace(
      /(<(?:img|script|link|source|video|audio|object)\b[^>]*?\s(?:src|href|data)=")([^"]+)(")/gi,
      (m, pre: string, ref: string, post: string) => {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(ref)) return m;
        const uri = webview.asWebviewUri(vscode.Uri.file(path.resolve(baseDir, ref.split(/[?#]/)[0])));
        return pre + uri.toString() + post;
      },
    );
    const head =
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data: blob:; ` +
      `style-src ${csp} 'unsafe-inline'; font-src ${csp} data:; script-src ${csp} 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; ` +
      `connect-src ${csp} data: blob:; worker-src blob:;">` +
      `<script>${STATE_SCRIPT}</script>`;
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + head);
    return head + html;
  }
}

export function placeholder(title: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:2rem;line-height:1.5}
    code{font-family:var(--vscode-editor-font-family)}</style></head>
    <body><h2>${escapeHtml(title)}</h2><p>${body}</p></body></html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
