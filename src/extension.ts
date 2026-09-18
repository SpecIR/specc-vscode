import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Builder } from './builder';
import { HtmlPreview } from './htmlPreview';
import { PdfPreview } from './pdfPreview';
import { fileBelongsTo, findProjectUpwards, loadProject, Project, resolveProject } from './project';

export function activate(context: vscode.ExtensionContext): void {
  const builder = new Builder();
  const html = new HtmlPreview(context);
  const pdf = new PdfPreview(context, builder.output);
  context.subscriptions.push(builder);

  builder.onDidBuild((project, result) => {
    if (!result.ok) return;
    if (html.boundTo(project)) html.refresh();
    if (pdf.boundTo(project)) pdf.refresh();
  });

  const activeFile = () => vscode.window.activeTextEditor?.document.uri.fsPath;

  context.subscriptions.push(
    vscode.commands.registerCommand('specc.openHtml', async () => {
      const project = await resolveProject(activeFile());
      if (!project) return;
      if (!project.htmlEnabled) {
        const a = await vscode.window.showWarningMessage(
          `SpecCompiler: ${path.basename(project.yamlPath)} has no html5 entry under "outputs"; add one to enable the HTML preview.`,
          'Open project.yaml',
        );
        if (a) await vscode.window.showTextDocument(vscode.Uri.file(project.yamlPath));
        return;
      }
      await html.show(project);
      await offerBuildIfMissing(project, project.indexHtml, builder);
    }),

    vscode.commands.registerCommand('specc.openPdf', async () => {
      const file = activeFile();
      const project = await resolveProject(file);
      if (!project) return;
      if (!project.pdfEnabled || project.docxOutputs.length === 0) {
        const why = project.docxOutputs.length === 0 ? 'no docx entry under "outputs"' : '"docx.export_pdf" is not true';
        const a = await vscode.window.showWarningMessage(
          `SpecCompiler: ${path.basename(project.yamlPath)} does not export PDFs (${why}).`,
          'Open project.yaml',
        );
        if (a) await vscode.window.showTextDocument(vscode.Uri.file(project.yamlPath));
        return;
      }
      const target = await pickPdf(project, file);
      if (!target) return;
      await pdf.show(project, target);
      await offerBuildIfMissing(project, target, builder);
    }),

    vscode.commands.registerCommand('specc.build', async () => {
      const project = await resolveProject(activeFile());
      if (project) await builder.build(project, 'manual build');
    }),

    vscode.commands.registerCommand('specc.showOutput', () => builder.output.show(true)),

    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!vscode.workspace.getConfiguration('specc').get<boolean>('buildOnSave', true)) return;
      const file = doc.uri.fsPath;
      if (!/\.(md|ya?ml)$/i.test(file)) return;
      const yamlPath = findProjectUpwards(path.dirname(file));
      if (!yamlPath) return;
      let project: Project;
      try {
        project = loadProject(yamlPath);
      } catch (e) {
        vscode.window.showErrorMessage(`SpecCompiler: cannot read ${path.basename(yamlPath)}: ${(e as Error).message}`);
        return;
      }
      if (!fileBelongsTo(project, file)) return;
      void builder.build(project, `saved ${vscode.workspace.asRelativePath(file)}`);
    }),
  );
}

export function deactivate(): void {}

async function offerBuildIfMissing(project: Project, output: string, builder: Builder): Promise<void> {
  if (fs.existsSync(output)) return;
  const a = await vscode.window.showInformationMessage(
    `SpecCompiler: ${vscode.workspace.asRelativePath(output)} does not exist yet.`,
    'Build now',
  );
  if (a) await builder.build(project, 'build requested from preview');
}

/** Choose the PDF matching the active doc file, else the only one, else ask. */
async function pickPdf(project: Project, file: string | undefined): Promise<string | undefined> {
  const outs = project.docxOutputs;
  const unique = [...new Map(outs.map((o) => [o.pdfPath, o])).values()];
  if (file) {
    const specId = path.basename(file).replace(/\.md$/i, '');
    const match = unique.find((o) => o.specId === specId);
    if (match) return match.pdfPath;
  }
  if (unique.length === 1) return unique[0].pdfPath;
  const pick = await vscode.window.showQuickPick(
    unique.map((o) => ({
      label: o.specId,
      description: vscode.workspace.asRelativePath(o.pdfPath) + (fs.existsSync(o.pdfPath) ? '' : '  (not built yet)'),
      p: o.pdfPath,
    })),
    { placeHolder: 'Which document?' },
  );
  return pick?.p;
}
