# SpecCompiler Preview (specc-vscode)

Live preview of [SpecCompiler](https://github.com/specir/speccompiler) projects inside VS Code.

- Detects the project yaml (a `*.yaml` with a `doc_files` key), walking up from the
  current file, or scanning the workspace.
- **SpecCompiler: Open HTML Preview** shows the assembled web app
  (`<output_dir>/www/index.html`) when `outputs` has an `html5` entry.
- **SpecCompiler: Open PDF Preview** shows the LibreOffice PDF next to the docx
  output (or `docx.pdf_path`) when `docx.export_pdf: true`. Uses a bundled pdf.js.
- Saving any `.md` of the project (or the yaml) runs `speccompiler build <yaml>` from
  the project directory and refreshes open previews, keeping route, scroll and zoom.
- Status bar shows build state and duration; failures open a notification with a
  link to the **SpecCompiler** output channel. **SpecCompiler: Build Project**
  builds on demand.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `specc.command` | `specc` | CLI invoked as `<command> build <project.yaml>` |
| `specc.buildOnSave` | `true` | Rebuild when a project file is saved |

## Development

```bash
npm install
npm run build        # bundle to dist/ and media/pdf-viewer.js (pdf.js + worker embedded)
npm run watch
npm run package      # creates specc-vscode-<version>.vsix
code --install-extension specc-vscode-0.1.0.vsix
```

Press F5 in VS Code with this folder open to launch an Extension Development Host.

## Releasing

Every push to `main` uploads the vsix as a workflow artifact. To publish a release:

```bash
npm version patch          # bumps package.json and creates tag vX.Y.Z
git push --follow-tags
```

The `v*` tag triggers [release.yml](.github/workflows/release.yml), which attaches the
vsix to a GitHub Release. If a `VSCE_PAT` repository secret exists, the same run also
publishes to the VS Code Marketplace.
