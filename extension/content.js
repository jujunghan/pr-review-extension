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
      if (!cap) {
        hideFloatingAction();
        return;
      }
      const key = `${cap.file}|${cap.lines}|${cap.text}`;
      if (key !== lastSent) {
        lastSent = key;
        chrome.runtime.sendMessage({
          type: 'selectionChanged',
          prUrl: getPrUrl(),
          ...cap,
        }).catch(() => {});
      }
      showFloatingAction(cap);
    }, SEND_DEBOUNCE_MS);
  });

  const prefetched = new Set();
  function prefetchDiff(prUrl) {
    if (prefetched.has(prUrl)) return;
    prefetched.add(prUrl);
    // The .diff URL redirects to patch-diff.githubusercontent.com, which the
    // page-world fetch cannot cross-origin to. Hand it off to the background,
    // which has host_permissions for both origins and is CORS-immune.
    chrome.runtime.sendMessage({ type: 'prefetchDiff', prUrl }).catch((err) => {
      console.warn('[PR Review] prefetchDiff dispatch failed:', err?.message || err);
      prefetched.delete(prUrl);
    });
  }

  function reportUrl() {
    const url = getPrUrl();
    chrome.runtime.sendMessage({ type: 'prUrlChanged', prUrl: url }).catch(() => {});
    if (url) prefetchDiff(url);
  }
  reportUrl();

  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (...args) { origPush.apply(this, args); reportUrl(); };
  history.replaceState = function (...args) { origReplace.apply(this, args); reportUrl(); };
  window.addEventListener('popstate', reportUrl);

  // ============ Floating action on selection (A1) ============
  let floatingBtn = null;
  let lastSelectionForAction = null;

  function ensureFloatingBtn() {
    if (floatingBtn) return floatingBtn;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Ask Claude about selection');
    btn.title = 'Ask Claude about this selection';
    btn.textContent = '✨';
    Object.assign(btn.style, {
      position: 'absolute',
      width: '28px',
      height: '28px',
      padding: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #5b5bd6 0%, #4f46e5 100%)',
      color: '#fff',
      border: '1px solid rgba(0,0,0,0.08)',
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '14px',
      lineHeight: '1',
      boxShadow: '0 2px 8px rgba(79, 70, 229, 0.35)',
      zIndex: '2147483646',
      userSelect: 'none',
      transition: 'transform 100ms ease, opacity 100ms ease',
    });
    btn.addEventListener('mousedown', (e) => {
      // Prevent click from collapsing the active selection
      e.preventDefault();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onFloatingClick();
    });
    document.documentElement.appendChild(btn);
    floatingBtn = btn;
    return btn;
  }

  function showFloatingAction(cap) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!cap.file) return; // Only show inside diff files
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    const btn = ensureFloatingBtn();
    const margin = 8;
    let left = rect.right + window.scrollX + margin;
    let top = rect.top + window.scrollY - 4;
    // Clamp to viewport horizontally — fall back to left side if too tight
    const vpRight = window.scrollX + document.documentElement.clientWidth;
    if (left + 28 + margin > vpRight) {
      left = Math.max(window.scrollX + margin, rect.left + window.scrollX - 28 - margin);
    }
    btn.style.display = 'inline-flex';
    btn.style.left = `${Math.max(0, left)}px`;
    btn.style.top = `${Math.max(0, top)}px`;
    lastSelectionForAction = cap;
  }

  function hideFloatingAction() {
    if (floatingBtn) floatingBtn.style.display = 'none';
    lastSelectionForAction = null;
  }

  function onFloatingClick() {
    if (!lastSelectionForAction) return;
    chrome.runtime.sendMessage({
      type: 'openSidePanelWithSelection',
      prUrl: getPrUrl(),
      ...lastSelectionForAction,
    }).catch(() => {});
    hideFloatingAction();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideFloatingAction();
  });
  document.addEventListener('mousedown', (e) => {
    if (floatingBtn && e.target !== floatingBtn) {
      // Hide on outside click; selectionchange will re-show if a new selection is made
      hideFloatingAction();
    }
  }, true);
  window.addEventListener('scroll', () => {
    if (lastSelectionForAction) showFloatingAction(lastSelectionForAction);
  }, true);

  // ============ Review-line shortcut to side panel ============
  // When GitHub's per-line review comment textarea appears (the dialog that
  // pops up from the '+' button on a diff line), put a small floating
  // 'Ask in panel' button next to it. Clicking it does NOT write anything
  // into GitHub's textarea — it just copies the line's hunk context into
  // the side panel input so the user can type a question there.
  const BTN_MARKER = 'data-claude-line-btn';
  const TEXTAREA_SEL = [
    'textarea[name="comment[body]"]',
    'textarea.js-comment-field',
    'textarea[aria-label*="comment" i]',
    'textarea[placeholder*="comment" i]',
    'textarea[placeholder*="reply" i]',
    'textarea[placeholder*="review" i]',
  ].join(', ');

  function lineNumberForTextarea(textarea) {
    let el = textarea.closest('tr, .js-line-comments, [data-line-number]');
    while (el) {
      if (el.matches?.('[data-line-number]')) {
        return el.getAttribute('data-line-number');
      }
      const cell = el.querySelector?.('[data-line-number]');
      if (cell) return cell.getAttribute('data-line-number');
      el = el.previousElementSibling || el.parentElement;
      if (el && el.matches?.('.file, [data-tagsearch-path]')) break;
    }
    return null;
  }

  function lineCodeForTextarea(textarea) {
    const tr = textarea.closest('tr');
    if (!tr) return null;
    let prev = tr.previousElementSibling;
    while (prev) {
      const codeCell = prev.querySelector('.blob-code, td.blob-code-inner, [class*="blob-code"]');
      if (codeCell) return codeCell.textContent;
      prev = prev.previousElementSibling;
    }
    return null;
  }

  // Single shared floating button — position is updated to track whichever
  // textarea has focus. Survives React re-renders that would otherwise
  // strip an inline-injected button.
  let ghostFloater = null;
  let ghostFloaterTarget = null;

  function buildGhostFloater() {
    if (ghostFloater) return ghostFloater;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(BTN_MARKER, '');
    btn.textContent = '✨ Ask in panel';
    btn.title = 'Send this line to the Claude side panel';
    Object.assign(btn.style, {
      position: 'absolute',
      zIndex: '2147483645',
      padding: '4px 10px',
      fontSize: '11.5px',
      fontWeight: '500',
      lineHeight: '1.5',
      background: 'linear-gradient(135deg, #5b5bd6 0%, #4f46e5 100%)',
      color: '#fff',
      border: '1px solid rgba(0,0,0,.08)',
      borderRadius: '6px',
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(79, 70, 229, 0.3)',
      display: 'none',
      userSelect: 'none',
      transition: 'opacity 100ms ease',
    });
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (ghostFloaterTarget) sendLineToSidePanel(ghostFloaterTarget);
    });
    document.documentElement.appendChild(btn);
    ghostFloater = btn;
    return btn;
  }

  function showGhostFloaterFor(textarea) {
    const btn = buildGhostFloater();
    const rect = textarea.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      btn.style.display = 'none';
      ghostFloaterTarget = null;
      return;
    }
    const offsetTop = rect.top + window.scrollY - 30;
    const offsetLeft = rect.right + window.scrollX - 110;
    btn.style.display = 'inline-flex';
    btn.style.top = `${Math.max(0, offsetTop)}px`;
    btn.style.left = `${Math.max(0, offsetLeft)}px`;
    ghostFloaterTarget = textarea;
  }

  function hideGhostFloater() {
    if (ghostFloater) ghostFloater.style.display = 'none';
    ghostFloaterTarget = null;
  }

  function wireTextarea(textarea) {
    if (textarea.dataset.claudeGhostWired) return;
    textarea.dataset.claudeGhostWired = '1';
    textarea.addEventListener('focus', () => showGhostFloaterFor(textarea));
    textarea.addEventListener('blur', () => {
      // Defer so the click on the floater can fire first
      setTimeout(() => {
        if (document.activeElement !== ghostFloater) hideGhostFloater();
      }, 200);
    });
    // Show immediately if the textarea is already focused at wire time
    if (document.activeElement === textarea) showGhostFloaterFor(textarea);
  }

  window.addEventListener('scroll', () => {
    if (ghostFloaterTarget && ghostFloater?.style.display !== 'none') {
      showGhostFloaterFor(ghostFloaterTarget);
    }
  }, true);
  window.addEventListener('resize', () => {
    if (ghostFloaterTarget && ghostFloater?.style.display !== 'none') {
      showGhostFloaterFor(ghostFloaterTarget);
    }
  });

  function sendLineToSidePanel(textarea) {
    const prUrl = getPrUrl();
    if (!prUrl) return;
    const file = findEnclosingFile(textarea) || null;
    const lines = lineNumberForTextarea(textarea);
    const code = lineCodeForTextarea(textarea);
    chrome.runtime.sendMessage({
      type: 'openSidePanelWithSelection',
      prUrl,
      file,
      lines,
      text: code || (file && lines ? `(line ${lines} of ${file})` : '(line context)'),
    }).catch(() => {});
    hideGhostFloater();
  }

  function scanForTextareas(root) {
    const nodes = root.querySelectorAll?.(TEXTAREA_SEL);
    if (!nodes) return;
    for (const t of nodes) wireTextarea(t);
  }

  scanForTextareas(document);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.(TEXTAREA_SEL)) wireTextarea(node);
        scanForTextareas(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
