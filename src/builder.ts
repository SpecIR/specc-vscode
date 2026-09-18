import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { Project } from './project';

const ANSI = /\x1b\[[0-9;]*m/g;

export interface BuildResult {
  ok: boolean;
  seconds: number;
  warnings: number;
  errors: number;
}

/** Runs `speccompiler build <yaml>` one project at a time; a save during a build queues one more run. */
export class Builder {
  readonly output = vscode.window.createOutputChannel('SpecCompiler');
  private readonly status: vscode.StatusBarItem;
  private running: Promise<BuildResult> | undefined;
  private queued: Project | undefined;
  private readonly listeners: Array<(p: Project, r: BuildResult) => void> = [];

  constructor() {
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.status.command = 'specc.showOutput';
    this.status.text = '$(book) SpecCompiler';
    this.status.tooltip = 'SpecCompiler: show build output';
    this.status.show();
  }

  onDidBuild(fn: (p: Project, r: BuildResult) => void): void {
    this.listeners.push(fn);
  }

  dispose(): void {
    this.status.dispose();
    this.output.dispose();
  }

  /** Build now, or queue if a build is running. Resolves with the result of the build that ends up covering this request. */
  build(project: Project, reason: string): Promise<BuildResult> {
    if (this.running) {
      this.queued = project;
      this.status.text = '$(sync~spin) SpecCompiler: queued';
      return this.running;
    }
    this.running = this.run(project, reason).finally(() => {
      this.running = undefined;
      const next = this.queued;
      this.queued = undefined;
      if (next) void this.build(next, 'pending save');
    });
    return this.running;
  }

  private run(project: Project, reason: string): Promise<BuildResult> {
    const command = vscode.workspace.getConfiguration('specc').get<string>('command', 'specc');
    const yamlName = path.basename(project.yamlPath);
    const start = Date.now();
    this.status.text = '$(sync~spin) SpecCompiler: building…';
    this.output.appendLine(`\n[${new Date().toLocaleTimeString()}] ${reason}: ${command} build ${yamlName}  (cwd ${project.rootDir})`);

    return Promise.resolve(vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `SpecCompiler: building ${project.name}` },
      () =>
        new Promise<BuildResult>((resolve) => {
          let warnings = 0;
          let errors = 0;
          let spawnError: string | undefined;
          const onData = (chunk: Buffer) => {
            const text = chunk.toString().replace(ANSI, '');
            for (const line of text.split(/\r?\n/)) {
              if (!line) continue;
              if (/\b(WARN|warning)\b/i.test(line)) warnings++;
              if (/\b(ERROR|error)\b/i.test(line)) errors++;
              this.output.appendLine(line);
            }
          };
          const child = spawn(command, ['build', yamlName], { cwd: project.rootDir, shell: true });
          child.stdout.on('data', onData);
          child.stderr.on('data', onData);
          child.on('error', (e) => { spawnError = e.message; });
          child.on('close', (code) => {
            const seconds = (Date.now() - start) / 1000;
            const ok = code === 0 && !spawnError;
            const result = { ok, seconds, warnings, errors };
            this.report(project, result, code, spawnError, command);
            for (const fn of this.listeners) fn(project, result);
            resolve(result);
          });
        }),
    ));
  }

  private report(project: Project, r: BuildResult, code: number | null, spawnError: string | undefined, command: string): void {
    const t = `${r.seconds.toFixed(1)}s`;
    if (r.ok) {
      const warn = r.warnings ? ` · ${r.warnings} warning${r.warnings === 1 ? '' : 's'}` : '';
      this.status.text = `$(check) SpecCompiler: built in ${t}${warn}`;
      this.status.tooltip = `${project.name}: build succeeded (${t})${warn}. Click for output.`;
      this.output.appendLine(`Build succeeded in ${t}${warn}.`);
      if (r.warnings) vscode.window.setStatusBarMessage(`$(warning) SpecCompiler: ${r.warnings} warning(s) — see output`, 6000);
      return;
    }
    this.status.text = `$(error) SpecCompiler: build failed`;
    this.status.tooltip = `${project.name}: build failed. Click for output.`;
    const why = spawnError
      ? `could not run "${command}" (${spawnError}). Set "specc.command" if the CLI is installed elsewhere.`
      : `exit code ${code}${r.errors ? `, ${r.errors} error line(s)` : ''}.`;
    this.output.appendLine(`Build failed: ${why}`);
    void vscode.window.showErrorMessage(`SpecCompiler build failed: ${why}`, 'Show Output').then((a) => {
      if (a) this.output.show(true);
    });
  }
}
