const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load');

function setup() {
  const commands = {}, events = {}, notices = [], opened = [];
  const source = { document: { uri: { scheme: 'file', fsPath: '/project/include.md' }, languageId: 'markdown' },
    selection: { active: { line: 14 } }, viewColumn: 1 };
  const vscode = {
    window: {
      activeTextEditor: source,
      onDidChangeActiveTextEditor: fn => { events.active = fn; },
      onDidChangeTextEditorSelection: fn => { events.selection = fn; },
      showInformationMessage: text => notices.push(text),
      showTextDocument: async (doc, options) => {
        opened.push({ doc, options });
        return { ...source, document: doc, revealRange: () => {} };
      },
    },
    workspace: { openTextDocument: async uri => ({ uri, lineCount: 5 }) },
    commands: { registerCommand: (name, fn) => { commands[name] = fn; } },
    Uri: { file: fsPath => ({ fsPath }) },
    Position: class { constructor(line, character) { this.line = line; this.character = character; } },
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    ViewColumn: { Beside: -2 }, TextEditorRevealType: { InCenter: 1 },
  };
  const targets = [
    { key: 'object:1', spec: 'a', kind: 'object', file: '/project/include.md', line: 10, endLine: 30, anchors: ['shared'], title: 'A' },
    { key: 'object:2', spec: 'b', kind: 'object', file: '/project/b.md', line: 10, endLine: 30, anchors: ['shared'], title: 'B' },
  ];
  const { PreviewNavigation } = load('previewNavigation.ts', { vscode });
  const navigation = new PreviewNavigation({ subscriptions: [] }, { previewTargets: async () => targets }, { appendLine: () => {} });
  function panel(specs) {
    const sent = [], callbacks = {};
    const panel = { viewColumn: 2, active: true, reveal: () => {},
      onDidChangeViewState: fn => { callbacks.state = fn; }, onDidDispose: fn => { callbacks.dispose = fn; },
      webview: { onDidReceiveMessage: fn => { callbacks.message = fn; }, postMessage: async msg => { sent.push(msg); return true; } },
    };
    navigation.attach(panel, () => ({ yamlPath: '/project/project.yaml' }), () => specs);
    return { sent, callbacks, panel };
  }
  return { commands, events, notices, opened, navigation, panel };
}

test('forward navigation keeps the source cursor after webview focus and waits for readiness', async () => {
  const s = setup(), p = s.panel(['a']);
  s.events.active(undefined);
  await s.commands['specc.showInPreview']();
  assert.equal(p.sent.length, 0);
  await p.callbacks.message({ type: 'navigationReady' });
  assert.deepEqual(p.sent.at(-1), { type: 'revealTarget', key: 'object:1' });
  const metadata = p.sent.find(m => m.type === 'navigationTargets').targets;
  assert.equal(metadata.length, 1);
  assert.equal('file' in metadata[0], false);
  assert.equal('line' in metadata[0], false);
});

test('forward navigation selects a matching preview instead of another document PDF', async () => {
  const s = setup(), a = s.panel(['a']), b = s.panel(['b']);
  await a.callbacks.message({ type: 'navigationReady' });
  await b.callbacks.message({ type: 'navigationReady' });
  await s.commands['specc.showInPreview']();
  assert.equal(a.sent.at(-1).key, 'object:1');
  assert.equal(b.sent.some(m => m.type === 'revealTarget'), false);
});

test('reverse navigation validates entity keys and opens the source beside the preview with clamped lines', async () => {
  const s = setup(), p = s.panel(['a']);
  await p.callbacks.message({ type: 'showSource', key: 'object:2', file: '/untrusted.md' });
  assert.equal(s.opened.length, 0);
  await p.callbacks.message({ type: 'showSource', key: 'object:1', file: '/untrusted.md' });
  assert.equal(s.opened[0].doc.uri.fsPath, '/project/include.md');
  assert.equal(s.opened[0].options.selection.start.line, 4);
  assert.equal(s.opened[0].options.viewColumn, 1);
});

test('HTML reload queues navigation again and disposal removes the preview', async () => {
  const s = setup(), p = s.panel();
  await p.callbacks.message({ type: 'navigationReady' });
  s.navigation.loading(p.panel);
  const previous = p.sent.length;
  await s.commands['specc.showInPreview']();
  assert.equal(p.sent.length, previous);
  await p.callbacks.message({ type: 'navigationReady' });
  assert.equal(p.sent.at(-1).key, 'object:1');
  p.callbacks.dispose();
  await s.commands['specc.showInPreview']();
  assert.match(s.notices.at(-1), /Open an HTML or PDF preview/);
});
