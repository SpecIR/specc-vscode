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
- **Navigate CommonSpec references** using `<output_dir>/specir.db` (reloaded
  after each build): Ctrl+click or F12 on `[PID](@)` / `[type:label](#)` jumps
  to the object or float's source line; hover shows what it is; Shift+F12 on a
  reference or on a heading's `@PID` lists every relation that targets it.
- **Include blocks**: paths inside ```` ```include ```` fences are clickable links.
- **Source ↔ preview navigation**: hover the small handle midway down the preview's
  left edge to reveal the arrow buttons. They tuck away when the pointer leaves;
  keyboard focus also reveals them. Place the cursor in a Markdown file and click **→**
  to reveal it in the preview. Click a location in the preview and then **←** to
  open its source; without a click, the current viewport center is used. Scrolling
  clears the clicked location. The destination is briefly highlighted.
  The editor title also has a **→** button, and the command palette offers
  **SpecCompiler: Show Source in Preview** and **SpecCompiler: Show Preview in Source**.
  Navigation uses the last build's `specir.db`, including source locations in
  included files. Jumps land at the nearest heading, figure, or table, rather than
  individual words. PDF positions use exported bookmarks and headings, falling
  back to text matching; the first PDF jump can take longer while indexing.
  Rebuild after source edits to update locations. Open the matching document's
  preview first; when both formats are open, the most recently focused preview is used.
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
npm run build        # bundle to dist/ and media/ (pdf.js viewer, sql.js wasm)
npm run check        # TypeScript validation
npm test             # navigation regression tests
npm run watch
npm run package      # creates specc-vscode-<version>.vsix
code --install-extension specc-vscode-0.1.1.vsix
```

Press F5 in VS Code with this folder open to launch an Extension Development Host.

## Releasing

Every push uploads the vsix as a workflow artifact. To publish a release:

```bash
npm version patch          # bumps package.json and creates tag vX.Y.Z
git push --follow-tags
```

The `v*` tag triggers [release.yml](.github/workflows/release.yml), which attaches the
vsix to a GitHub Release. If a `VSCE_PAT` repository secret exists, the same run also
publishes to the VS Code Marketplace.
