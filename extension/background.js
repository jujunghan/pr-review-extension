const BRIDGE = 'http://localhost:8765';
let activePrUrl = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'prUrlChanged') {
      const prev = activePrUrl;
      activePrUrl = msg.prUrl || null;
      if (prev && prev !== activePrUrl) {
        try { await fetch(`${BRIDGE}/clear`, { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({ prUrl: prev }) }); } catch {}
      }
      broadcastToSidePanel({ type: 'prUrlChanged', prUrl: activePrUrl });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'selectionChanged') {
      broadcastToSidePanel({ type: 'selectionChanged', ...msg });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'getState') {
      sendResponse({ prUrl: activePrUrl });
      return;
    }
    if (msg.type === 'clearContext') {
      if (activePrUrl) {
        try { await fetch(`${BRIDGE}/clear`, { method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({ prUrl: activePrUrl }) }); } catch {}
      }
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: 'unknown message' });
  })();
  return true;
});

function broadcastToSidePanel(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}
