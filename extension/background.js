// Service worker. Holds a single chrome.runtime.connectNative port to the
// 'com.pr_review.bridge' host. Multiplexes requests (sidepanel /send,
// ghostwrite /send, /clear) by id. Streams responses back to the sender.

const NATIVE_HOST = 'com.pr_review.bridge';
const DIFF_BYTE_LIMIT = 200 * 1024; // 200KB hard skip
const DIFF_LINE_LIMIT = 5000;       // 5K lines hard skip

let activePrUrl = null;
let port = null;
let nextId = 1;
// id -> { onDelta, onDone, onError }
const pending = new Map();
// prUrl -> diff text (only stored if within limits)
const diffCache = new Map();
// prUrl -> { skipped: 'too-large', bytes, lines } metadata for sidepanel
const diffStatus = new Map();
// prUrl set: whose diff has already been attached as the first user turn
const diffAttached = new Set();

function ensurePort() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (err) {
    port = null;
    return null;
  }
  port.onMessage.addListener((msg) => {
    const handler = pending.get(msg.id);
    if (!handler) return;
    if (msg.type === 'delta') handler.onDelta?.(msg.text);
    else if (msg.type === 'done') { handler.onDone?.(msg.sessionId); pending.delete(msg.id); }
    else if (msg.type === 'error') { handler.onError?.(msg.message); pending.delete(msg.id); }
    else if (msg.type === 'ok') { handler.onDone?.(); pending.delete(msg.id); }
  });
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message || 'Native host disconnected';
    // Chrome may exit the host after idle. Any in-flight requests that
    // haven't started receiving data yet are safe to retry once on a
    // fresh port; ones already mid-stream surface the error to the user.
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
    for (const h of toRetry) {
      nativeSend(h._req, h);
    }
  });
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
      const prev = activePrUrl;
      activePrUrl = msg.prUrl || null;
      if (prev && prev !== activePrUrl) {
        nativeSend({ type: 'clear', prUrl: prev }, {});
        diffAttached.delete(prev);
        diffAttached.delete(`${prev}#ghostwrite`);
      }
      broadcast({ type: 'prUrlChanged', prUrl: activePrUrl });
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
      sendResponse({ prUrl: activePrUrl });
      return;
    }
    if (msg.type === 'clearContext') {
      if (activePrUrl) {
        nativeSend({ type: 'clear', prUrl: activePrUrl }, {});
        diffAttached.delete(activePrUrl);
      }
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'cacheDiff') {
      const bytes = msg.diff.length;
      const lines = msg.diff.split('\n').length;
      if (bytes > DIFF_BYTE_LIMIT || lines > DIFF_LINE_LIMIT) {
        diffCache.delete(msg.prUrl);
        diffStatus.set(msg.prUrl, { skipped: 'too-large', bytes, lines });
      } else {
        diffCache.set(msg.prUrl, msg.diff);
        diffStatus.set(msg.prUrl, { ready: true, bytes, lines });
      }
      broadcast({ type: 'diffStatus', prUrl: msg.prUrl, status: diffStatus.get(msg.prUrl) });
      sendResponse({ ok: true });
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
    if (msg.type === 'send') {
      // streaming send: the sender supplies a streamId so we route deltas
      // back via broadcast (sidepanel) or tab message (content script).
      const { streamId, target, prUrl, file, lines, code, question } = msg;
      const replyTo = (payload) => {
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
      if (cacheKey && !diffAttached.has(prUrl) && diffCache.has(cacheKey)) {
        const diff = diffCache.get(cacheKey);
        finalQuestion = `Here is the full PR diff for context. Refer to it when answering.\n\n\`\`\`diff\n${diff}\n\`\`\`\n\n---\n\n${question}`;
        diffAttached.add(prUrl);
      }

      nativeSend({ type: 'send', prUrl, file, lines, code, question: finalQuestion }, {
        onDelta: (text) => replyTo({ delta: text }),
        onDone: (sessionId) => replyTo({ done: true, sessionId }),
        onError: (message) => replyTo({ error: message }),
      });
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: 'unknown message' });
  })();
  return true;
});

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}
