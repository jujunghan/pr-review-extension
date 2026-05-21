import { marked } from './lib/marked.esm.js';

marked.use({
  gfm: true,
  breaks: true,
  // marked v15+ escapes HTML by default; no extra sanitizer needed
  // for this use case (output is rendered, not stored, and the
  // source is the user's own claude session running locally).
});

const $ = (sel) => document.querySelector(sel);

let currentPrUrl = null;
let currentSelection = null;
let nextStreamId = 1;
// Pasted images attached to the next send. Cleared after send dispatches.
// Each entry: { dataUrl, mimeType, name }
const pendingImages = [];
// streamId → assistant bubble element. Each send gets its own bubble so the
// user can ask follow-ups before the previous answer finishes streaming
// without freezing the older bubble in thinking state.
const activeStreams = new Map();

// Paste collapse: long paste payloads are folded into [Pasted text #N — L lines]
// placeholders in the textarea, and expanded back on send.
const PASTE_LINE_THRESHOLD = 10;
const PASTE_CHAR_THRESHOLD = 400;
const PASTE_PLACEHOLDER_RE = /\[Pasted text #(\d+) — \d+ lines\]/g;
const pasteRegistry = new Map();
let pasteCounter = 0;

const FIRST_RUN_KEY = 'firstRunBannerDismissed';

function showOnboarding(extId) {
  const onboarding = document.getElementById('onboarding');
  const emptyState = document.getElementById('empty-state');
  if (!onboarding) return;
  onboarding.hidden = false;
  if (emptyState) emptyState.hidden = true;
  renderOnboardingSnippets(extId);
}

function hideOnboarding() {
  const onboarding = document.getElementById('onboarding');
  const emptyState = document.getElementById('empty-state');
  if (onboarding) onboarding.hidden = true;
  if (emptyState) emptyState.hidden = false;
}

function renderOnboardingSnippets(extId) {
  const displayId = extId || '<your extension id from chrome://extensions>';
  const claudePrompt = [
    'Install the pr-review-extension native host for me.',
    '',
    'Steps:',
    '1. git clone https://github.com/jujunghan/pr-review-extension ~/pr-review-extension  (skip if already cloned)',
    '2. cd ~/pr-review-extension && npm install',
    `3. npm run install-host -- --ext-id ${displayId}`,
    '4. Tell me to reload the PR Review extension in chrome://extensions when you\'re done.',
  ].join('\n');

  const shellSnippet = [
    'git clone https://github.com/jujunghan/pr-review-extension ~/pr-review-extension',
    'cd ~/pr-review-extension && npm install',
    `npm run install-host -- --ext-id ${displayId}`,
  ].join('\n');

  document.getElementById('claude-prompt').textContent = claudePrompt;
  document.getElementById('shell-snippet').textContent = shellSnippet;
}

function wireOnboardingControls() {
  const tabClaude = document.getElementById('tab-claude');
  const tabShell = document.getElementById('tab-shell');
  const panelClaude = document.getElementById('panel-claude');
  const panelShell = document.getElementById('panel-shell');

  function selectTab(which) {
    const claudeActive = which === 'claude';
    tabClaude.classList.toggle('is-active', claudeActive);
    tabShell.classList.toggle('is-active', !claudeActive);
    tabClaude.setAttribute('aria-selected', claudeActive ? 'true' : 'false');
    tabShell.setAttribute('aria-selected', !claudeActive ? 'true' : 'false');
    panelClaude.hidden = !claudeActive;
    panelShell.hidden = claudeActive;
  }
  tabClaude.addEventListener('click', () => selectTab('claude'));
  tabShell.addEventListener('click', () => selectTab('shell'));

  document.getElementById('copy-claude').addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById('claude-prompt').textContent);
    flashRetryStatus('Copied prompt');
  });
  document.getElementById('copy-shell').addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById('shell-snippet').textContent);
    flashRetryStatus('Copied commands');
  });

  document.getElementById('retry-host').addEventListener('click', () => {
    startRetryPoll();
  });
}

function flashRetryStatus(text) {
  const el = document.getElementById('retry-status');
  if (!el) return;
  el.textContent = text;
  clearTimeout(flashRetryStatus._t);
  flashRetryStatus._t = setTimeout(() => { el.textContent = ''; }, 4000);
}

const RETRY_POLL_MAX = 6;
const RETRY_POLL_INTERVAL_MS = 3000;
let retryPollTimer = null;
let retryPollCount = 0;

function stopRetryPoll() {
  if (retryPollTimer) {
    clearTimeout(retryPollTimer);
    retryPollTimer = null;
  }
}

function startRetryPoll() {
  stopRetryPoll();
  retryPollCount = 0;
  pollHostOnce();
}

async function pollHostOnce() {
  retryPollCount += 1;
  flashRetryStatus(`Checking… (${retryPollCount}/${RETRY_POLL_MAX})`);
  const res = await chrome.runtime.sendMessage({ type: 'getHostStatus' });
  if (res?.status === 'ready') {
    stopRetryPoll();
    hideOnboarding();
    flashRetryStatus('Connected');
    return;
  }
  if (retryPollCount >= RETRY_POLL_MAX) {
    stopRetryPoll();
    flashRetryStatus('Still missing. Did you run all install steps and reload the extension in chrome://extensions?');
    return;
  }
  retryPollTimer = setTimeout(pollHostOnce, RETRY_POLL_INTERVAL_MS);
}

