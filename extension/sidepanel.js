const BRIDGE = 'http://localhost:8765';
const $ = (sel) => document.querySelector(sel);

let currentPrUrl = null;
let currentSelection = null;
let currentAssistantEl = null;

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
  });

  const input = $('#input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

  try {
    const res = await fetch(`${BRIDGE}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      setStatus(`Bridge error (${res.status}): ${text}`, { error: true });
      finishAssistantMessage();
      return;
    }
    await consumeSse(res.body);
    setStatus('');
  } catch (err) {
    setStatus(`Bridge offline. Start it with: npm run bridge:start`, { error: true });
  } finally {
    finishAssistantMessage();
  }
}

async function consumeSse(body) {
  const reader = body.getReader();
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
      handleSseChunk(chunk);
    }
  }
}

function handleSseChunk(chunk) {
  let event = 'message';
  let data = '';
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (event === 'delta') {
    let text = data;
    try { text = JSON.parse(data); } catch {}
    appendAssistantDelta(text);
  } else if (event === 'done') {
    finishAssistantMessage();
  } else if (event === 'error') {
    let err = { message: data };
    try { err = JSON.parse(data); } catch {}
    setStatus(`Claude error: ${err.message}`, { error: true });
  }
}
