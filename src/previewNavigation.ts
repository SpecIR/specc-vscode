import * as vscode from 'vscode';
import { Project } from './project';
import { SpecDb } from './specdb';
import { SourceTarget, targetAtLine } from './previewTargets';

interface Preview {
  panel: vscode.WebviewPanel;
  project: () => Project | undefined;
  specs: () => string[] | undefined;
  ready: boolean;
  pending?: string;
}

/** Coordinates both viewers and keeps the source cursor when a webview takes focus. */
export class PreviewNavigation {
  private previews: Preview[] = [];
  private preferred: Preview | undefined;
  private editor = vscode.window.activeTextEditor;

  constructor(private context: vscode.ExtensionContext, private db: SpecDb, private output: vscode.OutputChannel) {
    const remember = (editor: vscode.TextEditor | undefined) => {
      if (editor?.document.uri.scheme === 'file' && editor.document.languageId === 'markdown') this.editor = editor;
    };
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(remember),
      vscode.window.onDidChangeTextEditorSelection(e => remember(e.textEditor)),
      vscode.commands.registerCommand('specc.showInPreview', () => this.guard(() => this.forward())),
      vscode.commands.registerCommand('specc.showInSource', () => {
        const preview = this.preferred ?? this.previews[0];
        if (preview) void preview.panel.webview.postMessage({ type: 'requestSource' });
        else this.notice('Open an HTML or PDF preview first.');
      }),
    );
  }

  attach(panel: vscode.WebviewPanel, project: Preview['project'], specs: Preview['specs'] = () => undefined): void {
    const preview: Preview = { panel, project, specs, ready: false };
    this.previews.push(preview);
    this.preferred = preview;
    this.context.subscriptions.push(
      panel.onDidChangeViewState(() => { if (panel.active) this.preferred = preview; }),
      panel.onDidDispose(() => {
        this.previews = this.previews.filter(p => p !== preview);
        if (this.preferred === preview) this.preferred = undefined;
      }),
      panel.webview.onDidReceiveMessage(msg => this.guard(async () => {
        if (msg?.type === 'navigationReady') {
          await this.sendTargets(preview);
          preview.ready = true;
          if (preview.pending) {
            await panel.webview.postMessage({ type: 'revealTarget', key: preview.pending });
            preview.pending = undefined;
          }
        }
        else if (msg?.type === 'showPreview') await this.forward(preview);
        else if (msg?.type === 'showSource' && typeof msg.key === 'string') {
          // Resolve keys against the bound database; never accept a webview-supplied file path.
          const target = (await this.targets(preview)).find(t => t.key === msg.key);
          if (!target) { this.notice('Source location is unavailable. Rebuild the project and try again.'); return; }
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target.file));
          const pos = new vscode.Position(Math.min(doc.lineCount - 1, Math.max(0, target.line - 1)), 0);
          const column = this.editor && this.editor.viewColumn !== panel.viewColumn
            ? this.editor.viewColumn : vscode.ViewColumn.Beside;
          const editor = await vscode.window.showTextDocument(doc, { viewColumn: column, selection: new vscode.Range(pos, pos) });
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
          this.editor = editor;
        } else if (msg?.type === 'navigationMissing') {
          this.notice('No matching location in this preview. Rebuild the project or choose a nearby heading.');
        }
      })),
    );
  }

  loading(panel: vscode.WebviewPanel): void {
    const preview = this.previews.find(p => p.panel === panel);
    if (preview) preview.ready = false;
  }

  private async targets(preview: Preview): Promise<SourceTarget[]> {
    const project = preview.project();
    if (!project) return [];
    const specs = preview.specs();
    return (await this.db.previewTargets(project)).filter(t => !specs || specs.includes(t.spec));
  }

  private async sendTargets(preview: Preview, targets?: SourceTarget[]): Promise<void> {
    await preview.panel.webview.postMessage({ type: 'navigationTargets', targets: (targets ?? await this.targets(preview))
      .map(({ file, line, endLine, ...target }) => target) });
  }

  private async forward(requested?: Preview): Promise<void> {
    const editor = this.editor;
    if (!editor || editor.document.isClosed) { this.notice('Place the cursor in a Markdown source file first.'); return; }
    const ordered = requested ? [requested] : [...new Set([this.preferred, ...this.previews])].filter((p): p is Preview => !!p);
    if (!ordered.length) { this.notice('Open an HTML or PDF preview first.'); return; }
    for (const preview of ordered) {
      const targets = await this.targets(preview);
      const target = targetAtLine(targets, editor.document.uri.fsPath, editor.selection.active.line + 1);
      if (!target) continue;
      preview.panel.reveal(undefined, true);
      if (preview.ready) {
        await this.sendTargets(preview, targets);
        await preview.panel.webview.postMessage({ type: 'revealTarget', key: target.key });
      } else preview.pending = target.key;
      this.preferred = preview;
      return;
    }
    this.notice('No source location for this file in the open preview. Build the project and open its preview.');
  }

  private notice(message: string): void { void vscode.window.showInformationMessage(`SpecCompiler: ${message}`); }
  private async guard(fn: () => Promise<void>): Promise<void> {
    try { await fn(); } catch (e) {
      this.output.appendLine(`[preview navigation] ${(e as Error).stack ?? e}`);
      this.notice('Could not navigate. See the SpecCompiler output for details.');
    }
  }
}