async function maybeShowFirstRunBanner() {
  const store = await chrome.storage.local.get(FIRST_RUN_KEY);
  if (store[FIRST_RUN_KEY]) return;
  const banner = document.getElementById('first-run-banner');
  if (!banner) return;
  banner.hidden = false;
  document.getElementById('banner-dismiss').addEventListener('click', async () => {
    banner.hidden = true;
    await chrome.storage.local.set({ [FIRST_RUN_KEY]: true });
  });
}

function refreshStopButton() {
  const btn = document.getElementById('stop-btn');
  if (!btn) return;
  btn.hidden = activeStreams.size === 0;
}

init();

async function init() {
  wireOnboardingControls();

  document.getElementById('stop-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'cancelAllStreams' });
    // Don't force-finalize the bubbles here — the host will send an
    // 'error' for each cancelled stream, and the existing streamChunk
    // error path will finalize them and reset the status line.
  });

  const hostRes = await chrome.runtime.sendMessage({ type: 'getHostStatus' });
  if (hostRes?.status !== 'ready') {
    showOnboarding(chrome.runtime.id);
  } else {
    await maybeShowFirstRunBanner();
  }

  const state = await chrome.runtime.sendMessage({ type: 'getState' });
  setPrUrl(state?.prUrl || null);
  if (state?.prUrl) {
    const ds = await chrome.runtime.sendMessage({ type: 'getDiffStatus', prUrl: state.prUrl });
    renderDiffStatus(ds?.status);
    refreshRepoPathBanner(state.prUrl);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'prUrlChanged') {
      const changed = currentPrUrl !== msg.prUrl;
      setPrUrl(msg.prUrl);
      if (changed) clearHistoryUI();
      refreshRepoPathBanner(msg.prUrl);
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
      const bubble = activeStreams.get(msg.streamId);
      console.log('[PR Review SP] streamChunk', 'streamId=', msg.streamId, 'matched=', !!bubble, 'delta?', !!msg.delta, 'done?', !!msg.done, 'error?', !!msg.error);
      if (!bubble) return;
      if (msg.delta != null) appendAssistantDelta(bubble, msg.delta);
      else if (msg.done) {
        finalizeBubble(bubble);
        activeStreams.delete(msg.streamId);
        refreshStopButton();
        if (activeStreams.size === 0) setStatus('');
      } else if (msg.error) {
        setStatus(`Claude error: ${msg.error}`, { error: true });
        finalizeBubble(bubble);
        activeStreams.delete(msg.streamId);
        refreshStopButton();
      }
    }
    if (msg.type === 'hostStatus') {
      if (msg.status === 'missing') {
        showOnboarding(chrome.runtime.id);
      } else if (msg.status === 'ready') {
        stopRetryPoll();
        hideOnboarding();
        maybeShowFirstRunBanner();
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

async function refreshRepoPathBanner(prUrl) {
  if (!prUrl) {
    document.querySelectorAll('#repo-path-banner').forEach((n) => n.remove());
    return;
  }
  // Guarantee a single element synchronously, BEFORE awaiting the
  // background round-trip. Concurrent calls (init + prUrlChanged) would
  // otherwise each create their own banner.
  let el = document.getElementById('repo-path-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'repo-path-banner';
    el.className = 'repo-path-banner';
    document.getElementById('header').insertAdjacentElement('afterend', el);
  }
  // Sweep any stale duplicates left over from previous race conditions.
  document.querySelectorAll('#repo-path-banner').forEach((n) => { if (n !== el) n.remove(); });
  const res = await chrome.runtime.sendMessage({ type: 'getRepoPath', prUrl });
  const path = res?.path;
  el.innerHTML = '';
  if (path) {
    const span = document.createElement('span');
    span.className = 'repo-path-text';
    span.textContent = `📁 ${path}`;
    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'repo-path-edit';
    change.textContent = 'change';
    change.title = 'Change local repo path';
    change.addEventListener('click', () => promptRepoPath(prUrl, path));
    el.appendChild(span);
    el.appendChild(change);
    el.dataset.state = 'set';
  } else {
    const span = document.createElement('span');
    span.className = 'repo-path-text';
    span.textContent = '⚠︎ No local repo path set — Claude can\'t read your files';
    const setBtn = document.createElement('button');
    setBtn.type = 'button';
    setBtn.className = 'repo-path-edit';
    setBtn.textContent = 'set path';
    setBtn.addEventListener('click', () => promptRepoPath(prUrl, ''));
    el.appendChild(span);
    el.appendChild(setBtn);
    el.dataset.state = 'unset';
  }
}

async function promptRepoPath(prUrl, current) {
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/);
  const label = m ? `${m[1]}/${m[2]}` : prUrl;
  const suggested = current || (m ? `~/Projects/${m[2]}` : '');
  const input = window.prompt(
    `Local absolute path for ${label}:`,
    suggested,
  );
  if (input == null) return;
  const trimmed = input.trim();
  if (!trimmed) return;
  await chrome.runtime.sendMessage({ type: 'setRepoPath', prUrl, path: trimmed });
  refreshRepoPathBanner(prUrl);
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
  div.className = 'msg assistant thinking';
  const dots = document.createElement('span');
  dots.className = 'thinking-dots';
  dots.innerHTML = '<span></span><span></span><span></span>';
  div.appendChild(dots);
  $('#history').appendChild(div);
  scrollHistory();
  return div;
}

function ensureContentDiv(bubble) {
  let content = bubble.querySelector('.msg-content');
  if (content) return content;
  // First delta: remove the thinking dots and create the content div.
  bubble.classList.remove('thinking');
  while (bubble.firstChild) bubble.removeChild(bubble.firstChild);
  content = document.createElement('div');
  content.className = 'msg-content';
  bubble.appendChild(content);
  return content;
}

function appendAssistantDelta(bubble, text) {
  const content = ensureContentDiv(bubble);
  const prev = bubble.dataset.rawMd || '';
  const next = prev + text;
  bubble.dataset.rawMd = next;
  content.innerHTML = marked.parse(next);
  scrollHistory();
}

function finalizeBubble(bubble) {
  // If we never got a delta, leave a friendly placeholder instead of an
  // empty bubble with dots stuck forever.
  if (bubble.classList.contains('thinking')) {
    bubble.classList.remove('thinking');
    while (bubble.firstChild) bubble.removeChild(bubble.firstChild);
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.textContent = '(no response)';
    bubble.appendChild(content);
  }

  if (bubble && !bubble.dataset.footerAdded) {
    const footer = document.createElement('div');
    footer.className = 'assistant-footer';
    footer.textContent = 'AI output — verify independently.';
    bubble.appendChild(footer);
    bubble.dataset.footerAdded = '1';
  }
}

function scrollHistory() {
  const h = $('#history');
  h.scrollTop = h.scrollHeight;
}

function clearHistoryUI() {
  const h = $('#history');
  h.innerHTML = '';
  activeStreams.clear();
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
  // Image branch: capture any image/* items into pendingImages
  const items = e.clipboardData?.items || [];
  const imageItems = [];
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const blob = it.getAsFile();
      if (blob) imageItems.push(blob);
    }
  }
  if (imageItems.length > 0) {
    e.preventDefault();
    for (const blob of imageItems) attachImageBlob(blob);
    return;
  }

  // Text branch (long paste collapse)
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

