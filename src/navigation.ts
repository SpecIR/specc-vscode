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

/** `@PID` on a heading line: the definition itself. */
function pidDefinitionAt(doc: vscode.TextDocument, pos: vscode.Position): { target: string; range: vscode.Range } | undefined {
  const line = doc.lineAt(pos.line).text;
  if (!/^\s*#{1,6}\s/.test(line)) return undefined;
  const re = /@([A-Za-z0-9_][A-Za-z0-9_.:-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (pos.character >= m.index && pos.character <= m.index + m[0].length) {
      return { target: m[1], range: new vscode.Range(pos.line, m.index, pos.line, m.index + m[0].length) };
    }
  }
  return undefined;
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

async function openHit(hits: Array<ObjectInfo | FloatInfo>): Promise<void> {
  let hit = hits[0];
  if (hits.length > 1) {
    const pick = await vscode.window.showQuickPick(
      hits.map((h) => ({ label: describe(h).replace(/\*\*|`/g, ''), description: vscode.workspace.asRelativePath(h.file) + ':' + h.line, h })),
      { placeHolder: 'Several definitions match' },
    );
    if (!pick) return;
    hit = pick.h;
  }
  const pos = new vscode.Position(Math.max(0, hit.line - 1), 0);
  await vscode.window.showTextDocument(vscode.Uri.file(hit.file), { selection: new vscode.Range(pos, pos) });
}

export function registerNavigation(context: vscode.ExtensionContext, db: SpecDb, output: vscode.OutputChannel): void {
  const guard = <T>(what: string, fn: () => Promise<T>): Promise<T | undefined> =>
    fn().catch((e) => { output.appendLine(`[navigation] ${what}: ${(e as Error).stack ?? e}`); return undefined; });

  const selector: vscode.DocumentSelector = { language: 'markdown', scheme: 'file' };

  const resolve = async (doc: vscode.TextDocument, ref: Ref): Promise<Array<ObjectInfo | FloatInfo>> => {
    const project = projectFor(doc);
    if (!project) return [];
    return ref.kind === '@' ? db.objectByPid(project, ref.target) : db.byLabel(project, ref.target);
  };

  const resolveTarget = async (docPath: string, kind: '@' | '#', target: string) => {
    const yamlPath = findProjectUpwards(path.dirname(docPath));
    if (!yamlPath) return [];
    const project = loadProject(yamlPath);
    return kind === '@' ? db.objectByPid(project, target) : db.byLabel(project, target);
  };

  context.subscriptions.push(
    // Target of the document links below (Ctrl+click). The built-in markdown extension also
    // linkifies [x](@) as a relative path "@", so we provide our own link on the same range.
    vscode.commands.registerCommand('specc.openRef', (docPath: string, kind: '@' | '#', target: string) => guard('openRef', async () => {
      const hits = await resolveTarget(docPath, kind, target);
      if (hits.length === 0) {
        vscode.window.showWarningMessage(`SpecCompiler: "${target}" not found in specir.db. Build the project and try again.`);
        return;
      }
      await openHit(hits);
    })),

    // Ctrl+click / F12 on [PID](@), [type:label](#) and include paths.
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition: (doc, pos) => guard('definition', async () => {
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
      }),
    }),

    // Underlined, clickable include paths and references.
    vscode.languages.registerDocumentLinkProvider(selector, {
      provideDocumentLinks(doc) {
        const links = includeLinks(doc).map((l) => {
          const link = new vscode.DocumentLink(l.range, vscode.Uri.file(l.file));
          link.tooltip = fs.existsSync(l.file) ? 'Open included file' : 'Included file not found';
          return link;
        });
        for (let i = 0; i < doc.lineCount; i++) {
          const text = doc.lineAt(i).text;
          REF_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = REF_RE.exec(text))) {
            const args = encodeURIComponent(JSON.stringify([doc.uri.fsPath, m[2], m[1]]));
            const link = new vscode.DocumentLink(
              new vscode.Range(i, m.index, i, m.index + m[0].length),
              vscode.Uri.parse(`command:specc.openRef?${args}`),
            );
            link.tooltip = 'Go to SpecCompiler definition';
            links.push(link);
          }
        }
        return links;
      },
    }),

    // Shift+F12 on a reference or on the @PID of a heading: every relation targeting it.
    vscode.languages.registerReferenceProvider(selector, {
      provideReferences: (doc, pos) => guard('references', async () => {
        const project = projectFor(doc);
        if (!project) return [];
        const ref = refAt(doc, pos);
        const def = ref ? undefined : pidDefinitionAt(doc, pos);
        const kind = ref?.kind ?? (def ? '@' : undefined);
        const target = ref?.target ?? def?.target;
        if (!kind || !target) return [];
        const refs = await db.referencesTo(project, kind, target);
        return refs.map((r) => new vscode.Location(vscode.Uri.file(r.file), new vscode.Position(Math.max(0, r.line - 1), 0)));
      }),
    }),

    // Hover: what a reference points to, who references a definition, where an include goes.
    vscode.languages.registerHoverProvider(selector, {
      provideHover: (doc, pos) => guard('hover', async () => {
        const inc = includeLinks(doc).find((l) => l.range.contains(pos));
        if (inc) {
          const rel = vscode.workspace.asRelativePath(inc.file);
          return new vscode.Hover(new vscode.MarkdownString(fs.existsSync(inc.file) ? `Includes \`${rel}\`` : `Included file not found: \`${rel}\``), inc.range);
        }
        const project = projectFor(doc);
        if (!project) return undefined;
        const ref = refAt(doc, pos);
        if (ref) {
          const hits = await resolve(doc, ref);
          if (hits.length === 0) return new vscode.Hover(new vscode.MarkdownString(`\`${ref.target}\` not found in specir.db`), ref.range);
          const md = new vscode.MarkdownString(
            hits.map((h) => `${describe(h)}  \n${vscode.workspace.asRelativePath(h.file)}:${h.line}`).join('\n\n---\n\n'),
          );
          return new vscode.Hover(md, ref.range);
        }
        const def = pidDefinitionAt(doc, pos);
        if (def) {
          const refs = await db.referencesTo(project, '@', def.target);
          const lines = refs.slice(0, 15).map((r) => `- ${r.relation ?? 'ref'} from ${r.sourcePid ? '`' + r.sourcePid + '`' : ''} ${vscode.workspace.asRelativePath(r.file)}:${r.line}`);
          if (refs.length > 15) lines.push(`- … ${refs.length - 15} more`);
          const md = new vscode.MarkdownString(`\`${def.target}\` — ${refs.length} incoming reference${refs.length === 1 ? '' : 's'}` + (lines.length ? '\n\n' + lines.join('\n') : ''));
          return new vscode.Hover(md, def.range);
        }
        return undefined;
      }),
    }),
  );
}
