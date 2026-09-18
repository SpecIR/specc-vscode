import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { findProjectUpwards, loadProject, Project } from './project';
import { SpecDb, ObjectInfo, FloatInfo } from './specdb';

/** `[TARGET](@)` and `[TARGET](#)` — CommonSpec cross-references. `[key](@cite)` is excluded. */
const REF_RE = /\[([^\[\]\n]+)\]\((@|#)\)/g;

interface Ref {
  target: string;
  kind: '@' | '#';
  range: vscode.Range;
}

function refAt(doc: vscode.TextDocument, pos: vscode.Position): Ref | undefined {
  const line = doc.lineAt(pos.line).text;
  REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(line))) {
    const start = m.index;
    const end = start + m[0].length;
    if (pos.character >= start && pos.character <= end) {
      return { target: m[1], kind: m[2] as '@' | '#', range: new vscode.Range(pos.line, start + 1, pos.line, start + 1 + m[1].length) };
    }
  }
  return undefined;
}

/** Lines of ```include / ```{.include} fences, as (range, absolute path) pairs. */
function includeLinks(doc: vscode.TextDocument): Array<{ range: vscode.Range; file: string }> {
  const out: Array<{ range: vscode.Range; file: string }> = [];
  const dir = path.dirname(doc.uri.fsPath);
  let inInclude = false;
  let fence = '';
  for (let i = 0; i < doc.lineCount; i++) {
    const text = doc.lineAt(i).text;
    if (!inInclude) {
      const open = /^(\s*)(`{3,}|~{3,})\s*(?:include|\{\.include[^}]*\})\s*$/.exec(text);
      if (open) { inInclude = true; fence = open[2]; }
      continue;
    }
    if (text.trim().startsWith(fence)) { inInclude = false; continue; }
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const start = text.indexOf(trimmed);
    out.push({ range: new vscode.Range(i, start, i, start + trimmed.length), file: path.resolve(dir, trimmed) });
  }
  return out;
}

function projectFor(doc: vscode.TextDocument): Project | undefined {
  const yamlPath = findProjectUpwards(path.dirname(doc.uri.fsPath));
  if (!yamlPath) return undefined;
  try {
    return loadProject(yamlPath);
  } catch {
    return undefined;
  }
}

function describe(hit: ObjectInfo | FloatInfo): string {
  if ('pid' in hit) {
    const id = hit.pid ?? hit.label ?? '';
    return `**${hit.type}** ${id ? '`' + id + '`' : ''} — ${hit.title}`;
  }
  return `**${hit.type}** \`${hit.label}\`${hit.caption ? ' — ' + hit.caption : ''}`;
}

export function registerNavigation(context: vscode.ExtensionContext, db: SpecDb): void {
  const selector: vscode.DocumentSelector = { language: 'markdown', scheme: 'file' };

  const resolve = async (doc: vscode.TextDocument, ref: Ref): Promise<Array<ObjectInfo | FloatInfo>> => {
    const project = projectFor(doc);
    if (!project) return [];
    return ref.kind === '@' ? db.objectByPid(project, ref.target) : db.byLabel(project, ref.target);
  };

  context.subscriptions.push(
    // Ctrl+click / F12 on [PID](@), [type:label](#) and include paths.
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(doc, pos) {
        const inc = includeLinks(doc).find((l) => l.range.contains(pos));
        if (inc) return fs.existsSync(inc.file) ? new vscode.Location(vscode.Uri.file(inc.file), new vscode.Position(0, 0)) : undefined;
        const ref = refAt(doc, pos);
        if (!ref) return undefined;
        const hits = await resolve(doc, ref);
        if (hits.length === 0) {
          const project = projectFor(doc);
          const hint = project && !fs.existsSync(db.dbPath(project)) ? ' (no specir.db yet: build the project first)' : '';
          vscode.window.setStatusBarMessage(`$(warning) SpecCompiler: "${ref.target}" not found in specir.db${hint}`, 4000);
          return undefined;
        }
        return hits.map((h): vscode.DefinitionLink => ({
          originSelectionRange: ref.range,
          targetUri: vscode.Uri.file(h.file),
          targetRange: new vscode.Range(Math.max(0, h.line - 1), 0, Math.max(0, h.line - 1), 0),
        }));
      },
    }),

    // Underlined, clickable include paths.
    vscode.languages.registerDocumentLinkProvider(selector, {
      provideDocumentLinks(doc) {
        return includeLinks(doc).map((l) => {
          const link = new vscode.DocumentLink(l.range, vscode.Uri.file(l.file));
          link.tooltip = fs.existsSync(l.file) ? 'Open included file' : 'Included file not found';
          return link;
        });
      },
    }),

    // Hover: what the reference points to.
    vscode.languages.registerHoverProvider(selector, {
      async provideHover(doc, pos) {
        const ref = refAt(doc, pos);
        if (!ref) return undefined;
        const hits = await resolve(doc, ref);
        if (hits.length === 0) return undefined;
        const md = new vscode.MarkdownString(
          hits.map((h) => `${describe(h)}  \n${vscode.workspace.asRelativePath(h.file)}:${h.line}`).join('\n\n---\n\n'),
        );
        return new vscode.Hover(md, ref.range);
      },
    }),
  );
}