function attachImageBlob(blob) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    pendingImages.push({
      dataUrl,
      mimeType: blob.type || 'image/png',
      name: blob.name || `pasted-${Date.now()}.${guessExt(blob.type)}`,
    });
    renderPendingImages();
  };
  reader.readAsDataURL(blob);
}

function guessExt(mime) {
  if (!mime) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('webp')) return 'webp';
  return 'bin';
}

function renderPendingImages() {
  let el = document.getElementById('pending-images');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pending-images';
    el.className = 'pending-images';
    const ctx = document.getElementById('context-preview');
    ctx.insertAdjacentElement('afterend', el);
  }
  el.innerHTML = '';
  if (pendingImages.length === 0) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  for (const [idx, img] of pendingImages.entries()) {
    const chip = document.createElement('div');
    chip.className = 'image-chip';
    const thumb = document.createElement('img');
    thumb.src = img.dataUrl;
    thumb.alt = img.name;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'image-chip-remove';
    x.textContent = '×';
    x.title = 'Remove image';
    x.addEventListener('click', () => {
      pendingImages.splice(idx, 1);
      renderPendingImages();
    });
    chip.appendChild(thumb);
    chip.appendChild(x);
    el.appendChild(chip);
  }
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
  const bubble = startAssistantMessage();

  const expandedQuestion = expandPastes(rawQuestion);
  pasteRegistry.clear();
  pasteCounter = 0;

  const payload = {
    prUrl: currentPrUrl,
    file: currentSelection?.file,
    lines: currentSelection?.lines,
    code: currentSelection?.text,
    question: expandedQuestion,
    images: pendingImages.map((img) => ({ dataUrl: img.dataUrl, mimeType: img.mimeType, name: img.name })),
  };
  // Reset selection + images after attaching once
  currentSelection = null;
  renderContextPreview();
  pendingImages.length = 0;
  renderPendingImages();

  const streamId = nextStreamId++;
  activeStreams.set(streamId, bubble);
  refreshStopButton();
  console.log('[PR Review SP] send', 'streamId=', streamId, 'prUrl=', payload.prUrl, 'q.len=', payload.question?.length);
  chrome.runtime.sendMessage({
    type: 'send',
    streamId,
    ...payload,
  }).catch((err) => {
    setStatus(`Send failed: ${err?.message || err}`, { error: true });
    finalizeBubble(bubble);
    activeStreams.delete(streamId);
  });
}
