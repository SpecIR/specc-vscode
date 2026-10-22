export interface VsCodeApi {
  postMessage(message: unknown): void;
}

/** A small edge handle reveals the controls without covering the document while reading. */
export function navigationControls(api: VsCodeApi, showSource: () => void): void {
  const style = document.createElement('style');
  style.textContent = `
    #specc-sync, #specc-sync * { box-sizing:border-box; }
    #specc-sync { position:fixed; left:0; top:50%; transform:translateY(-50%); z-index:10000;
      width:12px; height:92px; isolation:isolate; }
    #specc-sync::before { content:''; position:absolute; left:2px; top:50%; width:3px; height:28px;
      transform:translateY(-50%); border-radius:3px; background:var(--vscode-descriptionForeground,#777);
      opacity:.4; transition:opacity 140ms ease 220ms; }
    #specc-sync .specc-sync-tray { position:absolute; left:0; top:50%; display:flex; flex-direction:column;
      gap:2px; padding:4px; width:37px; border:1px solid var(--vscode-widget-border,#8884); border-left:0;
      border-radius:0 8px 8px 0; background:var(--vscode-editorWidget-background,#f3f3f3);
      box-shadow:2px 2px 8px #0002; transform:translate(-100%,-50%); opacity:0; pointer-events:none;
      transition:transform 160ms ease 220ms, opacity 120ms ease 220ms; }
    #specc-sync:hover::before, #specc-sync:focus-within::before { opacity:0; transition-delay:0ms; }
    #specc-sync:hover .specc-sync-tray, #specc-sync:focus-within .specc-sync-tray {
      transform:translate(0,-50%); opacity:1; pointer-events:auto; transition-delay:0ms; }
    #specc-sync button { all:unset; box-sizing:border-box; display:flex; align-items:center; justify-content:center;
      flex:none; width:28px; height:28px; border-radius:4px; cursor:pointer;
      color:var(--vscode-foreground,#444); transition:background 100ms ease; }
    #specc-sync button:hover { background:var(--vscode-toolbar-hoverBackground,#8882); }
    #specc-sync button:active { background:var(--vscode-toolbar-activeBackground,#8883); }
    #specc-sync button:focus-visible { outline:1px solid var(--vscode-focusBorder,#007acc); outline-offset:-1px; }
    #specc-sync svg { display:block; width:16px; height:16px; fill:none; stroke:currentColor;
      stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; pointer-events:none; }
    @media (prefers-reduced-motion:reduce) {
      #specc-sync::before, #specc-sync .specc-sync-tray, #specc-sync button { transition:none; }
    }
    .specc-sync-highlight { outline:3px solid var(--vscode-focusBorder,#007acc) !important; outline-offset:3px; }
  `;
  document.head.append(style);
  const bar = document.createElement('div');
  bar.id = 'specc-sync';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Source and preview navigation');
  const tray = document.createElement('div');
  tray.className = 'specc-sync-tray';
  for (const [arrowPath, label, action] of [
    ['M3 8h10M9 4l4 4-4 4', 'Show source cursor in preview', () => api.postMessage({ type: 'showPreview' })],
    ['M13 8H3m4-4L3 8l4 4', 'Show preview location in source', showSource],
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${arrowPath}"/></svg>`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.onclick = event => {
      action();
      // Mouse clicks should not pin the tray open via :focus-within. Keyboard focus stays visible.
      if (event.detail > 0) button.blur();
    };
    tray.append(button);
  }
  bar.append(tray);
  bar.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      (document.activeElement as HTMLElement | null)?.blur();
      event.stopPropagation();
    }
  });
  document.body.append(bar);
}

export function highlight(element: HTMLElement): void {
  document.querySelectorAll('.specc-sync-highlight').forEach(el => el.classList.remove('specc-sync-highlight'));
  element.classList.add('specc-sync-highlight');
  setTimeout(() => element.classList.remove('specc-sync-highlight'), 1600);
}
