const $ = (sel) => document.querySelector(sel);

let currentPrUrl = null;
let currentSelection = null;
let currentAssistantEl = null;
let activeStreamId = null;
let nextStreamId = 1;

// Paste collapse: long paste payloads are folded into [Pasted text #N — L lines]
// placeholders in the textarea, and expanded back on send.
const PASTE_LINE_THRESHOLD = 10;
const PASTE_CHAR_THRESHOLD = 400;
const PASTE_PLACEHOLDER_RE = /\[Pasted text #(\d+) — \d+ lines\]/g;
const pasteRegistry = new Map();
let pasteCounter = 0;

init();

async function init() {
  const state = await chrome.runtime.sendMessage({ type: 'getState' });
  setPrUrl(state?.prUrl || null);
  if (state?.prUrl) {
    const ds = await chrome.runtime.sendMessage({ type: 'getDiffStatus', prUrl: state.prUrl });
    renderDiffStatus(ds?.status);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'prUrlChanged') {
      const changed = currentPrUrl !== msg.prUrl;
      setPrUrl(msg.prUrl);
      if (changed) clearHistoryUI();
    }
    if (msg.type === 'selectionChanged') {
      currentSelection = { file: msg.file, lines: msg.lines, text: msg.text };
      renderContextPreview();
    }
    if (msg.type === 'focusInput') {
      $('#input').focus();
    }
    if (msg.type === 'diffStatus') {
      renderDiffStatus(msg.status);
    }
    if (msg.type === 'streamChunk') {
      console.log('[PR Review SP] streamChunk', 'streamId=', msg.streamId, 'active=', activeStreamId, 'delta?', !!msg.delta, 'done?', !!msg.done, 'error?', !!msg.error);
    }
    if (msg.type === 'streamChunk' && msg.streamId === activeStreamId) {
      if (msg.delta != null) appendAssistantDelta(msg.delta);
      else if (msg.done) {
        finishAssistantMessage();
        setStatus('');
        activeStreamId = null;
      } else if (msg.error) {
        setStatus(`Claude error: ${msg.error}`, { error: true });
        finishAssistantMessage();
        activeStreamId = null;
      }
    }
  });

  const input = $('#input');
  input.addEventListener('keydown', (e) => {
    // e.isComposing covers the IME confirm Enter (Korean/Japanese/Chinese)
    // that would otherwise trigger send() multiple times for a single
    // user Enter press. keyCode 229 is the legacy IME signal.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('paste', handlePaste);
  input.addEventListener('input', resetPasteRegistryIfEmpty);

  $('#clear-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'clearContext' });
    clearHistoryUI();
    setStatus('Context cleared.');
  });

  $('#context-dismiss').addEventListener('click', () => {
    currentSelection = null;
    renderContextPreview();
  });
}

function setPrUrl(url) {
  currentPrUrl = url;
  const label = $('#pr-label');
  label.textContent = url ? prShortLabel(url) : 'No PR detected';
  label.classList.toggle('has-pr', !!url);
}

function renderDiffStatus(status) {
  let el = document.getElementById('diff-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'diff-status';
    el.className = 'diff-status';
    document.getElementById('header').insertAdjacentElement('afterend', el);
  }
  if (!status) {
    el.textContent = 'Loading PR diff…';
    el.dataset.state = 'loading';
    return;
  }
  if (status.skipped === 'too-large') {
    el.textContent = `PR too large to auto-attach (${status.lines.toLocaleString()} lines / ${(status.bytes / 1024).toFixed(0)} KB). Select specific hunks to ask about.`;
    el.dataset.state = 'warn';
    return;
  }
  if (status.ready) {
    el.textContent = `PR diff loaded — ${status.lines.toLocaleString()} lines (${(status.bytes / 1024).toFixed(0)} KB) ready as context`;
    el.dataset.state = 'ok';
  }
}

function prShortLabel(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return m ? `${m[1]}/${m[2]}#${m[3]}` : url;
}

function renderContextPreview() {
  const el = $('#context-preview');
  if (!currentSelection) { el.hidden = true; return; }
  const { file, lines, text } = currentSelection;
  const header = file ? `${file}${lines ? `:${lines}` : ''}` : 'selection';
  $('#context-header-text').textContent = header;
  $('#context-body').textContent = `${text.slice(0, 400)}${text.length > 400 ? '…' : ''}`;
  el.hidden = false;
}

function hideEmptyState() {
  const es = $('#empty-state');
  if (es) es.remove();
}

function appendUserMessage(text) {
  hideEmptyState();
  const div = document.createElement('div');
  div.className = 'msg user';
  div.innerHTML = renderWithPasteRefs(text);
  $('#history').appendChild(div);
  scrollHistory();
}

