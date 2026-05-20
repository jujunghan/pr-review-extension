// Service worker. Holds a single chrome.runtime.connectNative port to the
// 'com.pr_review.bridge' host. Multiplexes requests (sidepanel /send,
// ghostwrite /send, /clear) by id. Streams responses back to the sender.

const NATIVE_HOST = 'com.pr_review.bridge';
let activePrUrl = null;
let port = null;
let nextId = 1;
// id -> { onDelta, onDone, onError }
const pending = new Map();

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
    for (const handler of pending.values()) {
      handler.onError?.(err);
    }
    pending.clear();
    port = null;
  });
  return port;
}

function nativeSend(req, { onDelta, onDone, onError }) {
  const p = ensurePort();
  if (!p) {
    onError?.('Native host not installed. Run: npm run install-host -- --ext-id <id>');
    return null;
  }
  const id = nextId++;
  pending.set(id, { onDelta, onDone, onError });
  try {
    p.postMessage({ id, ...req });
  } catch (err) {
    pending.delete(id);
    onError?.(err.message);
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
      }
      broadcast({ type: 'prUrlChanged', prUrl: activePrUrl });
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
      if (activePrUrl) nativeSend({ type: 'clear', prUrl: activePrUrl }, {});
      sendResponse({ ok: true });
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
      nativeSend({ type: 'send', prUrl, file, lines, code, question }, {
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
