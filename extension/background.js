// Service worker. Holds a single chrome.runtime.connectNative port to the
// 'com.pr_review.bridge' host. Multiplexes requests (sidepanel /send,
// ghostwrite /send, /clear) by id. Streams responses back to the sender.

const NATIVE_HOST = 'com.pr_review.bridge';
const DIFF_BYTE_LIMIT = 50 * 1024;  // 50KB hard skip — keeps first-token latency low
const DIFF_LINE_LIMIT = 1500;       // 1.5K lines hard skip

let activePrUrl = null;
let port = null;
let nextId = 1;
// id -> { onDelta, onDone, onError }
const pending = new Map();
// streamId -> backend id (the one we use with native messaging). Lets us
// translate a side-panel-facing cancel back to the host's protocol.
const streamIdToBackendId = new Map();
// prUrl -> diff text (only stored if within limits)
const diffCache = new Map();
// prUrl -> { skipped: 'too-large', bytes, lines } metadata for sidepanel
const diffStatus = new Map();
// prUrl set: whose diff has already been attached as the first user turn
const diffAttached = new Set();

// prUrl -> sessionId, persisted in chrome.storage.local under 'prSessions'.
// Lets us pass resumeSessionId to the host so claude --resume picks up the
// previous turn-history from its own jsonl on the next send.
const prSessions = new Map();
const prSessionsReady = (async () => {
  const data = await chrome.storage.local.get('prSessions');
  const stored = data.prSessions || {};
  for (const [k, v] of Object.entries(stored)) prSessions.set(k, v);
})();

async function persistSession(prUrl, sessionId) {
  if (!prUrl || !sessionId) return;
  if (prSessions.get(prUrl) === sessionId) return;
  prSessions.set(prUrl, sessionId);
  const data = await chrome.storage.local.get('prSessions');
  const stored = data.prSessions || {};
  stored[prUrl] = sessionId;
  await chrome.storage.local.set({ prSessions: stored });
}

async function forgetSession(prUrl) {
  if (!prUrl) return;
  prSessions.delete(prUrl);
  const data = await chrome.storage.local.get('prSessions');
  const stored = data.prSessions || {};
  delete stored[prUrl];
  await chrome.storage.local.set({ prSessions: stored });
}

function routeIncoming(msg) {
  console.log('[PR Review BG] port recv', msg.type, 'id=', msg.id,
    msg.type === 'delta' ? `text.len=${msg.text?.length}` : '');
  const handler = pending.get(msg.id);
  if (!handler) {
    console.warn('[PR Review BG] no handler for id', msg.id);
    return;
  }
  if (msg.type === 'delta') handler.onDelta?.(msg.text);
  else if (msg.type === 'done') { handler.onDone?.(msg.sessionId); pending.delete(msg.id); }
  else if (msg.type === 'error') { handler.onError?.(msg.message); pending.delete(msg.id); }
  else if (msg.type === 'ok') { handler.onDone?.(); pending.delete(msg.id); }
  else if (msg.type === 'commands') { handler.onCommands?.(msg.commands || []); pending.delete(msg.id); }
}

function handleDisconnect() {
  const err = chrome.runtime.lastError?.message || 'Native host disconnected';
  console.warn('[PR Review BG] port disconnect:', err, 'pending=', pending.size);
  const toRetry = [];
  for (const [, handler] of pending) {
    if (!handler._retried && !handler._sawDelta && handler._req) {
      handler._retried = true;
      toRetry.push(handler);
    } else {
      handler.onError?.(err);
    }
  }
  pending.clear();
  port = null;
  broadcast({ type: 'hostStatus', status: 'missing', error: err });
  for (const h of toRetry) {
    nativeSend(h._req, h);
  }
}

function ensurePort() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (err) {
    port = null;
    return null;
  }
  port.onMessage.addListener(routeIncoming);
  port.onDisconnect.addListener(handleDisconnect);
  return port;
}

