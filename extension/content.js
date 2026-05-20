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

  function reportUrl() {
    const url = getPrUrl();
    chrome.runtime.sendMessage({ type: 'prUrlChanged', prUrl: url }).catch(() => {});
    if (url) prefetchDiff(url);
  }
  reportUrl();

  const prefetched = new Set();
  async function prefetchDiff(prUrl) {
    if (prefetched.has(prUrl)) return;
    prefetched.add(prUrl);
    try {
      const res = await fetch(`${prUrl}.diff`, { credentials: 'include' });
      if (!res.ok) return;
      const diff = await res.text();
      chrome.runtime.sendMessage({ type: 'cacheDiff', prUrl, diff }).catch(() => {});
    } catch {}
  }

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

  // ============ Review comment ghostwrite ============
  const BTN_MARKER = 'data-claude-ghost-btn';
  const TEXTAREA_SEL = 'textarea[name="comment[body]"], textarea.js-comment-field, textarea[aria-label*="comment" i]';
  // streamId -> textarea (for routing background streamChunk back)
  const ghostStreams = new Map();
  let nextGhostStreamId = 1;

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

  function buildGhostButton(textarea) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute(BTN_MARKER, '');
    btn.textContent = '✨ Claude';
    btn.title = 'Draft this review comment with Claude';
    Object.assign(btn.style, {
      marginLeft: '6px', padding: '3px 9px', fontSize: '11px', fontWeight: '500',
      lineHeight: '18px', verticalAlign: 'middle',
      background: 'linear-gradient(135deg, #5b5bd6 0%, #4f46e5 100%)', color: '#fff',
      border: '1px solid transparent', borderRadius: '6px', cursor: 'pointer',
      boxShadow: '0 1px 2px rgba(0,0,0,.08)',
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      runGhostwrite(textarea, btn);
    });
    return btn;
  }

  function attachButton(textarea) {
    if (textarea.dataset.claudeGhostWired) return;
    textarea.dataset.claudeGhostWired = '1';
    const btn = buildGhostButton(textarea);
    // Try to place next to the existing toolbar near the textarea, else above it.
    const toolbar = textarea.parentElement?.querySelector('.toolbar, [class*="toolbar"]');
    if (toolbar) {
      toolbar.appendChild(btn);
    } else {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin: 4px 0;';
      wrap.appendChild(btn);
      textarea.parentElement?.insertBefore(wrap, textarea);
    }
  }

  function runGhostwrite(textarea, btn) {
    const prUrl = getPrUrl();
    if (!prUrl) return;
    const file = findEnclosingFile(textarea) || null;
    const lines = lineNumberForTextarea(textarea);
    const code = lineCodeForTextarea(textarea);
    const userText = textarea.value.trim();

    const prompt = `[Reviewer's partial draft]:\n${userText || '(none)'}\n\nDraft or continue a constructive PR review comment for the hunk above. Be concise, specific, no preamble. Reply in Korean if the codebase comments are Korean, else English.`;

    const wasDisabled = textarea.disabled;
    textarea.disabled = true;
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = '✨ Drafting…';
    textarea.value = '';

    const streamId = nextGhostStreamId++;
    ghostStreams.set(streamId, {
      textarea, btn, wasDisabled, originalLabel, userText,
    });

    chrome.runtime.sendMessage({
      type: 'send',
      streamId,
      target: 'tab',
      prUrl: `${prUrl}#ghostwrite`,
      file, lines, code,
      question: prompt,
    }).catch((err) => {
      finalizeGhost(streamId, `(Send failed: ${err?.message || err})\n${userText}`);
    });
  }

  function finalizeGhost(streamId, errText) {
    const entry = ghostStreams.get(streamId);
    if (!entry) return;
    ghostStreams.delete(streamId);
    if (errText) entry.textarea.value = errText;
    entry.textarea.disabled = entry.wasDisabled;
    entry.btn.disabled = false;
    entry.btn.textContent = entry.originalLabel;
    entry.textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'streamChunk') return;
    const entry = ghostStreams.get(msg.streamId);
    if (!entry) return;
    if (msg.delta != null) entry.textarea.value += msg.delta;
    else if (msg.done) finalizeGhost(msg.streamId, null);
    else if (msg.error) finalizeGhost(msg.streamId, `(Claude error: ${msg.error})\n${entry.userText}`);
  });

  function scanForTextareas(root) {
    const nodes = root.querySelectorAll?.(TEXTAREA_SEL);
    if (!nodes) return;
    for (const t of nodes) attachButton(t);
  }

  scanForTextareas(document);
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.(TEXTAREA_SEL)) attachButton(node);
        scanForTextareas(node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
