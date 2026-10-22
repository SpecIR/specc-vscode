const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./load');
const { targetAtLine } = load('previewTargets.ts');
const { SpecDb } = load('specdb.ts');

test('source selection respects files, ranges, and gaps', () => {
  const root = { key: 'root', kind: 'document', file: '/a.md', line: 1, endLine: null };
  const first = { key: 'first', kind: 'object', file: '/a.md', line: 10, endLine: 20 };
  const second = { key: 'second', kind: 'object', file: '/a.md', line: 20, endLine: 30 };
  const targets = [root, first, second, { ...second, file: '/b.md', line: 15 }];
  assert.equal(targetAtLine(targets, '/a.md', 5), root);
  assert.equal(targetAtLine(targets, '/a.md', 19), first);
  assert.equal(targetAtLine(targets, '/a.md', 20), second);
  assert.equal(targetAtLine(targets, '/a.md', 50), second);
  assert.equal(targetAtLine(targets, '/missing.md', 5), undefined);
  assert.equal(targetAtLine([first], '/a.md', 1), first);
});

test('database targets preserve spec scope, include paths, float anchors and reload after build', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specc-navigation-'));
  const project = { rootDir: dir, outputDir: path.join(dir, 'build') };
  fs.mkdirSync(project.outputDir);
  const SQL = await require('sql.js')();
  const fixture = new SQL.Database();
  // Relevant columns from SpecCompiler's content schema, kept local for standalone extension tests.
  fixture.run(`CREATE TABLE specifications(identifier TEXT, root_path TEXT, long_name TEXT, pid TEXT);
    CREATE TABLE spec_objects(id INTEGER, specification_ref TEXT, type_ref TEXT, from_file TEXT,
      file_seq INTEGER, pid TEXT, title_text TEXT, label TEXT, start_line INTEGER, end_line INTEGER);
    CREATE TABLE spec_floats(id INTEGER, specification_ref TEXT, type_ref TEXT, from_file TEXT,
      file_seq INTEGER, start_line INTEGER, label TEXT, anchor TEXT, caption TEXT);`);
  fixture.run(`INSERT INTO specifications(identifier,root_path,long_name,pid) VALUES
    ('a','a.md','Document A','A'), ('b','/absolute/b.md','Document B','B');
    INSERT INTO spec_objects(id,specification_ref,type_ref,from_file,file_seq,pid,title_text,label,start_line,end_line)
    VALUES (1,'a','SECTION','includes/part.md',0,'SHARED','Heading','section:heading',10,20),
           (2,'b','SECTION','/absolute/b.md',0,'SHARED','Heading B','section:heading',30,40),
           (3,'a','SECTION','a.md',1,'UNKNOWN','Unknown',NULL,0,NULL);
    INSERT INTO spec_floats(id,specification_ref,type_ref,from_file,file_seq,start_line,label,anchor,caption)
    VALUES (1,'a','FIGURE','includes/part.md',0,14,'fig:plot','SHARED-fig:plot','Plot');`);
  const file = path.join(project.outputDir, 'specir.db');
  const write = () => fs.writeFileSync(file, fixture.export());
  write();
  fs.mkdirSync(path.join(dir, 'media'));
  for (const file of ['sql-wasm.js', 'sql-wasm.wasm']) {
    fs.copyFileSync(require.resolve('sql.js/dist/' + file), path.join(dir, 'media', file));
  }
  const db = new SpecDb(dir);
  try {
    const targets = await db.previewTargets(project);
    assert.equal(targets.length, 5);
    assert.deepEqual(targets.find(t => t.key === 'object:1'), {
      key: 'object:1', kind: 'object', spec: 'a', file: path.join(dir, 'includes/part.md'),
      line: 10, endLine: 20, anchors: ['SHARED', 'section:heading'], title: 'Heading',
    });
    assert.equal(targets.find(t => t.key === 'document:b').file, '/absolute/b.md');
    assert.deepEqual(targets.find(t => t.key === 'float:1').anchors, ['SHARED-fig:plot', 'fig:plot']);
    assert.equal(targetAtLine(targets, path.join(dir, 'includes/part.md'), 15).key, 'float:1');
    fixture.run('UPDATE spec_objects SET start_line = 12 WHERE id = 1');
    write();
    const future = new Date(Date.now() + 2000);
    fs.utimesSync(file, future, future);
    assert.equal((await db.previewTargets(project)).find(t => t.key === 'object:1').line, 12);
  } finally {
    db.dispose(); fixture.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing build database returns no locations', async () => {
  const db = new SpecDb(path.join(__dirname, '..'));
  assert.deepEqual(await db.previewTargets({ outputDir: '/nonexistent/specc-test' }), []);
  db.dispose();
});
