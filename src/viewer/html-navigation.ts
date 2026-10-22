import { PreviewTarget } from '../previewTargets';
import { highlight, navigationControls, VsCodeApi } from './navigationControls';

export function install(api: VsCodeApi): void {
  let targets: PreviewTarget[] = [];
  let clicked: { key: string; element: HTMLElement } | undefined;
  let pending: string | undefined;

  function elements(): Array<{ target: PreviewTarget; element: HTMLElement }> {
    return targets.flatMap(target => {
      const section = document.getElementById('doc-' + target.spec);
      if (!section) return [];
      for (const anchor of target.anchors) {
        const element = section.querySelector<HTMLElement>('#' + CSS.escape(anchor));
        if (element) return [{ target, element }];
      }
      return target.kind === 'document' ? [{ target, element: section }] : [];
    });
  }

  function nearest(y: number, clickedElement?: Element): ReturnType<typeof elements>[number] | undefined {
    const available = elements().filter(({ element }) => element.getClientRects().length);
    const enclosing = clickedElement && available.find(({ target, element }) => target.kind !== 'document'
      && (element === clickedElement || element.contains(clickedElement)));
    if (enclosing) return enclosing;
    // The most recent heading/float above the point owns the following body text.
    const sorted = available.sort((a, b) => b.element.getBoundingClientRect().top - a.element.getBoundingClientRect().top);
    return sorted.find(({ element }) => element.getBoundingClientRect().top <= y + 2) ?? sorted.at(-1);
  }

  function showSource(): void {
    const content = document.querySelector('.content')?.getBoundingClientRect();
    const y = content ? (Math.max(0, content.top) + Math.min(innerHeight, content.bottom)) / 2 : innerHeight / 2;
    const choice = clicked ?? (() => {
      const hit = nearest(y);
      return hit && { key: hit.target.key, element: hit.element };
    })();
    if (choice) { highlight(choice.element); api.postMessage({ type: 'showSource', key: choice.key }); }
    else api.postMessage({ type: 'navigationMissing' });
  }

  function reveal(key: string): void {
    const hit = elements().find(e => e.target.key === key);
    if (!hit) { api.postMessage({ type: 'navigationMissing' }); return; }
    // Route only to the document; we handle scrolling so duplicate IDs in other documents are harmless.
    location.hash = '#/' + encodeURIComponent(hit.target.spec);
    setTimeout(() => {
      hit.element.scrollIntoView({ block: 'center' });
      highlight(hit.element);
    }, 100);
  }

  document.addEventListener('click', event => {
    const element = event.target instanceof Element ? event.target : undefined;
    if (!element?.closest('.doc-section')) return;
    const hit = nearest(event.clientY, element);
    clicked = hit && { key: hit.target.key, element: hit.element };
  });
  document.addEventListener('scroll', () => { clicked = undefined; }, true);
  window.addEventListener('hashchange', () => { clicked = undefined; });
  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg?.type === 'navigationTargets') {
      targets = msg.targets;
      if (pending) { reveal(pending); pending = undefined; }
    } else if (msg?.type === 'revealTarget') {
      if (targets.length) reveal(msg.key); else pending = msg.key;
    } else if (msg?.type === 'requestSource') showSource();
  });
  navigationControls(api, showSource);
  api.postMessage({ type: 'navigationReady' });
}
