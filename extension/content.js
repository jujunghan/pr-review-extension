// Runs in GitHub PR pages. Captures user text selection within diff files
// and forwards a payload to the background script. Also reports PR URL
// changes (handles SPA navigation via History API).

(() => {
  const SEND_DEBOUNCE_MS = 200;
  let lastSent = '';

  function getPrUrl() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) return null;
    return `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`;
  }

  function findEnclosingFile(node) {
    while (node && node.nodeType === 1) {
      if (node.matches?.('.file[data-tagsearch-path], [data-tagsearch-path]')) {
        return node.getAttribute('data-tagsearch-path');
      }
      node = node.parentElement;
    }
    return null;
  }

  function findLineRange(range) {
    const start = lineNumberFor(range.startContainer);
    const end = lineNumberFor(range.endContainer);
    if (start && end) return start === end ? `${start}` : `${start}-${end}`;
    if (start) return `${start}`;
    return null;
  }

  function lineNumberFor(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el) {
      const tr = el.closest?.('tr');
      if (tr) {
        const cells = tr.querySelectorAll('[data-line-number]');
        for (const c of cells) {
          const n = c.getAttribute('data-line-number');
          if (n) return n;
        }
        const td = tr.querySelector('td.blob-num');
        if (td?.getAttribute('data-line-number')) return td.getAttribute('data-line-number');
      }
      el = el.parentElement;
    }
    return null;
  }

  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const range = sel.getRangeAt(0);
    const file = findEnclosingFile(range.commonAncestorContainer) || null;
    const lines = findLineRange(range) || null;
    return { text, file, lines };
  }

  let timer = null;
  document.addEventListener('selectionchange', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const cap = captureSelection();
      if (!cap) return;
      const key = `${cap.file}|${cap.lines}|${cap.text}`;
      if (key === lastSent) return;
      lastSent = key;
      chrome.runtime.sendMessage({
        type: 'selectionChanged',
        prUrl: getPrUrl(),
        ...cap,
      }).catch(() => {});
    }, SEND_DEBOUNCE_MS);
  });

  function reportUrl() {
    chrome.runtime.sendMessage({ type: 'prUrlChanged', prUrl: getPrUrl() }).catch(() => {});
  }
  reportUrl();

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) { origPush.apply(this, args); reportUrl(); };
  history.replaceState = function (...args) { origReplace.apply(this, args); reportUrl(); };
  window.addEventListener('popstate', reportUrl);
})();
