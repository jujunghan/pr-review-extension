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

  // ============ Review comment ghostwrite ============
  const BRIDGE = 'http://localhost:8765';
  const BTN_MARKER = 'data-claude-ghost-btn';
  const TEXTAREA_SEL = 'textarea[name="comment[body]"], textarea.js-comment-field, textarea[aria-label*="comment" i]';

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

  async function runGhostwrite(textarea, btn) {
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
    const startValue = '';
    textarea.value = startValue;

    try {
      const res = await fetch(`${BRIDGE}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prUrl: `${prUrl}#ghostwrite`,
          file, lines, code,
          question: prompt,
        }),
      });
      if (!res.ok || !res.body) {
        textarea.value = `(Claude bridge error: ${res.status})\n${userText}`;
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          handleChunk(chunk, textarea);
        }
      }
    } catch (err) {
      textarea.value = `(Bridge offline — start with: npm run bridge:start)\n${userText}`;
    } finally {
      textarea.disabled = wasDisabled;
      btn.disabled = false;
      btn.textContent = originalLabel;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function handleChunk(chunk, textarea) {
    let event = 'message', data = '';
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (event === 'delta') {
      let text = data;
      try { text = JSON.parse(data); } catch {}
      textarea.value += text;
    }
  }

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