function nativeSend(req, callbacks) {
  const p = ensurePort();
  if (!p) {
    callbacks.onError?.('Native host not installed. Run: npm run install-host -- --ext-id <id>');
    return null;
  }
  const id = nextId++;
  const handler = {
    onDelta: (text) => { handler._sawDelta = true; callbacks.onDelta?.(text); },
    onDone: callbacks.onDone,
    onError: callbacks.onError,
    _req: req,
    _retried: callbacks._retried || false,
    _sawDelta: false,
  };
  pending.set(id, handler);
  console.log('[PR Review BG] port send', req.type, 'id=', id, 'prUrl=', req.prUrl, 'q.len=', req.question?.length);
  try {
    p.postMessage({ id, ...req });
  } catch (err) {
    pending.delete(id);
    callbacks.onError?.(err.message);
    port = null;
  }
  return id;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'prUrlChanged') {
      await prSessionsReady;
      const prev = activePrUrl;
      activePrUrl = msg.prUrl || null;
      if (prev && prev !== activePrUrl) {
        nativeSend({ type: 'clear', prUrl: prev }, {});
        diffAttached.delete(prev);
        diffAttached.delete(`${prev}#ghostwrite`);
        // Intentionally do NOT forgetSession(prev) — we want the user to
        // be able to come back to that PR later and resume from storage.
      }
      broadcast({
        type: 'prUrlChanged',
        prUrl: activePrUrl,
        hasStoredSession: activePrUrl ? prSessions.has(activePrUrl) : false,
      });
      // Re-send the diff status for the new PR so the sidepanel can show it
      if (activePrUrl && diffStatus.has(activePrUrl)) {
        broadcast({ type: 'diffStatus', prUrl: activePrUrl, status: diffStatus.get(activePrUrl) });
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'selectionChanged') {
      broadcast({ type: 'selectionChanged', ...msg });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'getState') {
      await prSessionsReady;
      sendResponse({
        prUrl: activePrUrl,
        hasStoredSession: activePrUrl ? prSessions.has(activePrUrl) : false,
      });
      return;
    }
    if (msg.type === 'clearContext') {
      if (activePrUrl) {
        nativeSend({ type: 'clear', prUrl: activePrUrl }, {});
        diffAttached.delete(activePrUrl);
        await forgetSession(activePrUrl);
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'cacheDiff') {
      // Legacy path (content-script-initiated fetch). Kept for any caller
      // still using it. The current content script delegates to prefetchDiff
      // below to dodge CORS on patch-diff.githubusercontent.com.
      ingestDiff(msg.prUrl, msg.diff);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'prefetchDiff') {
      sendResponse({ ok: true });
      try {
        const res = await fetch(`${msg.prUrl}.diff`, { credentials: 'include' });
        if (!res.ok) {
          console.warn('[PR Review BG] diff fetch returned', res.status, 'for', msg.prUrl);
          return;
        }
        const diff = await res.text();
        ingestDiff(msg.prUrl, diff);
      } catch (err) {
        console.warn('[PR Review BG] diff prefetch failed for', msg.prUrl, err?.message || err);
      }
      return;
    }
    if (msg.type === 'getDiffStatus') {
      sendResponse({ status: diffStatus.get(msg.prUrl) || null });
      return;
    }
    if (msg.type === 'openSidePanelWithSelection') {
      const tabId = sender.tab?.id;
      if (tabId) {
        try { await chrome.sidePanel.open({ tabId }); } catch {}
      }
      broadcast({
        type: 'selectionChanged',
        prUrl: msg.prUrl,
        file: msg.file,
        lines: msg.lines,
        text: msg.text,
      });
      broadcast({ type: 'focusInput' });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'getRepoPath') {
      const path = await lookupRepoPath(msg.prUrl);
      sendResponse({ path });
      return;
    }
    if (msg.type === 'getHostStatus') {
      sendResponse({ status: probeHostStatus() });
      return;
    }
    if (msg.type === 'setRepoPath') {
      const key = repoKey(msg.prUrl);
      if (!key) { sendResponse({ ok: false, error: 'invalid prUrl' }); return; }
      const data = await chrome.storage.local.get('repoPaths');
      const map = data.repoPaths || {};
      map[key] = msg.path;
      await chrome.storage.local.set({ repoPaths: map });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'send') {
      await prSessionsReady;
      // streaming send: the sender supplies a streamId so we route deltas
      // back via broadcast (sidepanel) or tab message (content script).
      const { streamId, target, prUrl, file, lines, code, question, images } = msg;
      const cwd = await lookupRepoPath(prUrl);
      const resumeSessionId = prSessions.get(prUrl) || null;
      const replyTo = (payload) => {
        const kind = payload.delta != null ? 'delta' : (payload.done ? 'done' : (payload.error ? 'error' : '?'));
        console.log('[PR Review BG] replyTo', target || 'broadcast', 'streamId=', streamId, kind, payload.delta?.length || '');
        if (target === 'tab' && sender.tab?.id != null) {
          chrome.tabs.sendMessage(sender.tab.id, { type: 'streamChunk', streamId, ...payload }).catch(() => {});
        } else {
          broadcast({ type: 'streamChunk', streamId, ...payload });
        }
      };

      // On the first turn of a PR session, prepend the full diff so Claude
      // has the whole PR as context from the start.
      let finalQuestion = question;
      const cacheKey = prUrl?.split('#')[0]; // strip #ghostwrite etc.
      // Skip diff prepend on resume — claude already has it from the
      // session's prior turn-history.
      if (!resumeSessionId && cacheKey && !diffAttached.has(prUrl) && diffCache.has(cacheKey)) {
        const diff = diffCache.get(cacheKey);
        finalQuestion = `PR diff (review context):\n\`\`\`diff\n${diff}\n\`\`\`\n\n${question}`;
        diffAttached.add(prUrl);
      }

      const backendId = nativeSend(
        { type: 'send', prUrl, file, lines, code, question: finalQuestion, cwd, images, resumeSessionId },
        {
          onDelta: (text) => replyTo({ delta: text }),
          onDone: (sessionId) => {
            if (sessionId) persistSession(prUrl, sessionId);
            streamIdToBackendId.delete(streamId);
            replyTo({ done: true, sessionId });
          },
          onError: (message) => { streamIdToBackendId.delete(streamId); replyTo({ error: message }); },
        }
      );
      if (backendId != null) streamIdToBackendId.set(streamId, backendId);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'cancelStream') {
      const backendId = streamIdToBackendId.get(msg.streamId);
      if (backendId != null) {
        nativeSend({ type: 'cancel', targetId: backendId }, {});
        streamIdToBackendId.delete(msg.streamId);
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'cancelAllStreams') {
      for (const [streamId, backendId] of streamIdToBackendId) {
        nativeSend({ type: 'cancel', targetId: backendId }, {});
      }
      streamIdToBackendId.clear();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'getSlashCommands') {
      const commands = await getSlashCommandsCached();
      sendResponse({ commands });
      return;
    }
    sendResponse({ ok: false, error: 'unknown message' });
  })();
  return true;
});

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function repoKey(prUrl) {
  if (!prUrl) return null;
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function lookupRepoPath(prUrl) {
  const key = repoKey(prUrl);
  if (!key) return null;
  const data = await chrome.storage.local.get('repoPaths');
  return data.repoPaths?.[key] || null;
}

function ingestDiff(prUrl, diff) {
  const bytes = diff.length;
  const lines = diff.split('\n').length;
  if (bytes > DIFF_BYTE_LIMIT || lines > DIFF_LINE_LIMIT) {
    diffCache.delete(prUrl);
    diffStatus.set(prUrl, { skipped: 'too-large', bytes, lines });
  } else {
    diffCache.set(prUrl, diff);
    diffStatus.set(prUrl, { ready: true, bytes, lines });
  }
  broadcast({ type: 'diffStatus', prUrl, status: diffStatus.get(prUrl) });
}

// Returns 'ready' if we already hold a live port, 'probing' if we just
// opened one (the side panel should re-poll on the upcoming hostStatus
// broadcast), or 'missing' if connectNative threw. connectNative throws
// synchronously only when the native host manifest is entirely absent;
// connection failures surface later via the existing handleDisconnect.
function probeHostStatus() {
  if (port) return 'ready';
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
    port.onMessage.addListener(routeIncoming);
    port.onDisconnect.addListener(handleDisconnect);
    return 'probing';
  } catch {
    return 'missing';
  }
}

// Slash-command list — fetched once per service-worker life from the host
// and cached in memory. Service-worker termination clears it, which is fine:
// the next caller refetches.
let slashCommandsCache = null;
let slashCommandsPromise = null;
function getSlashCommandsCached() {
  if (slashCommandsCache) return Promise.resolve(slashCommandsCache);
  if (slashCommandsPromise) return slashCommandsPromise;
  slashCommandsPromise = new Promise((resolve) => {
    let settled = false;
    const handlerId = nativeSend({ type: 'listCommands' }, {
      onCommands: (cmds) => {
        if (settled) return;
        settled = true;
        slashCommandsCache = Array.isArray(cmds) ? cmds : [];
        slashCommandsPromise = null;
        resolve(slashCommandsCache);
      },
      onError: () => {
        if (settled) return;
        settled = true;
        slashCommandsPromise = null;
        resolve([]);
      },
    });
    if (handlerId == null) {
      settled = true;
      slashCommandsPromise = null;
      resolve([]);
    }
  });
  return slashCommandsPromise;
}
