/** Metadata shared with the viewers; source paths stay in the extension host. */
export interface PreviewTarget {
  key: string;
  spec: string;
  anchors: string[];
  title: string;
  kind: 'document' | 'object' | 'float';
}

export interface SourceTarget extends PreviewTarget {
  file: string;
  line: number;
  endLine: number | null;
}

/** Prefer the closest preceding entity in this file, including included files. */
export function targetAtLine(targets: SourceTarget[], file: string, line: number): SourceTarget | undefined {
  const inFile = targets.filter(t => t.file === file).sort((a, b) => b.line - a.line);
  return inFile.find(t => t.kind !== 'document' && t.line <= line && (t.endLine === null || line < t.endLine))
    ?? inFile.find(t => t.line <= line) ?? inFile.at(-1);
}

export function normalizeTitle(title: string): string {
  return title.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
