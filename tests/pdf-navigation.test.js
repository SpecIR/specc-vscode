const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load');
const { indexPdf } = load('viewer/pdf-navigation.ts');

function document(overrides = {}) {
  return {
    numPages: 2,
    getDestinations: async () => ({}), getDestination: async () => null,
    getOutline: async () => [], getPageIndex: async ref => ref.num - 1,
    getPage: async () => ({
      getViewport: () => ({ height: 1000, convertToViewportPoint: (x, y) => [x, 1000 - y] }),
      getTextContent: async () => ({ items: [] }),
    }),
    ...overrides,
  };
}
const target = { key: 'object:1', kind: 'object', spec: 'a', anchors: ['REQ-1'], title: 'System behavior' };

test('PDF named destinations take precedence over repeated text', async () => {
  const doc = document({ getDestinations: async () => ({ 'REQ-1': [{ num: 2 }, { name: 'XYZ' }, 0, 800] }) });
  assert.deepEqual(await indexPdf(doc, [target], () => false), [{ key: target.key, page: 2, y: 0.2 }]);
});

test('PDF nested numbered outlines resolve string destinations', async () => {
  const doc = document({
    getOutline: async () => [{ title: 'Other', items: [{ title: '2.3 System behavior', dest: 'heading', items: [] }] }],
    getDestination: async name => name === 'heading' ? [0, { name: 'FitH' }, 700] : null,
  });
  assert.deepEqual(await indexPdf(doc, [target], () => false), [{ key: target.key, page: 1, y: 0.3 }]);
});

test('PDF text fallback finds split headings and ignores dotted TOC entries', async () => {
  const doc = document({ getPage: async page => ({
    getViewport: () => ({ height: 1000, convertToViewportPoint: (x, y) => [x, 1000 - y] }),
    getTextContent: async () => ({ items: page === 1
      ? [{ str: 'System behavior ........ 2', transform: [1, 0, 0, 1, 0, 900] }]
      : [{ str: 'System', transform: [1, 0, 0, 1, 0, 800] }, { str: 'behavior', transform: [1, 0, 0, 1, 0, 780] }] }),
  }) });
  assert.deepEqual(await indexPdf(doc, [target], () => false), [{ key: target.key, page: 2, y: 0.2 }]);
});

test('PDF indexing abandons stale generations and leaves unmatched entities unmapped', async () => {
  assert.deepEqual(await indexPdf(document(), [target], () => true), []);
  assert.deepEqual(await indexPdf(document(), [target], () => false), []);
});
