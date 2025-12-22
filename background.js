// Store connections from DevTools panels
const devtoolsConnections = new Map();

// Store stream data per tab
const tabData = new Map();

const DEBUG = false; // Set to true for debugging

function log(...args) {
  if (DEBUG) {
    console.log('[Stream Panel Background]', ...args);
  }
}

// Handle connections from DevTools panels
chrome.runtime.onConnect.addListener(function(port) {
  if (port.name !== 'stream-panel') return;

  let tabId = null;

  port.onMessage.addListener(function(message) {
    if (message.type === 'init') {
      tabId = message.tabId;
      devtoolsConnections.set(tabId, port);

      // Send existing data for this tab
      if (tabData.has(tabId)) {
        port.postMessage({
          type: 'init-data',
          data: tabData.get(tabId)
        });
      }
    } else if (message.type === 'clear') {
      // Clear data for this tab
      if (tabId) {
        tabData.set(tabId, { connections: {} });
      }
    }
  });

  port.onDisconnect.addListener(function() {
    if (tabId) {
      devtoolsConnections.delete(tabId);
    }
  });
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.source !== 'stream-panel-content') return;

  const tabId = sender.tab?.id;
  if (!tabId) return;

  const payload = message.payload;

  log('Received message:', payload.type, 'for tab', tabId, payload);

  // Initialize tab data if needed
  if (!tabData.has(tabId)) {
    tabData.set(tabId, { connections: {} });
  }

  const data = tabData.get(tabId);

  // Process different message types
  switch (payload.type) {
    case 'stream-connection':
      data.connections[payload.connectionId] = {
        id: payload.connectionId,
        url: payload.url,
        frameUrl: payload.frameUrl,
        isIframe: payload.isIframe,
        status: 'connecting',
        createdAt: payload.timestamp,
        messages: []
      };
      log('Created connection:', payload.connectionId);
      break;

    case 'stream-open':
      if (data.connections[payload.connectionId]) {
        data.connections[payload.connectionId].status = 'open';
        log('Connection opened:', payload.connectionId);
      }
      break;

    case 'stream-message':
      if (data.connections[payload.connectionId]) {
        data.connections[payload.connectionId].messages.push({
          id: payload.messageId,
          eventType: payload.eventType,
          data: payload.data,
          lastEventId: payload.lastEventId,
          timestamp: payload.timestamp
        });
        log('Stored message #' + payload.messageId + ' for connection:', payload.connectionId);
      } else {
        if (DEBUG) {
          console.warn('[Stream Panel Background] Message received for unknown connection:', payload.connectionId);
        }
      }
      break;

    case 'stream-error':
      if (data.connections[payload.connectionId]) {
        data.connections[payload.connectionId].status = 'error';
      }
      break;

    case 'stream-close':
      if (data.connections[payload.connectionId]) {
        data.connections[payload.connectionId].status = 'closed';
      }
      break;
  }

  // Forward to DevTools panel if connected
  const port = devtoolsConnections.get(tabId);
  if (port) {
    try {
      port.postMessage({
        type: 'stream-event',
        payload: payload
      });
      log('Forwarded to DevTools panel');
    } catch (e) {
      devtoolsConnections.delete(tabId);
      if (DEBUG) {
        console.error('[Stream Panel Background] Failed to forward to DevTools:', e);
      }
    }
  } else {
    log('No DevTools panel connected for tab:', tabId);
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener(function(tabId) {
  tabData.delete(tabId);
  devtoolsConnections.delete(tabId);
});

// Clean up when tab is navigated
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo) {
  if (changeInfo.status === 'loading') {
    // Clear data on navigation
    tabData.set(tabId, { connections: {} });

    // Notify DevTools panel
    const port = devtoolsConnections.get(tabId);
    if (port) {
      try {
        port.postMessage({
          type: 'navigation',
          tabId: tabId
        });
      } catch (e) {
        devtoolsConnections.delete(tabId);
      }
    }
  }
});