function renderWithPasteRefs(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/\[Pasted text #(\d+) — (\d+) lines\]/g,
    (_, n, lines) => `<span class="paste-ref" title="${lines} lines pasted">[Pasted text #${n} — ${lines} lines]</span>`);
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function startAssistantMessage() {
  hideEmptyState();
  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.textContent = '';
  $('#history').appendChild(div);
  currentAssistantEl = div;
  scrollHistory();
}

function appendAssistantDelta(text) {
  if (!currentAssistantEl) startAssistantMessage();
  currentAssistantEl.textContent += text;
  scrollHistory();
}

function finishAssistantMessage() {
  currentAssistantEl = null;
}

function scrollHistory() {
  const h = $('#history');
  h.scrollTop = h.scrollHeight;
}

function clearHistoryUI() {
  const h = $('#history');
  h.innerHTML = '';
  currentAssistantEl = null;
  renderEmptyState();
}

function renderEmptyState() {
  const h = $('#history');
  const tpl = `<div id="empty-state" class="empty-state">
    <div class="empty-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="36" height="36">
        <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
          d="M4 6h16M4 12h10M4 18h7M16 14l3 3-3 3M16 14v6" />
      </svg>
    </div>
    <p class="empty-title">Ask Claude about this PR</p>
    <ol class="empty-steps">
      <li>Open a GitHub PR diff page</li>
      <li>Select a hunk in the diff</li>
      <li>Ask your question below</li>
    </ol>
  </div>`;
  h.insertAdjacentHTML('beforeend', tpl);
}

function handlePaste(e) {
  const text = e.clipboardData?.getData('text');
  if (!text) return;
  const lineCount = text.split('\n').length;
  if (lineCount < PASTE_LINE_THRESHOLD && text.length < PASTE_CHAR_THRESHOLD) return;

  e.preventDefault();
  pasteCounter += 1;
  const id = pasteCounter;
  pasteRegistry.set(id, text);
  const placeholder = `[Pasted text #${id} — ${lineCount} lines]`;
  insertAtCursor(e.target, placeholder);
}

function insertAtCursor(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = `${before}${text}${after}`;
  const pos = start + text.length;
  textarea.selectionStart = textarea.selectionEnd = pos;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function resetPasteRegistryIfEmpty(e) {
  if (e.target.value === '') {
    pasteRegistry.clear();
    pasteCounter = 0;
  }
}

function expandPastes(text) {
  return text.replace(PASTE_PLACEHOLDER_RE, (match, idStr) => {
    const original = pasteRegistry.get(Number(idStr));
    return original ?? match;
  });
}

function setStatus(text, opts = {}) {
  const s = $('#status');
  s.textContent = text || '';
  s.classList.toggle('error', !!opts.error);
  s.classList.toggle('thinking', !!opts.thinking);
}

async function send() {
  const rawQuestion = $('#input').value.trim();
  if (!rawQuestion) return;
  if (!currentPrUrl) { setStatus('Open a GitHub PR page first.', { error: true }); return; }
  if (currentSelection && currentSelection.text.split('\n').length > 500) {
    const ok = confirm(`Selection is ${currentSelection.text.split('\n').length} lines. Send anyway?`);
    if (!ok) { setStatus('Cancelled.'); return; }
  }

  const userText = currentSelection
    ? `[${currentSelection.file || 'selection'}${currentSelection.lines ? `:${currentSelection.lines}` : ''}]\n\n${rawQuestion}`
    : rawQuestion;
  appendUserMessage(userText);
  $('#input').value = '';
  setStatus('Thinking…', { thinking: true });
  startAssistantMessage();

  const expandedQuestion = expandPastes(rawQuestion);
  pasteRegistry.clear();
  pasteCounter = 0;

  const payload = {
    prUrl: currentPrUrl,
    file: currentSelection?.file,
    lines: currentSelection?.lines,
    code: currentSelection?.text,
    question: expandedQuestion,
  };
  // Reset selection after attaching once
  currentSelection = null;
  renderContextPreview();

  activeStreamId = nextStreamId++;
  console.log('[PR Review SP] send', 'streamId=', activeStreamId, 'prUrl=', payload.prUrl, 'q.len=', payload.question?.length);
  chrome.runtime.sendMessage({
    type: 'send',
    streamId: activeStreamId,
    ...payload,
  }).catch((err) => {
    setStatus(`Send failed: ${err?.message || err}`, { error: true });
    finishAssistantMessage();
    activeStreamId = null;
  });
}
