import { marked } from './lib/marked.esm.js';

function escapeHtmlText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isSafeUrl(href) {
  if (!href) return false;
  return /^(https?:|mailto:|#|\/)/i.test(href);
}

marked.use({
  gfm: true,
  breaks: true,
  // PR diff content is partially attacker-controllable (the PR author).
  // marked v15 removed its sanitizer, so we override the html/link/image
  // renderers to drop raw HTML and reject non-http(s) URL schemes
  // (javascript:, data:, vbscript:, file:, ...). This is defense in
  // depth — MV3 CSP also blocks inline script — but it removes the
  // phishing / exfil surface that LLM-rendered HTML otherwise creates.
  renderer: {
    html(token) {
      return escapeHtmlText(token.raw ?? token.text ?? '');
    },
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (!isSafeUrl(href)) return inner;
      const t = title ? ` title="${escapeHtmlText(title)}"` : '';
      return `<a href="${escapeHtmlText(href)}" target="_blank" rel="noopener noreferrer"${t}>${inner}</a>`;
    },
    image({ href, title, text }) {
      if (!isSafeUrl(href)) return escapeHtmlText(text || '');
      const t = title ? ` title="${escapeHtmlText(title)}"` : '';
      return `<img src="${escapeHtmlText(href)}" alt="${escapeHtmlText(text || '')}"${t}>`;
    },
  },
});

const $ = (sel) => document.querySelector(sel);

let currentPrUrl = null;
let currentSelection = null;
let nextStreamId = 1;
// Pasted images attached to the next send. Cleared after send dispatches.
// Each entry: { dataUrl, mimeType, name }
const pendingImages = [];
const MAX_PENDING_IMAGES = 5;
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

function refreshResumeBanner(hasStoredSession) {
  const banner = document.getElementById('resume-banner');
  if (!banner) return;
  banner.hidden = !hasStoredSession;
}

function refreshStopButton() {
  const btn = document.getElementById('stop-btn');
  if (!btn) return;
  btn.hidden = activeStreams.size === 0;
}

// ============ Quick-prompt chips ============
// Click a chip → input is filled with the template. User can edit before sending.
const QUICK_TEMPLATES = {
  security: '이 PR의 보안 이슈를 검토해줘: 입력 검증, 인증·인가, 인젝션, 비밀 노출, 외부 입력 신뢰 등 항목별로 구체 line 인용해서.',
  performance: '이 PR의 성능 문제를 봐줘: N+1 쿼리, 핫 알로케이션, 블로킹 호출, 불필요한 재계산 등 구체적으로.',
  bugs: '이 PR에서 버그를 찾아줘: off-by-one, race condition, null/undefined, 에러 처리 누락, 엣지 케이스, 잘못된 가정.',
  improvements: '이 PR을 어떻게 개선할 수 있을까? 가독성, 단순화, 누락된 테스트, 더 적합한 패턴/API — 구체적인 대체 코드까지.',
};

function wireQuickChips() {
  const input = document.getElementById('input');
  if (!input) return;
  document.querySelectorAll('.quick-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.template;
      const tpl = QUICK_TEMPLATES[key];
      if (!tpl) return;
      input.value = tpl;
      input.focus();
      input.setSelectionRange(tpl.length, tpl.length);
    });
  });
}

// ============ Slash-command autocomplete ============
const SLASH_MAX = 4;
let slashCommandsAll = null;       // null = not loaded yet; [] = loaded, no entries
let slashLoadingPromise = null;
let slashActive = false;
let slashItems = [];
let slashHighlight = 0;

async function ensureSlashCommandsLoaded() {
  if (slashCommandsAll != null) return slashCommandsAll;
  if (slashLoadingPromise) return slashLoadingPromise;
  slashLoadingPromise = (async () => {
    const res = await chrome.runtime.sendMessage({ type: 'getSlashCommands' });
    slashCommandsAll = Array.isArray(res?.commands) ? res.commands : [];
    slashLoadingPromise = null;
    return slashCommandsAll;
  })();
  return slashLoadingPromise;
}

function filterSlashCommands(query) {
  if (!slashCommandsAll) return [];
  const q = (query || '').toLowerCase();
  const matches = [];
  for (const cmd of slashCommandsAll) {
    const name = (cmd.name || '').toLowerCase();
    if (!q) { matches.push({ cmd, rank: 1 }); }
    else if (name.startsWith(q)) { matches.push({ cmd, rank: 0 }); }
    else if (name.includes(q)) { matches.push({ cmd, rank: 1 }); }
    else continue;
  }
  matches.sort((a, b) => a.rank - b.rank || a.cmd.name.localeCompare(b.cmd.name));
  return matches.slice(0, SLASH_MAX).map((m) => m.cmd);
}

function renderSlashDropdown() {
  const el = document.getElementById('slash-dropdown');
  if (!el) return;
  if (!slashActive) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '';
  if (slashItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'slash-empty';
    empty.textContent = slashCommandsAll == null ? 'Loading commands…' : 'No matching commands.';
    el.appendChild(empty);
    return;
  }
  for (let i = 0; i < slashItems.length; i += 1) {
    const cmd = slashItems[i];
    const item = document.createElement('div');
    item.className = 'slash-item' + (i === slashHighlight ? ' is-active' : '');
    item.setAttribute('role', 'option');
    item.dataset.idx = String(i);
    const name = document.createElement('div');
    name.className = 'slash-item-name';
    name.textContent = '/' + cmd.name;
    item.appendChild(name);
    if (cmd.description) {
      const desc = document.createElement('div');
      desc.className = 'slash-item-desc';
      desc.textContent = cmd.description;
      item.appendChild(desc);
    }
    item.addEventListener('mousedown', (ev) => {
      // mousedown (not click) so the focus stays in the textarea — otherwise
      // the textarea blurs before our click handler fires.
      ev.preventDefault();
      acceptSlashItem(i);
    });
    el.appendChild(item);
  }
}

