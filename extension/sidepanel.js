const BRIDGE = 'http://localhost:8765';
const $ = (sel) => document.querySelector(sel);

let currentPrUrl = null;
let currentSelection = null;
let currentAssistantEl = null;

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

  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  $('#clear-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'clearContext' });
    clearHistoryUI();
    setStatus('Context cleared.', false);
  });
}

function setPrUrl(url) {
  currentPrUrl = url;
  $('#pr-label').textContent = url ? prShortLabel(url) : 'No PR detected';
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
  el.textContent = `${header}\n${text.slice(0, 400)}${text.length > 400 ? '…' : ''}`;
  el.hidden = false;
}

function appendUserMessage(text) {
  const div = document.createElement('div');
  div.className = 'msg user';
  div.textContent = text;
  $('#history').appendChild(div);
  scrollHistory();
}

function startAssistantMessage() {
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
  $('#history').innerHTML = '';
  currentAssistantEl = null;
}

function setStatus(text, isError) {
  const s = $('#status');
  s.textContent = text || '';
  s.classList.toggle('error', !!isError);
}

async function send() {
  const question = $('#input').value.trim();
  if (!question) return;
  if (!currentPrUrl) { setStatus('Open a GitHub PR page first.', true); return; }

  const userText = currentSelection
    ? `[${currentSelection.file || 'selection'}${currentSelection.lines ? `:${currentSelection.lines}` : ''}]\n\n${question}`
    : question;
  appendUserMessage(userText);
  $('#input').value = '';
  setStatus('Asking…', false);
  startAssistantMessage();

  const payload = {
    prUrl: currentPrUrl,
    file: currentSelection?.file,
    lines: currentSelection?.lines,
    code: currentSelection?.text,
    question,
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
      setStatus(`Bridge error (${res.status}): ${text}`, true);
      finishAssistantMessage();
      return;
    }
    await consumeSse(res.body);
    setStatus('', false);
  } catch (err) {
    setStatus(`Bridge offline. Start it with: npm run bridge:start`, true);
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
    setStatus(`Claude error: ${err.message}`, true);
  }
}
