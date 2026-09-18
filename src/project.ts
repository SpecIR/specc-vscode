import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as YAML from 'yaml';

export interface DocxOutput {
  specId: string;
  docxPath: string;
  pdfPath: string;
}

export interface Project {
  yamlPath: string;
  rootDir: string;
  name: string;
  outputDir: string;
  docFiles: string[];
  htmlEnabled: boolean;
  /** Absolute path of the assembled web app (output_dir/www/index.html). */
  indexHtml: string;
  pdfEnabled: boolean;
  docxOutputs: DocxOutput[];
}

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['true', 'yes', 'on', '1'].includes(v.trim().toLowerCase());
  return false;
}

/** Cheap pre-check so we do not YAML-parse every file in the workspace. */
export function looksLikeProject(yamlPath: string): boolean {
  try {
    return /^doc_files\s*:/m.test(fs.readFileSync(yamlPath, 'utf8'));
  } catch {
    return false;
  }
}

export function loadProject(yamlPath: string): Project {
  const raw = YAML.parse(fs.readFileSync(yamlPath, 'utf8')) ?? {};
  if (!Array.isArray(raw.doc_files)) {
    throw new Error(`${path.basename(yamlPath)} has no doc_files list`);
  }
  const rootDir = path.dirname(yamlPath);
  const outputDir = path.resolve(rootDir, String(raw.output_dir ?? 'build').replace(/\/+$/, ''));
  const outputs: Array<{ format?: string; path?: string }> = Array.isArray(raw.outputs) ? raw.outputs : [];
  const docFiles = raw.doc_files.map((f: string) => path.resolve(rootDir, String(f)));
  const specIds = docFiles.map((f: string) => path.basename(f).replace(/\.md$/i, ''));

  const htmlEnabled = outputs.some((o) => o.format === 'html5' || o.format === 'html');
  const docx = raw.docx ?? {};
  const pdfEnabled = truthy(docx.export_pdf ?? docx.pdf ?? docx.libreoffice_export_pdf);
  const configuredPdf: string | undefined = docx.pdf_path ?? docx.export_pdf_path;

  const docxOutputs: DocxOutput[] = [];
  for (const o of outputs) {
    if (o.format !== 'docx') continue;
    const template = String(o.path ?? '{spec_id}.docx');
    for (const specId of specIds) {
      const docxPath = path.resolve(outputDir, template.replace(/\{spec_id\}/g, specId));
      const pdfPath = configuredPdf
        ? path.resolve(rootDir, configuredPdf)
        : docxPath.replace(/\.docx$/i, '') + '.pdf';
      docxOutputs.push({ specId, docxPath, pdfPath });
    }
  }

  return {
    yamlPath,
    rootDir,
    name: String(raw.project?.name ?? raw.project?.code ?? path.basename(rootDir)),
    outputDir,
    docFiles,
    htmlEnabled,
    indexHtml: path.join(outputDir, 'www', 'index.html'),
    pdfEnabled,
    docxOutputs,
  };
}

/** Walk up from `startDir` looking for a yaml with a doc_files key. Stops at the filesystem root. */
export function findProjectUpwards(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      /* unreadable dir: keep climbing */
    }
    // Prefer project.yaml, then any other *.yaml / *.yml.
    const candidates = entries
      .filter((e) => /\.ya?ml$/i.test(e))
      .sort((a, b) => (a === 'project.yaml' ? -1 : b === 'project.yaml' ? 1 : a.localeCompare(b)));
    for (const c of candidates) {
      const full = path.join(dir, c);
      if (looksLikeProject(full)) return full;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export async function findProjectsInWorkspace(): Promise<string[]> {
  const uris = await vscode.workspace.findFiles('**/*.{yaml,yml}', '**/{node_modules,.git,build}/**', 200);
  return uris.map((u) => u.fsPath).filter(looksLikeProject).sort();
}

/**
 * Resolve the project for a given file (walking up), falling back to the
 * workspace scan and a QuickPick when several projects exist.
 */
export async function resolveProject(fileHint?: string): Promise<Project | undefined> {
  let yamlPath: string | undefined;
  if (fileHint) yamlPath = findProjectUpwards(path.dirname(fileHint));
  if (!yamlPath) {
    const found = await findProjectsInWorkspace();
    if (found.length === 1) yamlPath = found[0];
    else if (found.length > 1) {
      const pick = await vscode.window.showQuickPick(
        found.map((p) => ({ label: path.basename(p), description: vscode.workspace.asRelativePath(path.dirname(p)), p })),
        { placeHolder: 'Select the SpecCompiler project' },
      );
      yamlPath = pick?.p;
    }
  }
  if (!yamlPath) {
    vscode.window.showErrorMessage('SpecCompiler: no project yaml with a doc_files key found in the workspace.');
    return undefined;
  }
  try {
    return loadProject(yamlPath);
  } catch (e) {
    vscode.window.showErrorMessage(`SpecCompiler: cannot read ${yamlPath}: ${(e as Error).message}`);
    return undefined;
  }
}

/** True when `file` belongs to the project (any .md under the root, outside the output dir, or the yaml). */
export function fileBelongsTo(project: Project, file: string): boolean {
  if (file === project.yamlPath) return true;
  if (!/\.md$/i.test(file)) return false;
  const rel = path.relative(project.rootDir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  const relOut = path.relative(project.outputDir, file);
  return relOut.startsWith('..') || path.isAbsolute(relOut);
}