function getSlashQuery(input) {
  const v = input.value;
  if (!v.startsWith('/')) return null;
  // Only first-token autocomplete: if there's whitespace, we're past the command name.
  if (/\s/.test(v)) return null;
  return v.slice(1);
}

async function maybeOpenSlash(input) {
  const q = getSlashQuery(input);
  if (q === null) {
    if (slashActive) { slashActive = false; renderSlashDropdown(); }
    return;
  }
  if (!slashCommandsAll) {
    slashActive = true;
    slashItems = [];
    renderSlashDropdown();          // shows "Loading commands…"
    await ensureSlashCommandsLoaded();
    // Re-derive query in case the user kept typing while we waited.
    const q2 = getSlashQuery(input);
    if (q2 === null) { slashActive = false; renderSlashDropdown(); return; }
    slashItems = filterSlashCommands(q2);
    slashHighlight = 0;
    renderSlashDropdown();
    return;
  }
  slashActive = true;
  slashItems = filterSlashCommands(q);
  slashHighlight = Math.min(slashHighlight, Math.max(0, slashItems.length - 1));
  renderSlashDropdown();
}

function acceptSlashItem(idx) {
  const input = document.getElementById('input');
  if (!input) return;
  const cmd = slashItems[idx];
  if (!cmd) return;
  input.value = `/${cmd.name} `;
  slashActive = false;
  renderSlashDropdown();
  input.focus();
  // Move caret to end
  const v = input.value;
  input.setSelectionRange(v.length, v.length);
}

init();

async function init() {
  wireOnboardingControls();
  wireQuickChips();

  document.getElementById('stop-btn').addEventListener('click', async () => {
    // Explicit Stop wipes the user's question and the in-flight assistant
    // bubble from the side panel — UX-wise, treat the exchange as if it
    // never happened. The late-arriving streamChunk done/error messages
    // for the cancelled streams won't find an entry in activeStreams and
    // get silently dropped by the !entry guard in the streamChunk handler.
    for (const entry of activeStreams.values()) {
      entry.userBubble?.remove();
      entry.bubble?.remove();
    }
    activeStreams.clear();
    refreshStopButton();
    setStatus('');
    await chrome.runtime.sendMessage({ type: 'cancelAllStreams' });
  });

  const hostRes = await chrome.runtime.sendMessage({ type: 'getHostStatus' });
  if (hostRes?.status !== 'ready') {
    showOnboarding(chrome.runtime.id);
  } else {
    await maybeShowFirstRunBanner();
  }

  const state = await chrome.runtime.sendMessage({ type: 'getState' });
  setPrUrl(state?.prUrl || null);
  refreshResumeBanner(!!state?.hasStoredSession);
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
      refreshResumeBanner(!!msg.hasStoredSession);
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
      const entry = activeStreams.get(msg.streamId);
      console.log('[PR Review SP] streamChunk', 'streamId=', msg.streamId, 'matched=', !!entry, 'delta?', !!msg.delta, 'done?', !!msg.done, 'error?', !!msg.error);
      if (!entry) return;
      const bubble = entry.bubble;
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
    if (slashActive && slashItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashHighlight = (slashHighlight + 1) % slashItems.length;
        renderSlashDropdown();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashHighlight = (slashHighlight - 1 + slashItems.length) % slashItems.length;
        renderSlashDropdown();
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) || e.key === 'Tab') {
        e.preventDefault();
        acceptSlashItem(slashHighlight);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        slashActive = false;
        renderSlashDropdown();
        return;
      }
    }
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
  input.addEventListener('input', () => maybeOpenSlash(input));

  document.getElementById('resume-fresh').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'clearContext' });
    clearHistoryUI();
    refreshResumeBanner(false);
    setStatus('Started fresh session.');
  });

  $('#clear-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'clearContext' });
    clearHistoryUI();
    refreshResumeBanner(false);
    setStatus('Context cleared.');
  });

  $('#sync-btn').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: 'syncCurrentPr' });
    if (res?.prUrl) {
      setStatus('Synced to current PR.');
    } else {
      setStatus('Open a GitHub PR in the active tab first.', { error: true });
    }
  });

  $('#context-dismiss').addEventListener('click', () => {
    currentSelection = null;
    renderContextPreview();
  });

  document.addEventListener('click', (e) => {
    if (!slashActive) return;
    const dropdown = document.getElementById('slash-dropdown');
    if (e.target === input || (dropdown && dropdown.contains(e.target))) return;
    slashActive = false;
    renderSlashDropdown();
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
  return div;
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
  // Without this, a stale 'Thinking…' / error / 'Context cleared.' from a
  // previous PR survives the wipe — and any late streamChunk done that
  // arrives for the just-cleared streams gets silently dropped, so nothing
  // else clears the status. Reset both the text and the Stop button.
  setStatus('');
  refreshStopButton();
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
    const remaining = MAX_PENDING_IMAGES - pendingImages.length;
    if (remaining <= 0) {
      setStatus(`Max ${MAX_PENDING_IMAGES} images per message — remove one to attach another.`, { error: true });
      return;
    }
    const accepted = imageItems.slice(0, remaining);
    const dropped = imageItems.length - accepted.length;
    for (const blob of accepted) attachImageBlob(blob);
    if (dropped > 0) {
      setStatus(`Attached ${accepted.length}, dropped ${dropped} (max ${MAX_PENDING_IMAGES} per message).`, { error: true });
    }
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
  const userBubble = appendUserMessage(userText);
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
  activeStreams.set(streamId, { userBubble, bubble });
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
    refreshStopButton();
  });
}
