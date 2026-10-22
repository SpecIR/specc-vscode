const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load');

test('HTML navigation scopes duplicate anchors, supports clicks, and clears the click on scroll', () => {
  const events = {}, messages = [], timers = [];
  let active = 'a';
  class Element {
    constructor(id, spec, top = 0) {
      this.id = id; this.spec = spec; this.top = top; this.children = [];
      this.classList = { add: () => {}, remove: () => {} };
    }
    append(...children) { this.children.push(...children); }
    setAttribute() {}
    addEventListener() {}
    getClientRects() { return active === this.spec ? [{}] : []; }
    getBoundingClientRect() { return { top: this.top, bottom: this.top + 1000 }; }
    closest() { return this.spec ? sections[this.spec] : null; }
    contains(element) { return element === this; }
    scrollIntoView() { this.scrolled = true; }
    querySelector(selector) { return this.children.find(child => '#' + child.id === selector); }
  }
  const sections = { a: new Element('doc-a', 'a'), b: new Element('doc-b', 'b') };
  const headingA = new Element('shared', 'a', 100), headingB = new Element('shared', 'b', 100);
  const later = new Element('later', 'b', 300);
  sections.a.append(headingA); sections.b.append(headingB, later);
  const document = {
    head: new Element('head'), body: new Element('body'),
    createElement: tag => new Element(tag),
    getElementById: id => Object.values(sections).find(section => section.id === id),
    querySelectorAll: () => [],
    querySelector: () => ({ getBoundingClientRect: () => ({ top: 0, bottom: 800 }) }),
    addEventListener: (name, fn) => { events['document:' + name] = fn; },
  };
  const location = { set hash(value) { active = value.slice(2); }, get hash() { return '#/' + active; } };
  const { install } = load('viewer/html-navigation.ts', {}, {
    document, location, Element, innerHeight: 800, CSS: { escape: value => value },
    window: { addEventListener: (name, fn) => { events[name] = fn; } },
    setTimeout: fn => timers.push(fn),
  });
  install({ postMessage: msg => messages.push(msg) });
  const send = data => events.message({ data });
  send({ type: 'navigationTargets', targets: [
    { key: 'a', spec: 'a', anchors: ['shared'], kind: 'object' },
    { key: 'b', spec: 'b', anchors: ['shared'], kind: 'object' },
    { key: 'later', spec: 'b', anchors: ['later'], kind: 'object' },
  ] });
  send({ type: 'revealTarget', key: 'b' });
  while (timers.length) timers.shift()();
  assert.equal(active, 'b');
  assert.equal(headingB.scrolled, true);
  assert.equal(headingA.scrolled, undefined);

  events['document:click']({ target: headingB, clientY: 100 });
  send({ type: 'requestSource' });
  assert.equal(messages.at(-1).key, 'b');
  events['document:scroll']();
  send({ type: 'requestSource' });
  assert.equal(messages.at(-1).key, 'later'); // Center of viewport, not the earlier click.
  send({ type: 'revealTarget', key: 'unmapped' });
  assert.equal(messages.at(-1).type, 'navigationMissing');

  const bar = document.body.children[0];
  const buttons = bar.children[0].children;
  assert.equal(buttons[0].title, 'Show source cursor in preview');
  assert.equal(buttons[1].title, 'Show preview location in source');
  buttons[0].onclick({ detail: 0 });
  assert.equal(messages.at(-1).type, 'showPreview');
});
