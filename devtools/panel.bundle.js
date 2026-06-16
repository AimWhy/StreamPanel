(function () {
  'use strict';

  // State management module

  const state = {
    connections: {},
    selectedConnectionId: null,
    selectedMessageId: null,
    pinnedMessageIds: {},
    filter: '',
    requestTypeFilter: 'all',
    messageFilters: [],
    pendingFilters: [],
    searchQuery: '',
    displayFieldPath: '',
    autoScrollToBottom: true
  };

  function setFilter(filter) {
    state.filter = filter;
  }

  function setRequestTypeFilter(type) {
    state.requestTypeFilter = type;
  }

  function setSearchQuery(query) {
    state.searchQuery = query;
  }

  function setDisplayFieldPath(path) {
    state.displayFieldPath = path;
  }

  function setAutoScrollToBottom(enabled) {
    state.autoScrollToBottom = enabled;
  }

  function togglePinnedMessage(connectionId, messageId) {
    if (!state.pinnedMessageIds[connectionId]) {
      state.pinnedMessageIds[connectionId] = new Set();
    }

    const pinned = state.pinnedMessageIds[connectionId];
    if (pinned.has(messageId)) {
      pinned.delete(messageId);
      return false;
    } else {
      pinned.add(messageId);
      return true;
    }
  }

  function isMessagePinned(connectionId, messageId) {
    return state.pinnedMessageIds[connectionId]?.has(messageId) || false;
  }

  function clearAllData() {
    state.connections = {};
    state.selectedConnectionId = null;
    state.selectedMessageId = null;
  }

  function addConnection$1(connectionData) {
    state.connections[connectionData.id] = connectionData;
  }

  // Utility functions module

  function log(...args) {
    if (window.__STREAM_PANEL_DEBUG__) {
      console.log('[Stream Panel DevTools]', ...args);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('Clipboard API failed, falling back to execCommand:', err);
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      return successful;
    } catch (err) {
      console.error('Failed to copy:', err);
      document.body.removeChild(textarea);
      return false;
    }
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
    return `${timeStr}.${milliseconds}`;
  }

  function formatTimestampForExport(timestamp) {
    const date = new Date(timestamp);
    return date.toISOString();
  }

  function getUrlPath(url) {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch (e) {
      return url;
    }
  }

  function getRequestType(source) {
    if (!source) return 'unknown';
    const lowerSource = source.toLowerCase();
    if (lowerSource.includes('xmlhttprequest')) return 'xhr';
    if (lowerSource.includes('fetch')) return 'fetch';
    if (lowerSource.includes('eventsource')) return 'eventsource';
    return 'unknown';
  }

  function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  function getStatusText(status) {
    const statusMap = {
      'connecting': '连接中',
      'open': '已连接',
      'closed': '已关闭',
      'error': '错误',
      'archived': '归档'
    };
    return statusMap[status] || status;
  }

  function downloadFile(content, filename, mimeType) {
    const bom = mimeType === 'text/csv' ? '\uFEFF' : '';
    const blob = new Blob([bom + content], { type: mimeType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // Connection storage module - IndexedDB operations

  const DB_NAME = 'StreamPanelDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'savedConnections';

  let db = null;

  async function initDB() {
    if (db) return db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        try {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('originalId', 'originalId', { unique: false });
            store.createIndex('savedAt', 'savedAt', { unique: false });
            store.createIndex('url', 'url', { unique: false });
          }
        } catch (upgradeError) {
          console.error('[IndexedDB Upgrade] Error during database upgrade:', upgradeError);
        }
      };
    });
  }

  async function saveConnection(connectionData, options = {}) {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const savedData = {
        id: options.savedId || generateSavedId(),
        originalId: connectionData.id,
        name: options.name || getConnectionName(connectionData),
        url: connectionData.url,
        frameUrl: connectionData.frameUrl || null,
        isIframe: connectionData.isIframe || false,
        source: connectionData.source || 'unknown',
        status: connectionData.status,
        createdAt: connectionData.createdAt,
        savedAt: Date.now(),
        messages: JSON.parse(JSON.stringify(connectionData.messages)),
        messageCount: connectionData.messages.length
      };

      const request = store.put(savedData);

      request.onsuccess = () => resolve(savedData);
      request.onerror = () => reject(request.error);
    });
  }

  async function loadConnection(savedId) {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(savedId);

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteConnection(savedId) {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(savedId);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteAllConnections() {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async function getAllSavedConnections() {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const connections = request.result || [];
        connections.sort((a, b) => b.savedAt - a.savedAt);
        resolve(connections);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function isConnectionSaved(originalId) {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('originalId');
      const request = index.get(originalId);

      request.onsuccess = () => {
        resolve(!!request.result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function getConnectionByOriginalId(originalId) {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('originalId');
      const request = index.get(originalId);

      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  function generateSavedId() {
    return `saved-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  function getConnectionName(connectionData) {
    if (!connectionData.createdAt) return '未命名连接';

    const date = new Date(connectionData.createdAt);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  // Connection management module


  let elements$8 = {};
  let callbacks$6 = {
    renderMessageList: null,
    showListView: null,
    renderFilterConditions: null
  };
  let connectionListRenderToken = 0;

  function initConnectionManager(el) {
    elements$8 = el;
  }

  function setCallbacks$6(cb) {
    callbacks$6 = { ...callbacks$6, ...cb };
  }

  async function renderConnectionList() {
    const renderToken = ++connectionListRenderToken;
    const connections = Object.values(state.connections);
    const urlFilter = state.filter.toLowerCase();
    const typeFilter = state.requestTypeFilter;

    let filtered = urlFilter
      ? connections.filter(c => c.url.toLowerCase().includes(urlFilter))
      : connections;

    if (typeFilter !== 'all') {
      filtered = filtered.filter(c => {
        const requestType = getRequestType(c.source);
        return requestType === typeFilter;
      });
    }

    filtered.sort((a, b) => b.createdAt - a.createdAt);

    if (filtered.length === 0) {
      if (renderToken === connectionListRenderToken) {
        elements$8.connectionList.innerHTML = '<div class="empty-state">暂无连接</div>';
      }
      return;
    }

    const connectionHtml = await Promise.all(filtered.map(async (conn) => {
      const urlPath = getUrlPath(conn.url);
      const isSelected = conn.id === state.selectedConnectionId;
      let isSaved = false;
      try {
        isSaved = await isConnectionSaved(conn.originalId || conn.id);
      } catch (error) {
        console.warn('[Stream Panel] Failed to check saved connection:', error);
      }
      const badgeClass = conn.isIframe ? 'badge-iframe' : 'badge-main';
      const badgeText = conn.isIframe ? 'iframe' : '主页面';
      const statusClass = `status-${conn.status}`;
      const requestType = getRequestType(conn.source);
      const typeBadgeMap = {
        'fetch': 'badge-fetch',
        'xhr': 'badge-xhr',
        'eventsource': 'badge-eventsource',
        'unknown': 'badge-unknown'
      };
      const typeBadgeClass = typeBadgeMap[requestType] || 'badge-unknown';
      const typeBadgeText = requestType.toUpperCase();

      const savedIndicator = isSaved ? '<span class="connection-saved-indicator" title="已保存到数据库">💾</span>' : '';

      return `
      <div class="connection-item ${isSelected ? 'selected' : ''}" data-id="${conn.id}">
        <div class="connection-url" title="${escapeHtml(conn.url)}">${escapeHtml(urlPath)}</div>
        <div class="connection-meta">
          <span class="status-dot ${statusClass}"></span>
          <span class="connection-badge ${badgeClass}">${badgeText}</span>
          <span class="connection-badge ${typeBadgeClass}">${typeBadgeText}</span>
          <span class="message-count">${conn.messages.length} 条</span>
          ${savedIndicator}
        </div>
      </div>
    `;
    }));

    if (renderToken !== connectionListRenderToken) {
      return;
    }

    elements$8.connectionList.innerHTML = connectionHtml.join('');

    elements$8.connectionList.querySelectorAll('.connection-item').forEach(item => {
      item.addEventListener('click', () => {
        selectConnection(item.dataset.id);
      });
    });
  }

  async function selectConnection(connectionId) {
    const isSelected = setSelectedConnection(connectionId);

    if (callbacks$6.showListView) callbacks$6.showListView();
    if (callbacks$6.renderMessageList) callbacks$6.renderMessageList({ force: true });
    await renderConnectionList();

    if (isSelected && state.pendingFilters.length > 0) {
      elements$8.messageFilterContainer.style.display = 'block';
      elements$8.btnToggleFilter.classList.add('expanded');
      if (callbacks$6.renderFilterConditions) callbacks$6.renderFilterConditions();
    }
  }

  function handleStreamEvent(payload) {
    log('Handling stream event:', payload.type, payload);

    switch (payload.type) {
      case 'stream-connection':
        addConnection({
          id: payload.connectionId,
          url: payload.url,
          frameUrl: payload.frameUrl,
          isIframe: payload.isIframe,
          source: payload.source || 'unknown',
          status: 'connecting',
          createdAt: payload.timestamp,
          messages: []
        });
        log('Created connection:', payload.connectionId, payload.url);
        selectConnection(payload.connectionId);
        break;

      case 'stream-open':
        updateConnectionStatus(payload.connectionId, 'open');
        log('Connection opened:', payload.connectionId);
        renderConnectionList();
        break;

      case 'stream-message':
        addMessage(payload.connectionId, {
          id: payload.messageId,
          eventType: payload.eventType,
          data: payload.data,
          lastEventId: payload.lastEventId,
          timestamp: payload.timestamp
        });
        log('Added message #' + payload.messageId + ' to connection:', payload.connectionId);
        renderConnectionList();
        if (state.selectedConnectionId === payload.connectionId && callbacks$6.renderMessageList) {
          callbacks$6.renderMessageList();
        }
        break;

      case 'stream-error':
        updateConnectionStatus(payload.connectionId, 'error');
        renderConnectionList();
        break;

      case 'stream-close':
        updateConnectionStatus(payload.connectionId, 'closed');
        renderConnectionList();
        break;
    }
  }

  // Re-export state functions for use in this module
  function setSelectedConnection(connectionId) {
    if (state.selectedConnectionId === connectionId) {
      state.selectedConnectionId = null;
      state.selectedMessageId = null;
      return false;
    }
    state.selectedConnectionId = connectionId;
    state.selectedMessageId = null;
    state.pendingFilters = JSON.parse(JSON.stringify(state.messageFilters));
    return true;
  }

  function addConnection(connectionData) {
    state.connections[connectionData.id] = connectionData;
  }

  function addMessage(connectionId, messageData) {
    if (state.connections[connectionId]) {
      state.connections[connectionId].messages.push(messageData);
    }
  }

  function updateConnectionStatus(connectionId, status) {
    if (state.connections[connectionId]) {
      state.connections[connectionId].status = status;
    }
  }

  // View management module

  let elements$7 = {};

  function initViewManager(el) {
    elements$7 = el;
  }

  function showListView() {
    elements$7.messageListView.classList.add('active');
    elements$7.detailView.classList.remove('active');
  }

  function showDetailView() {
    elements$7.messageListView.classList.remove('active');
    elements$7.detailView.classList.add('active');
  }

  // Message rendering module


  let elements$6 = {};
  let callbacks$5 = {
    filterMessages: null,
    searchMessages: null
  };

  let lastRenderedConnectionId = null;
  let lastRenderedMessageCount = 0;
  let lastRenderSignature = '';
  let renderTimeout = null;
  let renderToken = 0;
  let jsonFieldContextMenu = null;

  function initMessageRenderer(el) {
    elements$6 = el;

    setupMessageListEventDelegation();
    setupJsonDetailEventDelegation();
  }

  function setCallbacks$5(cb) {
    callbacks$5 = { ...callbacks$5, ...cb };
  }

  function renderMessageList(options = {}) {
    const currentToken = ++renderToken;
    const connection = state.connections[state.selectedConnectionId];

    if (!connection || connection.messages.length === 0) {
      elements$6.messageTbody.innerHTML = '';
      elements$6.messageEmpty.style.display = 'flex';
      elements$6.messageTbody.parentElement.style.display = 'none';
      lastRenderedConnectionId = null;
      lastRenderedMessageCount = 0;
      lastRenderSignature = '';
      return;
    }

    elements$6.messageEmpty.style.display = 'none';
    elements$6.messageTbody.parentElement.style.display = 'flex';

    const filteredMessages = getFilteredMessages(connection);

    updateFilterStats(filteredMessages.length, connection.messages.length);

    const displayMessages = getDisplayMessages(filteredMessages);

    const currentConnectionId = state.selectedConnectionId;
    const currentMessageCount = displayMessages.length;
    const currentRenderSignature = getRenderSignature(currentConnectionId);

    const isConnectionChanged = currentConnectionId !== lastRenderedConnectionId;
    const isRenderStateChanged = currentRenderSignature !== lastRenderSignature;
    const isMessageCountReduced = currentMessageCount < lastRenderedMessageCount;
    const shouldFullRender = options.force ||
      isConnectionChanged ||
      isRenderStateChanged ||
      isMessageCountReduced;

    if (renderTimeout) {
      cancelAnimationFrame(renderTimeout);
    }

    renderTimeout = requestAnimationFrame(() => {
      if (currentToken !== renderToken || currentConnectionId !== state.selectedConnectionId) {
        return;
      }

      if (shouldFullRender) {
        renderAllMessages(displayMessages);
      } else {
        const isAutoScrolling = state.autoScrollToBottom && 
          elements$6.messageTbody.scrollTop + elements$6.messageTbody.clientHeight >= elements$6.messageTbody.scrollHeight - 50;

        renderIncrementalMessages(displayMessages, lastRenderedMessageCount, isAutoScrolling);
      }

      lastRenderedConnectionId = currentConnectionId;
      lastRenderedMessageCount = currentMessageCount;
      lastRenderSignature = currentRenderSignature;
    });
  }

  function getRenderSignature(connectionId) {
    const pinnedIds = Array.from(state.pinnedMessageIds[connectionId] || []).sort((a, b) => a - b);
    return JSON.stringify({
      filters: state.messageFilters,
      search: state.searchQuery,
      displayFieldPath: state.displayFieldPath,
      pinned: pinnedIds
    });
  }

  function renderAllMessages(messages) {
    const fragment = document.createDocumentFragment();

    messages.forEach(msg => {
      const row = createMessageRow(msg);
      fragment.appendChild(row);
    });

    elements$6.messageTbody.innerHTML = '';
    elements$6.messageTbody.appendChild(fragment);

    if (state.autoScrollToBottom) {
      elements$6.messageTbody.scrollTop = elements$6.messageTbody.scrollHeight;
    }
  }

  function renderIncrementalMessages(messages, previousCount, isAutoScrolling) {
    const newMessages = messages.slice(previousCount);

    if (newMessages.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();

    newMessages.forEach(msg => {
      const row = createMessageRow(msg);
      fragment.appendChild(row);
    });

    elements$6.messageTbody.appendChild(fragment);

    if (state.autoScrollToBottom && isAutoScrolling) {
      elements$6.messageTbody.scrollTop = elements$6.messageTbody.scrollHeight;
    }
  }

  function createMessageRow(msg) {
    const row = document.createElement('div');
    const time = formatTime(msg.timestamp);
    const hasSearch = state.searchQuery.length > 0;
    const isPinned = isMessagePinned(state.selectedConnectionId, msg.id);

    const isSelected = state.selectedMessageId === msg.id;

    row.className = `message-row ${hasSearch ? 'search-highlight' : ''} ${isPinned ? 'pinned' : ''} ${isSelected ? 'selected' : ''}`;
    row.dataset.id = msg.id;

    const idCell = document.createElement('div');
    idCell.className = 'message-cell col-id';
    idCell.textContent = `${isPinned ? '📌' : ''}${msg.id}`;

    const typeCell = document.createElement('div');
    typeCell.className = 'message-cell col-type';
    typeCell.innerHTML = hasSearch ? highlightSearchMatches(msg.eventType || '', state.searchQuery) : escapeHtml(msg.eventType || '');

    const dataCell = document.createElement('div');
    dataCell.className = 'message-cell col-data';
    const displayData = getMessageDisplayData(msg);
    dataCell.title = displayData.title;
    dataCell.classList.toggle('field-empty', displayData.isEmpty);
    dataCell.innerHTML = hasSearch
      ? highlightSearchMatches(displayData.text, state.searchQuery)
      : escapeHtml(displayData.text);

    const timeCell = document.createElement('div');
    timeCell.className = 'message-cell col-time';
    timeCell.textContent = time;

    row.appendChild(idCell);
    row.appendChild(typeCell);
    row.appendChild(dataCell);
    row.appendChild(timeCell);

    return row;
  }

  function setupMessageListEventDelegation() {
    elements$6.messageTbody.addEventListener('click', (e) => {
      const row = e.target.closest('.message-row');
      if (row) {
        const messageId = parseInt(row.dataset.id);
        showMessageDetail(messageId);
      }
    });
  }

  function showMessageDetail(messageId) {
    const connection = state.connections[state.selectedConnectionId];
    if (!connection) return;

    const message = connection.messages.find(m => m.id === messageId);
    if (!message) return;

    state.selectedMessageId = messageId;
    updateSelectedMessageRow(messageId);

    elements$6.detailTitle.textContent = `消息 #${messageId} - ${message.eventType}`;

    let formattedData;
    try {
      const parsed = JSON.parse(message.data);
      formattedData = renderCollapsibleJson(parsed);
    } catch (e) {
      formattedData = escapeHtml(message.data);
    }

    elements$6.detailJson.innerHTML = formattedData;
    updatePinButtonState();
    updateDetailNavButtons();
    showDetailView();
  }

  function updatePinButtonState() {
    const isPinned = isMessagePinned(state.selectedConnectionId, state.selectedMessageId);
    elements$6.btnPin.classList.toggle('active', isPinned);
    elements$6.btnPin.title = isPinned ? '取消置顶此消息' : '置顶此消息';
    updateDetailNavButtons();
  }

  function showAdjacentMessage(direction) {
    const adjacentMessage = getAdjacentMessage(direction);
    if (!adjacentMessage) return;

    showMessageDetail(adjacentMessage.id);
    scrollMessageRowIntoView(adjacentMessage.id);
  }

  function updateDetailNavButtons() {
    if (!elements$6.btnPrevMessage || !elements$6.btnNextMessage) return;

    const previousMessage = getAdjacentMessage(-1);
    const nextMessage = getAdjacentMessage(1);

    elements$6.btnPrevMessage.disabled = !previousMessage;
    elements$6.btnPrevMessage.title = previousMessage
      ? `查看上一条消息 #${previousMessage.id}`
      : '已经是第一条消息';

    elements$6.btnNextMessage.disabled = !nextMessage;
    elements$6.btnNextMessage.title = nextMessage
      ? `查看下一条消息 #${nextMessage.id}`
      : '已经是最后一条消息';
  }

  function updateFilterStats(filteredCount, totalCount) {
    if (state.messageFilters.length === 0) {
      elements$6.filterStats.textContent = '';
      return;
    }

    if (filteredCount === totalCount) {
      elements$6.filterStats.textContent = `显示全部 ${totalCount} 条消息`;
    } else {
      elements$6.filterStats.textContent = `显示 ${filteredCount}/${totalCount} 条消息`;
    }
  }

  function getFilteredMessages(connection) {
    let filteredMessages = connection.messages;
    if (callbacks$5.filterMessages) {
      filteredMessages = callbacks$5.filterMessages(connection.messages);
    }
    if (callbacks$5.searchMessages) {
      filteredMessages = callbacks$5.searchMessages(filteredMessages, state.searchQuery);
    }
    return filteredMessages;
  }

  function getCurrentDisplayMessages() {
    const connection = state.connections[state.selectedConnectionId];
    if (!connection) return [];

    return getDisplayMessages(getFilteredMessages(connection));
  }

  function getDisplayMessages(messages) {
    const pinnedMessages = messages.filter(msg => isMessagePinned(state.selectedConnectionId, msg.id));
    const normalMessages = messages.filter(msg => !isMessagePinned(state.selectedConnectionId, msg.id));
    return [...pinnedMessages, ...normalMessages];
  }

  function getAdjacentMessage(direction) {
    const displayMessages = getCurrentDisplayMessages();
    const currentIndex = displayMessages.findIndex(msg => msg.id === state.selectedMessageId);
    if (currentIndex === -1) return null;

    return displayMessages[currentIndex + direction] || null;
  }

  function scrollMessageRowIntoView(messageId) {
    const row = elements$6.messageTbody?.querySelector(`.message-row[data-id="${messageId}"]`);
    if (!row) return;

    row.scrollIntoView({ block: 'nearest' });
  }

  function updateSelectedMessageRow(messageId) {
    elements$6.messageTbody
      ?.querySelectorAll('.message-row.selected')
      .forEach(row => row.classList.remove('selected'));

    const row = elements$6.messageTbody?.querySelector(`.message-row[data-id="${messageId}"]`);
    row?.classList.add('selected');
  }

  function highlightSearchMatches(text, query) {
    text = String(text || '');
    if (!query) return escapeHtml(text);

    const escapedQuery = escapeRegex(query);
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    const escaped = escapeHtml(text);

    return escaped.replace(regex, '<span class="search-match">$1</span>');
  }

  function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getMessageDisplayData(msg) {
    const path = state.displayFieldPath.trim();
    if (!path) {
      return {
        text: msg.data || '',
        title: msg.data || '',
        isEmpty: false
      };
    }

    try {
      const parsed = JSON.parse(msg.data);
      const value = getValueByPath(parsed, path);

      if (value === undefined) {
        return {
          text: '字段不存在',
          title: `未找到字段：${path}`,
          isEmpty: true
        };
      }

      const text = formatDisplayFieldValue(value);
      return {
        text,
        title: text,
        isEmpty: false
      };
    } catch (error) {
      return {
        text: '非 JSON 数据',
        title: '当前消息无法解析为 JSON',
        isEmpty: true
      };
    }
  }

  function getValueByPath(value, path) {
    const keys = path.split('.').filter(Boolean);
    let current = value;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (Array.isArray(current)) {
        if (/^\d+$/.test(key)) {
          current = current[Number(key)];
        } else {
          const values = current
            .map(item => getValueByPath(item, key))
            .filter(item => item !== undefined);
          current = values.length > 0 ? values : undefined;
        }
        continue;
      }

      current = current[key];
    }

    return current;
  }

  function formatDisplayFieldValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  }

  function setupJsonDetailEventDelegation() {
    elements$6.detailJson.addEventListener('click', (e) => {
      const toggle = e.target.closest('.json-toggle');
      if (!toggle) return;

      const node = toggle.closest('.json-node');
      if (!node) return;

      const collapsed = node.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '▶' : '▼';
      toggle.title = collapsed ? '展开' : '折叠';
    });

    elements$6.detailJson.addEventListener('contextmenu', (e) => {
      const key = e.target.closest('.json-key[data-field-path]');
      if (!key) return;

      e.preventDefault();
      showJsonFieldContextMenu(e.clientX, e.clientY, key.dataset.fieldPath);
    });

    document.addEventListener('click', hideJsonFieldContextMenu);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideJsonFieldContextMenu();
      }
    });
    document.addEventListener('scroll', hideJsonFieldContextMenu, true);
  }

  function renderCollapsibleJson(value) {
    return `<div class="json-tree">${renderJsonValue(value, 0, true, '')}</div>`;
  }

  function renderJsonValue(value, depth = 0, isRoot = false, path = '') {
    if (Array.isArray(value)) {
      return renderJsonCollection(value, depth, isRoot, '[', ']', false, path);
    }

    if (value && typeof value === 'object') {
      return renderJsonCollection(Object.entries(value), depth, isRoot, '{', '}', true, path);
    }

    return renderJsonPrimitive(value);
  }

  function renderJsonCollection(collection, depth, isRoot, openChar, closeChar, isObject = false, path = '') {
    const count = collection.length;
    if (count === 0) {
      return `<span class="json-bracket">${openChar}${closeChar}</span>`;
    }

    const summary = isObject ? `${count} ${count === 1 ? 'key' : 'keys'}` : `${count} ${count === 1 ? 'item' : 'items'}`;
    const toggle = `<button class="json-toggle" type="button" title="折叠">▼</button>`;
    const openLine = `<span class="json-bracket">${openChar}</span>`;
    const closeLine = `${indent(depth)}<span class="json-close-line json-bracket">${closeChar}</span>`;

    const children = collection.map((item, index) => {
      const isLast = index === count - 1;
      const comma = isLast ? '' : '<span class="json-comma">,</span>';

      if (isObject) {
        const [key, childValue] = item;
        const childPath = path ? `${path}.${key}` : key;
        return `${indent(depth + 1)}<span class="json-key" data-field-path="${escapeHtml(childPath)}" title="右键复制字段路径">"${escapeHtml(key)}"</span>: ${renderJsonValue(childValue, depth + 1, false, childPath)}${comma}`;
      }

      const childPath = path ? `${path}.${index}` : String(index);
      return `${indent(depth + 1)}${renderJsonValue(item, depth + 1, false, childPath)}${comma}`;
    }).join('\n');

    return `<span class="json-node ${isRoot ? 'json-root-node' : ''}">${toggle}${openLine}<span class="json-collapsed-summary"> ${escapeHtml(summary)} ${closeChar}</span><span class="json-children">\n${children}\n${closeLine}</span></span>`;
  }

  function renderJsonPrimitive(value) {
    if (typeof value === 'string') {
      return `<span class="json-string">"${escapeHtml(value)}"</span>`;
    }

    if (typeof value === 'number') {
      return `<span class="json-number">${escapeHtml(String(value))}</span>`;
    }

    if (typeof value === 'boolean') {
      return `<span class="json-boolean">${value}</span>`;
    }

    if (value === null) {
      return '<span class="json-null">null</span>';
    }

    return `<span class="json-string">"${escapeHtml(String(value))}"</span>`;
  }

  function indent(depth) {
    return '  '.repeat(depth);
  }

  function showJsonFieldContextMenu(x, y, fieldPath) {
    hideJsonFieldContextMenu();

    jsonFieldContextMenu = document.createElement('div');
    jsonFieldContextMenu.className = 'json-field-context-menu';
    jsonFieldContextMenu.innerHTML = `
    <button type="button" class="json-field-context-menu-item">复制字段路径</button>
    <div class="json-field-context-menu-path">${escapeHtml(fieldPath)}</div>
  `;

    const copyButton = jsonFieldContextMenu.querySelector('.json-field-context-menu-item');
    copyButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      const success = await copyToClipboard(fieldPath);
      copyButton.textContent = success ? '已复制' : '复制失败';
      setTimeout(hideJsonFieldContextMenu, success ? 500 : 900);
    });

    document.body.appendChild(jsonFieldContextMenu);

    const rect = jsonFieldContextMenu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    jsonFieldContextMenu.style.left = `${Math.max(8, left)}px`;
    jsonFieldContextMenu.style.top = `${Math.max(8, top)}px`;
  }

  function hideJsonFieldContextMenu() {
    if (jsonFieldContextMenu) {
      jsonFieldContextMenu.remove();
      jsonFieldContextMenu = null;
    }
  }

  // Filter management module


  let elements$5 = {};
  let callbacks$4 = {
    renderMessageList: null,
    updateFilterStats: null
  };

  function initFilterManager(el) {
    elements$5 = el;
  }

  function setCallbacks$4(cb) {
    callbacks$4 = { ...callbacks$4, ...cb };
  }

  function getAvailableFields() {
    const connection = state.connections[state.selectedConnectionId];
    if (!connection || !connection.messages) {
      return [];
    }

    const fieldsSet = new Set();

    connection.messages.forEach(msg => {
      try {
        const parsed = JSON.parse(msg.data);
        extractFields(parsed, '', fieldsSet);
      } catch (e) {
        // Not JSON, skip
      }
    });

    return Array.from(fieldsSet).sort();
  }

  function extractFields(obj, prefix = '', fields = new Set()) {
    if (obj === null || obj === undefined) {
      return fields;
    }

    if (Array.isArray(obj)) {
      obj.forEach(item => {
        if (item && typeof item === 'object') {
          extractFields(item, prefix, fields);
        }
      });
      return fields;
    }

    if (typeof obj === 'object') {
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const fieldPath = prefix ? `${prefix}.${key}` : key;
          fields.add(fieldPath);

          if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            extractFields(obj[key], fieldPath, fields);
          } else if (Array.isArray(obj[key])) {
            obj[key].forEach(item => {
              if (item && typeof item === 'object') {
                extractFields(item, fieldPath, fields);
              }
            });
          }
        }
      }
    }

    return fields;
  }

  function getNestedValue(obj, path) {
    const keys = path.split('.');
    let value = obj;

    for (const key of keys) {
      if (value === null || value === undefined) {
        return undefined;
      }

      if (Array.isArray(value)) {
        const values = value
          .map(item => getNestedValue(item, key))
          .filter(item => item !== undefined);
        value = values.length > 0 ? values : undefined;
        continue;
      }

      value = value[key];
    }

    return value;
  }

  function filterMessages(messages) {
    if (state.messageFilters.length === 0) {
      return messages;
    }

    return messages.filter(msg => {
      try {
        const parsed = JSON.parse(msg.data);

        return state.messageFilters.every(filter => {
          const fieldValue = getNestedValue(parsed, filter.field);

          if (fieldValue === undefined) {
            return false;
          }

          const fieldValues = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
          const filterValueStr = String(filter.value);

          return fieldValues.some(value => {
            const fieldValueStr = String(value);

            if (filter.mode === 'equals') {
              return fieldValueStr === filterValueStr;
            } else if (filter.mode === 'contains') {
              return fieldValueStr.includes(filterValueStr);
            }

            return true;
          });
        });
      } catch (e) {
        return false;
      }
    });
  }

  function addFilterCondition() {
    const availableFields = getAvailableFields();
    if (availableFields.length === 0) {
      alert('当前没有可用的字段，请先选择连接并等待消息数据。');
      return;
    }

    state.pendingFilters.push({
      field: '',
      mode: 'equals',
      value: ''
    });

    elements$5.messageFilterContainer.style.display = 'block';
    elements$5.btnToggleFilter.classList.add('expanded');
    renderFilterConditions();

    const lastInput = elements$5.filterConditions.querySelector(
      `.filter-field-input[data-index="${state.pendingFilters.length - 1}"]`
    );
    if (lastInput) {
      lastInput.focus();
    }
  }

  function removeFilterCondition(index) {
    state.pendingFilters.splice(index, 1);
    state.messageFilters = JSON.parse(JSON.stringify(state.pendingFilters));
    renderFilterConditions();
    if (callbacks$4.renderMessageList) callbacks$4.renderMessageList();
  }

  function clearAllFilters() {
    state.pendingFilters = [];
    state.messageFilters = [];
    elements$5.messageFilterContainer.style.display = 'none';
    elements$5.btnToggleFilter.classList.remove('expanded');
    renderFilterConditions();
    if (callbacks$4.renderMessageList) callbacks$4.renderMessageList();
  }

  function applyFilters() {
    state.messageFilters = JSON.parse(JSON.stringify(state.pendingFilters));
    if (callbacks$4.renderMessageList) callbacks$4.renderMessageList();
  }

  function updatePendingFilterCondition(index, field, mode, value) {
    if (state.pendingFilters[index]) {
      state.pendingFilters[index].field = field;
      state.pendingFilters[index].mode = mode;
      state.pendingFilters[index].value = value;
    }
  }

  function renderFilterConditions() {
    const availableFields = getAvailableFields();

    elements$5.filterConditions.innerHTML = state.pendingFilters.map((filter, index) => {
      return `
      <div class="filter-row" data-index="${index}">
        <div class="filter-field-autocomplete" data-index="${index}">
          <input type="text" class="filter-field-input" data-index="${index}"
                 placeholder="输入或选择字段..."
                 value="${escapeHtml(filter.field)}"
                 autocomplete="off">
          <div class="filter-field-dropdown" data-index="${index}"></div>
        </div>
        <select class="filter-mode-select" data-index="${index}">
          <option value="equals" ${filter.mode === 'equals' ? 'selected' : ''}>全等</option>
          <option value="contains" ${filter.mode === 'contains' ? 'selected' : ''}>包含</option>
        </select>
        <input type="text" class="filter-value-input" data-index="${index}"
               placeholder="输入筛选值..." value="${escapeHtml(filter.value)}">
        <button class="filter-remove-btn" data-index="${index}" title="删除">×</button>
      </div>
    `;
    }).join('');

    setupFilterEventListeners(availableFields);
  }

  function setupFilterEventListeners(availableFields) {
    elements$5.filterConditions.querySelectorAll('.filter-field-input').forEach(input => {
      const index = parseInt(input.dataset.index);
      const dropdown = input.parentElement.querySelector('.filter-field-dropdown');
      let activeIndex = -1;
      let currentMatches = [];

      const showDropdown = () => {
        currentMatches = getFuzzyMatchedFields(availableFields, input.value);
        activeIndex = currentMatches.length > 0 ? 0 : -1;

        if (currentMatches.length > 0) {
          dropdown.innerHTML = currentMatches.map((field, itemIndex) =>
            `<div class="dropdown-item ${itemIndex === activeIndex ? 'active' : ''}" data-value="${escapeHtml(field)}">${escapeHtml(field)}</div>`
          ).join('');
          dropdown.style.display = 'block';
          setupDropdownItemListeners();
        } else {
          dropdown.innerHTML = '<div class="dropdown-empty">无匹配字段</div>';
          dropdown.style.display = 'block';
        }
      };

      const setupDropdownItemListeners = () => {
        dropdown.querySelectorAll('.dropdown-item').forEach((item, itemIndex) => {
          item.addEventListener('mouseenter', () => {
            activeIndex = itemIndex;
            updateActiveDropdownItem(dropdown, activeIndex);
          });

          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectField(item.dataset.value);
          });
        });
      };

      const selectField = (field) => {
        input.value = field;
        dropdown.style.display = 'none';
        const filter = state.pendingFilters[index];
        updatePendingFilterCondition(index, field, filter.mode, filter.value);
      };

      input.addEventListener('focus', showDropdown);
      input.addEventListener('input', (e) => {
        const filter = state.pendingFilters[index];
        updatePendingFilterCondition(index, e.target.value, filter.mode, filter.value);
        showDropdown();
      });

      input.addEventListener('keydown', (e) => {
        if (dropdown.style.display !== 'block') return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (currentMatches.length === 0) return;
          activeIndex = (activeIndex + 1) % currentMatches.length;
          updateActiveDropdownItem(dropdown, activeIndex);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (currentMatches.length === 0) return;
          activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length;
          updateActiveDropdownItem(dropdown, activeIndex);
        } else if (e.key === 'Enter') {
          if (activeIndex >= 0 && currentMatches[activeIndex]) {
            e.preventDefault();
            selectField(currentMatches[activeIndex]);
          }
        } else if (e.key === 'Escape') {
          dropdown.style.display = 'none';
        }
      });

      input.addEventListener('blur', () => {
        setTimeout(() => {
          dropdown.style.display = 'none';
        }, 200);
      });
    });

    elements$5.filterConditions.querySelectorAll('.filter-mode-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        const filter = state.pendingFilters[index];
        updatePendingFilterCondition(index, filter.field, e.target.value, filter.value);
      });
    });

    elements$5.filterConditions.querySelectorAll('.filter-value-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const index = parseInt(e.target.dataset.index);
        const filter = state.pendingFilters[index];
        updatePendingFilterCondition(index, filter.field, filter.mode, e.target.value);
      });

      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          applyFilters();
        }
      });
    });

    elements$5.filterConditions.querySelectorAll('.filter-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        removeFilterCondition(index);
      });
    });
  }

  function getFuzzyMatchedFields(fields, query) {
    const normalizedQuery = normalizeFieldSearch(query);
    if (!normalizedQuery) {
      return fields;
    }

    return fields
      .map(field => ({
        field,
        score: getFieldMatchScore(field, normalizedQuery)
      }))
      .filter(item => item.score !== Infinity)
      .sort((a, b) => a.score - b.score || a.field.length - b.field.length || a.field.localeCompare(b.field))
      .map(item => item.field);
  }

  function normalizeFieldSearch(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getFieldMatchScore(field, query) {
    const normalizedField = field.toLowerCase();
    const compactField = normalizedField.replace(/[._\-\s]/g, '');
    const compactQuery = query.replace(/[._\-\s]/g, '');
    const queryParts = query.split(/[.\s]+/).filter(Boolean);

    if (normalizedField === query) return 0;
    if (normalizedField.startsWith(query)) return 1;
    if (normalizedField.includes(query)) return 2 + normalizedField.indexOf(query) / 1000;
    if (compactField.includes(compactQuery)) return 3 + compactField.indexOf(compactQuery) / 1000;

    if (queryParts.length > 1 && queryParts.every(part => normalizedField.includes(part))) {
      return 4;
    }

    const fuzzyScore = getSubsequenceScore(compactField, compactQuery);
    if (fuzzyScore !== Infinity) {
      return 5 + fuzzyScore / 1000;
    }

    return Infinity;
  }

  function getSubsequenceScore(text, query) {
    if (!query) return 0;

    let queryIndex = 0;
    let firstMatch = -1;
    let lastMatch = -1;

    for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex++) {
      if (text[textIndex] === query[queryIndex]) {
        if (firstMatch === -1) firstMatch = textIndex;
        lastMatch = textIndex;
        queryIndex++;
      }
    }

    if (queryIndex !== query.length) {
      return Infinity;
    }

    return (lastMatch - firstMatch) + firstMatch;
  }

  function updateActiveDropdownItem(dropdown, activeIndex) {
    dropdown.querySelectorAll('.dropdown-item').forEach((item, itemIndex) => {
      item.classList.toggle('active', itemIndex === activeIndex);
      if (itemIndex === activeIndex) {
        item.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function toggleFilterContainer() {
    const isHidden = elements$5.messageFilterContainer.style.display === 'none';
    elements$5.messageFilterContainer.style.display = isHidden ? 'block' : 'none';

    if (isHidden) {
      elements$5.btnToggleFilter.classList.add('expanded');
    } else {
      elements$5.btnToggleFilter.classList.remove('expanded');
    }
  }

  // Preset management module


  const PRESETS_STORAGE_KEY = 'stream-panel-filter-presets';

  let elements$4 = {};
  let callbacks$3 = {
    renderMessageList: null,
    renderFilterConditions: null
  };

  function initPresetManager(el) {
    elements$4 = el;
  }

  function setCallbacks$3(cb) {
    callbacks$3 = { ...callbacks$3, ...cb };
  }

  function loadPresets() {
    try {
      const stored = localStorage.getItem(PRESETS_STORAGE_KEY);
      const presets = stored ? JSON.parse(stored) : [];
      return Array.isArray(presets) ? presets : [];
    } catch (error) {
      console.warn('[Stream Panel] Failed to load filter presets:', error);
      return [];
    }
  }

  function savePresetsToStorage(presets) {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  }

  function formatFilterSummary(filters) {
    return filters
      .map(f => `${escapeHtml(f.field)} ${f.mode === 'equals' ? '=' : '包含'} "${escapeHtml(f.value)}"`)
      .join(' AND ');
  }

  function showSavePresetModal() {
    if (state.pendingFilters.length === 0) {
      alert('请先添加筛选条件');
      return;
    }

    elements$4.presetModalTitle.textContent = '保存筛选预设';
    elements$4.presetModalBody.innerHTML = `
    <div class="preset-form">
      <div class="form-group">
        <label class="form-label">预设名称</label>
        <input type="text" id="preset-name-input" class="form-input" placeholder="输入预设名称..." autofocus>
      </div>
      <div class="form-group">
        <label class="form-label">描述（可选）</label>
        <input type="text" id="preset-desc-input" class="form-input" placeholder="输入预设描述...">
      </div>
      <div class="form-group">
        <label class="form-label">筛选条件预览</label>
        <div style="font-size: 11px; color: var(--text-secondary); padding: 8px; background: var(--bg-secondary); border-radius: 4px;">
          ${formatFilterSummary(state.pendingFilters)}
        </div>
      </div>
    </div>
  `;

    elements$4.presetModalFooter.innerHTML = `
    <button class="modal-btn" id="preset-cancel-btn">取消</button>
    <button class="modal-btn primary" id="preset-save-btn">保存</button>
  `;

    elements$4.presetModal.style.display = 'flex';

    document.getElementById('preset-cancel-btn').addEventListener('click', closePresetModal);
    document.getElementById('preset-save-btn').addEventListener('click', () => {
      const name = document.getElementById('preset-name-input').value.trim();
      const description = document.getElementById('preset-desc-input').value.trim();

      if (!name) {
        alert('请输入预设名称');
        return;
      }

      const presets = loadPresets();
      presets.push({
        id: Date.now().toString(),
        name,
        description,
        filters: JSON.parse(JSON.stringify(state.pendingFilters)),
        createdAt: new Date().toISOString()
      });

      savePresetsToStorage(presets);
      closePresetModal();
      alert('预设保存成功');
    });

    document.getElementById('preset-name-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        document.getElementById('preset-save-btn').click();
      }
    });
  }

  function showLoadPresetModal() {
    const presets = loadPresets();

    if (presets.length === 0) {
      alert('暂无已保存的预设');
      return;
    }

    elements$4.presetModalTitle.textContent = '加载筛选预设';
    elements$4.presetModalBody.innerHTML = `
    <div class="preset-list">
      ${presets.map(preset => `
        <div class="preset-item" data-preset-id="${preset.id}">
          <div class="preset-info">
            <div class="preset-name">${escapeHtml(preset.name)}</div>
            <div class="preset-description">
              ${preset.description ? escapeHtml(preset.description) : ''}
              <br>
              <span style="font-size: 10px; color: var(--text-muted);">
                ${formatFilterSummary(preset.filters)}
              </span>
            </div>
          </div>
          <div class="preset-actions">
            <button class="preset-btn load-preset-btn" data-preset-id="${preset.id}">加载</button>
            <button class="preset-btn delete-preset-btn" data-preset-id="${preset.id}">删除</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

    elements$4.presetModalFooter.innerHTML = `
    <button class="modal-btn" id="preset-close-btn">关闭</button>
  `;

    elements$4.presetModal.style.display = 'flex';

    document.getElementById('preset-close-btn').addEventListener('click', closePresetModal);

    document.querySelectorAll('.load-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const presetId = btn.dataset.presetId;
        const preset = presets.find(p => p.id === presetId);
        if (preset) {
          state.pendingFilters = JSON.parse(JSON.stringify(preset.filters));
          state.messageFilters = JSON.parse(JSON.stringify(preset.filters));
          elements$4.messageFilterContainer.style.display = 'block';
          elements$4.btnToggleFilter.classList.add('expanded');
          if (callbacks$3.renderFilterConditions) callbacks$3.renderFilterConditions();
          if (callbacks$3.renderMessageList) callbacks$3.renderMessageList();
          closePresetModal();
        }
      });
    });

    document.querySelectorAll('.delete-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('确定要删除此预设吗？')) {
          const presetId = btn.dataset.presetId;
          const updatedPresets = presets.filter(p => p.id !== presetId);
          savePresetsToStorage(updatedPresets);
          showLoadPresetModal();
        }
      });
    });
  }

  function closePresetModal() {
    elements$4.presetModal.style.display = 'none';
  }

  // Statistics management module


  let elements$3 = {};

  function initStatisticsManager(el) {
    elements$3 = el;
  }

  function calculateStatistics() {
    const connections = Object.values(state.connections);
    const totalConnections = connections.length;
    const activeConnections = connections.filter(c => c.status === 'open').length;
    const totalMessages = connections.reduce((sum, c) => sum + c.messages.length, 0);
    const avgMessages = totalConnections > 0 ? Math.round(totalMessages / totalConnections) : 0;

    return {
      totalConnections,
      activeConnections,
      totalMessages,
      avgMessages,
      connections: connections.map(conn => ({
        id: conn.id,
        url: conn.url,
        status: conn.status,
        messageCount: conn.messages.length,
        createdAt: conn.createdAt,
        duration: Date.now() - conn.createdAt
      }))
    };
  }

  function showStatisticsModal() {
    const stats = calculateStatistics();

    document.getElementById('stat-total-connections').textContent = stats.totalConnections;
    document.getElementById('stat-active-connections').textContent = stats.activeConnections;
    document.getElementById('stat-total-messages').textContent = stats.totalMessages;
    document.getElementById('stat-avg-messages').textContent = stats.avgMessages;

    const statsConnectionList = document.getElementById('stats-connection-list');

    if (stats.connections.length === 0) {
      statsConnectionList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">暂无连接数据</div>';
    } else {
      statsConnectionList.innerHTML = stats.connections.map(conn => `
      <div class="stats-connection-item">
        <div class="stats-connection-header">
          <div class="stats-connection-url" title="${escapeHtml(conn.url)}">${escapeHtml(getUrlPath(conn.url))}</div>
          <span class="stats-connection-status status-${conn.status}">${getStatusText(conn.status)}</span>
        </div>
        <div class="stats-connection-details">
          <div class="stats-detail-item">
            <span class="stats-detail-label">消息数</span>
            <span class="stats-detail-value">${conn.messageCount}</span>
          </div>
          <div class="stats-detail-item">
            <span class="stats-detail-label">持续时间</span>
            <span class="stats-detail-value">${formatDuration(conn.duration)}</span>
          </div>
          <div class="stats-detail-item">
            <span class="stats-detail-label">ID</span>
            <span class="stats-detail-value">${conn.id.substring(0, 8)}...</span>
          </div>
        </div>
      </div>
    `).join('');
    }

    elements$3.statsModal.style.display = 'flex';
  }

  function closeStatisticsModal() {
    elements$3.statsModal.style.display = 'none';
  }

  // Event handlers module


  let elements$2 = {};
  let port$1 = null;
  let callbacks$2 = {
    renderConnectionList: null,
    renderMessageList: null,
    showMessageDetail: null,
    showAdjacentMessage: null,
    toggleFilterContainer: null,
    handleExport: null,
    handleImport: null,
    showSavePresetModal: null,
    showLoadPresetModal: null,
    closePresetModal: null,
    showStatisticsModal: null,
    closeStatisticsModal: null
  };

  function initEventHandlers(el, connectionPort) {
    elements$2 = el;
    port$1 = connectionPort;
    setupToolbarHandlers();
    setupFilterHandlers();
    setupExportHandlers();
    setupPresetHandlers();
    setupStatsHandlers();
    setupSavedConnectionsHandlers();
    setupDetailHandlers();
    setupResizerHandlers();
    setupSearchHandlers();
    setupTextDecodeHandlers();
    setupModalClickHandlers();
  }

  function setCallbacks$2(cb) {
    callbacks$2 = { ...callbacks$2, ...cb };
  }

  function setupToolbarHandlers() {
    elements$2.btnImport.addEventListener('click', () => {
      elements$2.importFileInput.click();
    });

    elements$2.importFileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (file && callbacks$2.handleImport) {
        await callbacks$2.handleImport(file);
      }
      e.target.value = '';
    });

    elements$2.btnClear.addEventListener('click', () => {
      clearAllData();
      if (callbacks$2.renderConnectionList) callbacks$2.renderConnectionList();
      if (callbacks$2.renderMessageList) callbacks$2.renderMessageList();
      showListView();
      port$1.postMessage({ type: 'clear' });
    });

    elements$2.filterInput.addEventListener('input', (e) => {
      setFilter(e.target.value);
      if (callbacks$2.renderConnectionList) callbacks$2.renderConnectionList();
    });

    elements$2.requestTypeFilter.addEventListener('change', (e) => {
      setRequestTypeFilter(e.target.value);
      if (callbacks$2.renderConnectionList) callbacks$2.renderConnectionList();
    });

    elements$2.displayFieldInput.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    elements$2.displayFieldInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });

    elements$2.displayFieldInput.addEventListener('input', (e) => {
      setDisplayFieldPath(e.target.value.trim());
      elements$2.btnClearDisplayField.style.display = state.displayFieldPath ? 'flex' : 'none';
      if (callbacks$2.renderMessageList) callbacks$2.renderMessageList({ force: true });
    });

    elements$2.btnClearDisplayField.addEventListener('click', (e) => {
      e.stopPropagation();
      setDisplayFieldPath('');
      elements$2.displayFieldInput.value = '';
      elements$2.btnClearDisplayField.style.display = 'none';
      if (callbacks$2.renderMessageList) callbacks$2.renderMessageList({ force: true });
      elements$2.displayFieldInput.focus();
    });

    elements$2.btnToggleFilter.addEventListener('click', () => {
      if (callbacks$2.toggleFilterContainer) callbacks$2.toggleFilterContainer();
    });

    elements$2.btnScrollTop.addEventListener('click', () => {
      elements$2.messageTbody.scrollTop = 0;
    });

    elements$2.btnAutoScroll.addEventListener('click', () => {
      const newState = !state.autoScrollToBottom;
      setAutoScrollToBottom(newState);
      elements$2.btnAutoScroll.classList.toggle('active', newState);
      if (newState) {
        elements$2.messageTbody.scrollTop = elements$2.messageTbody.scrollHeight;
      }
    });
  }

  function setupFilterHandlers() {
    elements$2.btnAddFilter.addEventListener('click', () => {
      // This will be called from filterManager
      document.dispatchEvent(new CustomEvent('addFilter'));
    });

    elements$2.btnApplyFilters.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('applyFilters'));
    });

    elements$2.btnClearFilters.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('clearFilters'));
    });
  }

  function setupExportHandlers() {
    elements$2.btnExport.addEventListener('click', (e) => {
      e.stopPropagation();
      elements$2.exportDropdown.classList.toggle('open');
    });

    elements$2.exportMenu.querySelectorAll('.export-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const exportType = item.dataset.export;
        if (callbacks$2.handleExport) callbacks$2.handleExport(exportType);
        elements$2.exportDropdown.classList.remove('open');
      });
    });

    document.addEventListener('click', (e) => {
      if (!elements$2.exportDropdown.contains(e.target)) {
        elements$2.exportDropdown.classList.remove('open');
      }
    });
  }

  function setupPresetHandlers() {
    elements$2.btnSavePreset.addEventListener('click', () => {
      if (callbacks$2.showSavePresetModal) callbacks$2.showSavePresetModal();
    });
    elements$2.btnLoadPreset.addEventListener('click', () => {
      if (callbacks$2.showLoadPresetModal) callbacks$2.showLoadPresetModal();
    });
    elements$2.presetModalClose.addEventListener('click', () => {
      if (callbacks$2.closePresetModal) callbacks$2.closePresetModal();
    });
  }

  function setupStatsHandlers() {
    elements$2.btnStats.addEventListener('click', () => {
      if (callbacks$2.showStatisticsModal) callbacks$2.showStatisticsModal();
    });
    elements$2.statsModalClose.addEventListener('click', () => {
      if (callbacks$2.closeStatisticsModal) callbacks$2.closeStatisticsModal();
    });
  }

  function setupSavedConnectionsHandlers() {
    elements$2.btnSaveConnection.addEventListener('click', () => {
      if (callbacks$2.showSaveConnectionModal) callbacks$2.showSaveConnectionModal();
    });
    elements$2.btnSavedConnections.addEventListener('click', () => {
      if (callbacks$2.showSavedConnectionsModal) callbacks$2.showSavedConnectionsModal();
    });
    elements$2.savedConnectionsModalClose.addEventListener('click', () => {
      if (callbacks$2.closeSavedConnectionsModal) callbacks$2.closeSavedConnectionsModal();
    });
    elements$2.btnCloseSavedModal.addEventListener('click', () => {
      if (callbacks$2.closeSavedConnectionsModal) callbacks$2.closeSavedConnectionsModal();
    });
    elements$2.btnDeleteAllSaved.addEventListener('click', () => {
      if (callbacks$2.deleteAllSavedConnections) callbacks$2.deleteAllSavedConnections();
    });
  }

  function setupDetailHandlers() {
    elements$2.btnBack.addEventListener('click', () => {
      showListView();
    });

    elements$2.btnPrevMessage.addEventListener('click', () => {
      if (callbacks$2.showAdjacentMessage) {
        callbacks$2.showAdjacentMessage(-1);
      }
    });

    elements$2.btnNextMessage.addEventListener('click', () => {
      if (callbacks$2.showAdjacentMessage) {
        callbacks$2.showAdjacentMessage(1);
      }
    });

    elements$2.btnCopy.addEventListener('click', async () => {
      const connection = state.connections[state.selectedConnectionId];
      if (!connection) return;

      const message = connection.messages.find(m => m.id === state.selectedMessageId);
      if (!message) return;

      const success = await copyToClipboard(message.data);
      if (success) {
        alert('消息数据已复制到剪贴板！');
      } else {
        alert('复制失败，请重试。');
      }
    });

    elements$2.btnPin.addEventListener('click', () => {
      togglePinnedMessage(state.selectedConnectionId, state.selectedMessageId);
      if (callbacks$2.updatePinButtonState) {
        callbacks$2.updatePinButtonState();
      }
      if (callbacks$2.renderMessageList) {
        callbacks$2.renderMessageList({ force: true });
      }
    });
  }

  function setupResizerHandlers() {
    const resizer = document.querySelector('.resizer');
    const leftPanel = document.querySelector('.left-panel');

    let isResizing = false;

    resizer.addEventListener('mousedown', () => {
      isResizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;

      const newWidth = e.clientX;
      if (newWidth >= 150 && newWidth <= 400) {
        leftPanel.style.width = newWidth + 'px';
      }
    });

    document.addEventListener('mouseup', () => {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  function setupSearchHandlers() {
    elements$2.messageSearchInput.addEventListener('input', (e) => {
      setSearchQuery(e.target.value);
      elements$2.btnClearSearch.style.display = state.searchQuery ? 'block' : 'none';
      if (callbacks$2.renderMessageList) callbacks$2.renderMessageList();
    });

    elements$2.btnClearSearch.addEventListener('click', () => {
      setSearchQuery('');
      elements$2.messageSearchInput.value = '';
      elements$2.btnClearSearch.style.display = 'none';
      if (callbacks$2.renderMessageList) callbacks$2.renderMessageList();
    });
  }

  function setupTextDecodeHandlers() {
    elements$2.btnTextDecode.addEventListener('click', () => {
      elements$2.textDecodeModal.style.display = 'flex';
      elements$2.textDecodeInput.focus();
      updateTextDecodeOutput();
    });

    elements$2.textDecodeModalClose.addEventListener('click', closeTextDecodeModal);

    elements$2.textDecodeInput.addEventListener('input', updateTextDecodeOutput);

    elements$2.textDecodeClearBtn.addEventListener('click', () => {
      elements$2.textDecodeInput.value = '';
      elements$2.textDecodeOutput.value = '';
      elements$2.textDecodeInput.focus();
    });

    elements$2.textDecodeCopyBtn.addEventListener('click', async () => {
      const success = await copyToClipboard(elements$2.textDecodeOutput.value);
      elements$2.textDecodeCopyBtn.textContent = success ? '已复制' : '复制失败';
      setTimeout(() => {
        elements$2.textDecodeCopyBtn.textContent = '复制结果';
      }, 900);
    });
  }

  function updateTextDecodeOutput() {
    elements$2.textDecodeOutput.value = decodeEscapedText(elements$2.textDecodeInput.value);
  }

  function closeTextDecodeModal() {
    elements$2.textDecodeModal.style.display = 'none';
  }

  function decodeEscapedText(text) {
    if (!text) return '';

    const trimmed = text.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        // Fall back to tolerant decoding below.
      }
    }

    return text
      .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => {
        const codePoint = parseInt(hex, 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
      })
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }

  function setupModalClickHandlers() {
    elements$2.presetModal.addEventListener('click', (e) => {
      if (e.target === elements$2.presetModal) {
        if (callbacks$2.closePresetModal) callbacks$2.closePresetModal();
      }
    });

    elements$2.statsModal.addEventListener('click', (e) => {
      if (e.target === elements$2.statsModal) {
        if (callbacks$2.closeStatisticsModal) callbacks$2.closeStatisticsModal();
      }
    });

    elements$2.savedConnectionsModal.addEventListener('click', (e) => {
      if (e.target === elements$2.savedConnectionsModal) {
        if (callbacks$2.closeSavedConnectionsModal) callbacks$2.closeSavedConnectionsModal();
      }
    });

    elements$2.textDecodeModal.addEventListener('click', (e) => {
      if (e.target === elements$2.textDecodeModal) {
        closeTextDecodeModal();
      }
    });
  }

  // Saved connections management module


  let elements$1 = {};
  let callbacks$1 = {
    renderConnectionList: null,
    renderMessageList: null,
    selectConnection: null
  };

  function initSavedConnectionsManager(el) {
    elements$1 = el;
  }

  function setCallbacks$1(cb) {
    callbacks$1 = { ...callbacks$1, ...cb };
  }

  async function showSaveConnectionModal() {
    const connection = state.connections[state.selectedConnectionId];
    if (!connection) {
      alert('请先选择一个连接');
      return;
    }

    if (connection.messages.length === 0) {
      alert('此连接没有消息数据');
      return;
    }

    if (connection.status === 'archived' || connection.savedId) {
      alert('此连接已从数据库加载，无需再次保存');
      return;
    }

    const existing = await isConnectionSaved(connection.id);
    const defaultName = formatDateTime(connection.createdAt);

    elements$1.presetModalTitle.textContent = '保存连接';
    elements$1.presetModalBody.innerHTML = `
    <div class="preset-form">
      <div class="form-group">
        <label class="form-label">连接名称</label>
        <input type="text" id="connection-name-input" class="form-input"
               placeholder="输入连接名称..."
               value="${existing ? '（覆盖已保存的连接）' : defaultName}">
      </div>
      <div class="form-group">
        <label class="form-label">连接信息</label>
        <div class="connection-info-box">
          <div class="info-row"><strong>URL:</strong> <span class="info-url" title="${escapeHtml(connection.url)}">${escapeHtml(connection.url)}</span></div>
          <div><strong>消息数量:</strong> ${connection.messages.length} 条</div>
          <div><strong>状态:</strong> ${connection.status}</div>
          <div><strong>创建时间:</strong> ${defaultName}</div>
        </div>
      </div>
    </div>
  `;

    elements$1.presetModalFooter.innerHTML = `
    <button class="modal-btn" id="connection-cancel-btn">取消</button>
    <button class="modal-btn primary" id="connection-save-btn">保存</button>
  `;

    elements$1.presetModal.style.display = 'flex';

    const nameInput = document.getElementById('connection-name-input');
    const saveBtn = document.getElementById('connection-save-btn');
    const cancelBtn = document.getElementById('connection-cancel-btn');

    cancelBtn.addEventListener('click', closeSaveConnectionModal);

    saveBtn.addEventListener('click', async () => {
      if (!nameInput.value.trim()) {
        alert('请输入连接名称');
        return;
      }

      const name = nameInput.value.trim();
      const options = { name };

      if (existing) {
        const existingData = await getConnectionByOriginalId(connection.id);
        if (existingData) {
          options.savedId = existingData.id;
        }
      }

      try {
        const savedData = await saveConnection(connection, options);
        closeSaveConnectionModal();
        alert('连接保存成功！');

        if (callbacks$1.renderConnectionList) {
          callbacks$1.renderConnectionList();
        }
      } catch (error) {
        console.error('保存失败:', error);
        alert('保存失败，请重试');
      }
    });

    nameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        saveBtn.click();
      }
    });
  }

  async function showSavedConnectionsModal() {
    const savedConnections = await getAllSavedConnections();

    if (savedConnections.length === 0) {
      alert('暂无已保存的连接');
      return;
    }

    elements$1.savedConnectionsModalTitle.textContent = '已保存的连接';
    renderSavedConnectionsList(savedConnections);
    elements$1.savedConnectionsModal.style.display = 'flex';
  }

  function renderSavedConnectionsList(connections) {
    elements$1.savedConnectionsList.innerHTML = connections.map(conn => {
      const savedAt = formatDateTime(conn.savedAt);
      const createdAt = formatDateTime(conn.createdAt);

      return `
      <div class="saved-connection-card" data-id="${conn.id}" data-original-id="${conn.originalId}">
        <div class="saved-connection-info">
          <div class="saved-connection-name">
            ${escapeHtml(conn.name)}
            ${conn.isIframe ? '<span class="connection-badge badge-iframe">iframe</span>' : ''}
          </div>
          <div class="saved-connection-url" title="${escapeHtml(conn.url)}">
            ${escapeHtml(conn.url)}
          </div>
          <div class="saved-connection-meta">
            <span>💬 ${conn.messageCount} 条消息</span>
            <span>📅 保存于 ${savedAt}</span>
            <span>🕐 创建于 ${createdAt}</span>
          </div>
        </div>
        <div class="saved-connection-actions">
          <button class="saved-connection-btn load" title="加载此连接" data-id="${conn.id}">
            📤 加载
          </button>
          <button class="saved-connection-btn delete" title="删除此连接" data-id="${conn.id}">
            🗑️ 删除
          </button>
        </div>
      </div>
    `;
    }).join('');

    elements$1.savedConnectionsList.querySelectorAll('.saved-connection-btn.load').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        loadSavedConnection(btn.dataset.id);
      });
    });

    elements$1.savedConnectionsList.querySelectorAll('.saved-connection-btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSavedConnection(btn.dataset.id);
      });
    });
  }

  async function loadSavedConnection(savedId) {
    try {
      const savedData = await loadConnection(savedId);
      if (!savedData) {
        alert('未找到连接数据');
        return;
      }

      const newConnectionId = `archived-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const connectionData = {
        id: newConnectionId,
        originalId: savedData.originalId,
        savedId: savedId,
        url: savedData.url,
        frameUrl: savedData.frameUrl,
        isIframe: savedData.isIframe,
        source: savedData.source,
        status: 'archived',
        createdAt: savedData.createdAt,
        messages: savedData.messages
      };

      addConnection$1(connectionData);

      if (callbacks$1.selectConnection) {
        callbacks$1.selectConnection(connectionData.id);
      }

      if (callbacks$1.renderConnectionList) {
        callbacks$1.renderConnectionList();
      }

      if (callbacks$1.renderMessageList) {
        callbacks$1.renderMessageList();
      }

      closeSavedConnectionsModal();
    } catch (error) {
      console.error('加载失败:', error);
      alert('加载失败，请重试');
    }
  }

  async function deleteSavedConnection(savedId) {
    if (!confirm('确定要删除此连接吗？此操作不可恢复。')) {
      return;
    }

    try {
      await deleteConnection(savedId);
      
      const savedConnections = await getAllSavedConnections();
      if (savedConnections.length === 0) {
        closeSavedConnectionsModal();
      } else {
        renderSavedConnectionsList(savedConnections);
      }

      if (callbacks$1.renderConnectionList) {
        callbacks$1.renderConnectionList();
      }

      alert('连接已删除');
    } catch (error) {
      console.error('删除失败:', error);
      alert('删除失败，请重试');
    }
  }

  async function deleteAllSavedConnections() {
    const savedConnections = await getAllSavedConnections();
    if (savedConnections.length === 0) {
      alert('暂无已保存的连接');
      return;
    }

    if (!confirm(`确定要删除所有 ${savedConnections.length} 个已保存的连接吗？此操作不可恢复。`)) {
      return;
    }

    try {
      await deleteAllConnections();
      closeSavedConnectionsModal();
      alert('所有连接已删除');
      
      if (callbacks$1.renderConnectionList) {
        callbacks$1.renderConnectionList();
      }
    } catch (error) {
      console.error('删除失败:', error);
      alert('删除失败，请重试');
    }
  }

  function closeSavedConnectionsModal() {
    elements$1.savedConnectionsModal.style.display = 'none';
  }

  function closeSaveConnectionModal() {
    elements$1.presetModal.style.display = 'none';
  }

  function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  // Column resizer module

  function initColumnResizers() {
    const table = document.getElementById('message-table');
    if (!table) return;

    const resizers = table.querySelectorAll('.col-resizer');
    let currentResizer = null;
    let startX = 0;
    let startWidth = 0;
    let headerCell = null;
    let colClass = '';

    resizers.forEach(resizer => {
      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();

        currentResizer = resizer;
        headerCell = resizer.parentElement;
        colClass = resizer.dataset.col;
        startX = e.pageX;
        startWidth = headerCell.offsetWidth;

        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });

    function onMouseMove(e) {
      if (!currentResizer || !headerCell || !colClass) return;

      const diff = e.pageX - startX;
      const newWidth = Math.max(40, startWidth + diff);

      table.style.setProperty('--col-' + colClass + '-width', newWidth + 'px');

      if (colClass === 'data') {
        const dataCells = table.querySelectorAll('.col-data');
        dataCells.forEach(cell => {
          cell.style.flex = 'none';
        });
      }
    }

    function onMouseUp() {
      if (currentResizer) {
        currentResizer.classList.remove('resizing');
      }
      currentResizer = null;
      headerCell = null;
      colClass = '';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
  }

  // Search management module


  function searchMessages(messages, query) {
    if (!query) return messages;

    const lowerQuery = query.toLowerCase();
    return messages.filter(msg => {
      if (String(msg.eventType || '').toLowerCase().includes(lowerQuery)) {
        return true;
      }

      if (String(msg.data || '').toLowerCase().includes(lowerQuery)) {
        return true;
      }

      if (String(msg.lastEventId || '').toLowerCase().includes(lowerQuery)) {
        return true;
      }

      return false;
    });
  }

  // Export management module


  function getVisibleMessages(messages) {
    return searchMessages(filterMessages(messages), state.searchQuery);
  }

  function getAppliedFiltersMetadata() {
    return {
      messageFilters: state.messageFilters.length > 0 ? state.messageFilters : null,
      searchQuery: state.searchQuery || null
    };
  }

  function getConnectionExportInfo(connection) {
    return {
      id: connection.id,
      originalId: connection.originalId || null,
      savedId: connection.savedId || null,
      url: connection.url,
      frameUrl: connection.frameUrl || null,
      isIframe: Boolean(connection.isIframe),
      source: connection.source || 'unknown',
      requestType: getRequestType(connection.source),
      status: connection.status,
      createdAt: formatTimestampForExport(connection.createdAt),
      importedAt: connection.importedAt ? formatTimestampForExport(connection.importedAt) : null,
      messageCount: connection.messages?.length || 0
    };
  }

  function escapeCSV(value) {
    if (value === null || value === undefined) {
      return '';
    }
    const str = String(value);
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function getCurrentConnectionExportData() {
    const connection = state.connections[state.selectedConnectionId];
    if (!connection) {
      return null;
    }

    const messages = getVisibleMessages(connection.messages);

    return {
      connection: getConnectionExportInfo(connection),
      messages: messages.map(msg => ({
        id: msg.id,
        eventType: msg.eventType,
        data: msg.data,
        lastEventId: msg.lastEventId,
        timestamp: formatTimestampForExport(msg.timestamp)
      })),
      exportedAt: new Date().toISOString(),
      totalMessages: messages.length,
      appliedFilters: getAppliedFiltersMetadata()
    };
  }

  function getAllConnectionsExportData() {
    const connections = Object.values(state.connections);
    if (connections.length === 0) {
      return null;
    }

    return {
      connections: connections.map(conn => {
        const messages = getVisibleMessages(conn.messages);
        return {
          ...getConnectionExportInfo(conn),
          messages: messages.map(msg => ({
            id: msg.id,
            eventType: msg.eventType,
            data: msg.data,
            lastEventId: msg.lastEventId,
            timestamp: formatTimestampForExport(msg.timestamp)
          })),
          messageCount: messages.length,
          totalMessageCount: conn.messages.length
        };
      }),
      exportedAt: new Date().toISOString(),
      totalConnections: connections.length,
      totalMessages: connections.reduce((sum, conn) => sum + getVisibleMessages(conn.messages).length, 0),
      totalRawMessages: connections.reduce((sum, conn) => sum + conn.messages.length, 0),
      appliedFilters: getAppliedFiltersMetadata()
    };
  }

  function exportToJSON(data, filename) {
    const jsonStr = JSON.stringify(data, null, 2);
    downloadFile(jsonStr, filename, 'application/json');
  }

  function messagesToCSV(messages, connectionInfo = null) {
    const headers = ['ID', 'EventType', 'Data', 'LastEventId', 'Timestamp'];
    if (connectionInfo) {
      headers.unshift(
        'ConnectionID',
        'ConnectionURL',
        'RequestType',
        'Source',
        'Status',
        'IsIframe',
        'FrameURL',
        'ConnectionCreatedAt'
      );
    }

    const rows = messages.map(msg => {
      const row = [
        escapeCSV(msg.id),
        escapeCSV(msg.eventType),
        escapeCSV(msg.data),
        escapeCSV(msg.lastEventId),
        escapeCSV(msg.timestamp)
      ];

      if (connectionInfo) {
        row.unshift(
          escapeCSV(connectionInfo.id),
          escapeCSV(connectionInfo.url),
          escapeCSV(connectionInfo.requestType),
          escapeCSV(connectionInfo.source),
          escapeCSV(connectionInfo.status),
          escapeCSV(connectionInfo.isIframe),
          escapeCSV(connectionInfo.frameUrl),
          escapeCSV(connectionInfo.createdAt)
        );
      }

      return row.join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  function exportCurrentToCSV() {
    const connection = state.connections[state.selectedConnectionId];
    if (!connection) {
      alert('请先选择一个连接');
      return;
    }

    const messages = getVisibleMessages(connection.messages);
    if (messages.length === 0) {
      alert('当前连接没有消息可导出');
      return;
    }

    const formattedMessages = messages.map(msg => ({
      ...msg,
      timestamp: formatTimestampForExport(msg.timestamp)
    }));

    const csv = messagesToCSV(formattedMessages, getConnectionExportInfo(connection));
    const filename = `stream-messages-${connection.id.substring(0, 8)}-${Date.now()}.csv`;
    downloadFile(csv, filename, 'text/csv');
  }

  function exportAllToCSV() {
    const connections = Object.values(state.connections);
    if (connections.length === 0) {
      alert('没有连接数据可导出');
      return;
    }

    const allMessages = [];
    connections.forEach(conn => {
      getVisibleMessages(conn.messages).forEach(msg => {
        allMessages.push({
          ...msg,
          timestamp: formatTimestampForExport(msg.timestamp),
          connection: getConnectionExportInfo(conn)
        });
      });
    });

    if (allMessages.length === 0) {
      alert('没有消息数据可导出');
      return;
    }

    const headers = [
      'ConnectionID',
      'ConnectionURL',
      'RequestType',
      'Source',
      'Status',
      'IsIframe',
      'FrameURL',
      'ConnectionCreatedAt',
      'ID',
      'EventType',
      'Data',
      'LastEventId',
      'Timestamp'
    ];
    const rows = allMessages.map(msg => [
      escapeCSV(msg.connection.id),
      escapeCSV(msg.connection.url),
      escapeCSV(msg.connection.requestType),
      escapeCSV(msg.connection.source),
      escapeCSV(msg.connection.status),
      escapeCSV(msg.connection.isIframe),
      escapeCSV(msg.connection.frameUrl),
      escapeCSV(msg.connection.createdAt),
      escapeCSV(msg.id),
      escapeCSV(msg.eventType),
      escapeCSV(msg.data),
      escapeCSV(msg.lastEventId),
      escapeCSV(msg.timestamp)
    ].join(','));

    const csvWithConnectionInfo = [headers.join(','), ...rows].join('\n');
    const filename = `stream-all-messages-${Date.now()}.csv`;
    downloadFile(csvWithConnectionInfo, filename, 'text/csv');
  }

  function handleExport(exportType) {
    switch (exportType) {
      case 'current-json': {
        const data = getCurrentConnectionExportData();
        if (!data) {
          alert('请先选择一个连接');
          return;
        }
        const filename = `stream-${data.connection.id.substring(0, 8)}-${Date.now()}.json`;
        exportToJSON(data, filename);
        break;
      }

      case 'current-csv': {
        exportCurrentToCSV();
        break;
      }

      case 'all-json': {
        const data = getAllConnectionsExportData();
        if (!data) {
          alert('没有连接数据可导出');
          return;
        }
        const filename = `stream-all-${Date.now()}.json`;
        exportToJSON(data, filename);
        break;
      }

      case 'all-csv': {
        exportAllToCSV();
        break;
      }
    }
  }

  // Import management module


  let callbacks = {
    renderConnectionList: null,
    renderMessageList: null,
    selectConnection: null
  };

  function setCallbacks(cb) {
    callbacks = { ...callbacks, ...cb };
  }

  async function handleImport(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.json')) {
      alert('目前仅支持导入 JSON 文件');
      return;
    }

    try {
      const text = await readFileAsText(file);
      const data = JSON.parse(text);
      const connections = normalizeImportData(data);

      if (connections.length === 0) {
        alert('未找到可导入的连接数据');
        return;
      }

      connections.forEach(connection => addConnection$1(connection));

      if (callbacks.renderConnectionList) {
        callbacks.renderConnectionList();
      }

      if (callbacks.selectConnection) {
        callbacks.selectConnection(connections[0].id);
      } else if (callbacks.renderMessageList) {
        state.selectedConnectionId = connections[0].id;
        callbacks.renderMessageList({ force: true });
      }

      alert(`导入成功：${connections.length} 个连接，${connections.reduce((sum, conn) => sum + conn.messages.length, 0)} 条消息`);
    } catch (error) {
      console.error('[Stream Panel] Import failed:', error);
      alert('导入失败，请确认文件是 Stream Panel 导出的 JSON 数据');
    }
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, 'utf-8');
    });
  }

  function normalizeImportData(data) {
    if (!data || typeof data !== 'object') {
      return [];
    }

    if (Array.isArray(data.connections)) {
      return data.connections
        .map((connection, index) => normalizeConnection(connection, index))
        .filter(Boolean);
    }

    if (data.connection && Array.isArray(data.messages)) {
      return [normalizeConnection({
        ...data.connection,
        messages: data.messages
      }, 0)].filter(Boolean);
    }

    if (isConnectionLike(data)) {
      return [normalizeConnection(data, 0)].filter(Boolean);
    }

    return [];
  }

  function isConnectionLike(data) {
    return data &&
      typeof data === 'object' &&
      typeof data.url === 'string' &&
      Array.isArray(data.messages);
  }

  function normalizeConnection(connection, index) {
    if (!connection || typeof connection !== 'object' || !Array.isArray(connection.messages)) {
      return null;
    }

    const importedAt = Date.now();
    const originalId = connection.originalId || connection.id || `import-source-${index}`;
    const createdAt = parseTimestamp(connection.createdAt, importedAt);
    const id = generateImportedId(index);

    return {
      id,
      originalId,
      importedAt,
      url: connection.url || 'unknown',
      frameUrl: connection.frameUrl || null,
      isIframe: Boolean(connection.isIframe),
      source: connection.source || connection.requestType || 'imported',
      status: 'archived',
      createdAt,
      messages: connection.messages.map((message, messageIndex) => normalizeMessage(message, messageIndex))
    };
  }

  function normalizeMessage(message, index) {
    const fallbackTimestamp = Date.now();

    if (!message || typeof message !== 'object') {
      return {
        id: index + 1,
        eventType: 'message',
        data: String(message ?? ''),
        lastEventId: '',
        timestamp: fallbackTimestamp
      };
    }

    return {
      id: Number.isFinite(Number(message.id)) ? Number(message.id) : index + 1,
      eventType: message.eventType || 'message',
      data: typeof message.data === 'string' ? message.data : JSON.stringify(message.data ?? ''),
      lastEventId: message.lastEventId || '',
      timestamp: parseTimestamp(message.timestamp, fallbackTimestamp)
    };
  }

  function parseTimestamp(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return fallback;
  }

  function generateImportedId(index) {
    return `imported-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 9)}`;
  }

  // Main panel entry point

  // Enable debug mode
  window.__STREAM_PANEL_DEBUG__ = false;

  // DOM elements
  const elements = {
    connectionList: document.getElementById('connection-list'),
    messageTbody: document.getElementById('message-tbody'),
    messageEmpty: document.getElementById('message-empty'),
    messageListView: document.getElementById('message-list-view'),
    detailView: document.getElementById('detail-view'),
    detailTitle: document.getElementById('detail-title'),
    detailJson: document.getElementById('detail-json'),
    btnClear: document.getElementById('btn-clear'),
    btnImport: document.getElementById('btn-import'),
    importFileInput: document.getElementById('import-file-input'),
    btnBack: document.getElementById('btn-back'),
    btnPrevMessage: document.getElementById('btn-prev-message'),
    btnNextMessage: document.getElementById('btn-next-message'),
    btnCopy: document.getElementById('btn-copy'),
    btnPin: document.getElementById('btn-pin'),
    btnStats: document.getElementById('btn-stats'),
    filterInput: document.getElementById('filter-input'),
    btnTextDecode: document.getElementById('btn-text-decode'),
    textDecodeModal: document.getElementById('text-decode-modal'),
    textDecodeModalClose: document.getElementById('text-decode-modal-close'),
    textDecodeInput: document.getElementById('text-decode-input'),
    textDecodeOutput: document.getElementById('text-decode-output'),
    textDecodeClearBtn: document.getElementById('text-decode-clear-btn'),
    textDecodeCopyBtn: document.getElementById('text-decode-copy-btn'),
    requestTypeFilter: document.getElementById('request-type-filter'),
    displayFieldInput: document.getElementById('display-field-input'),
    btnClearDisplayField: document.getElementById('btn-clear-display-field'),
    messageFilterContainer: document.getElementById('message-filter-container'),
    filterConditions: document.getElementById('filter-conditions'),
    filterStats: document.getElementById('filter-stats'),
    btnAddFilter: document.getElementById('btn-add-filter'),
    btnApplyFilters: document.getElementById('btn-apply-filters'),
    btnClearFilters: document.getElementById('btn-clear-filters'),
    btnToggleFilter: document.getElementById('btn-toggle-filter'),
    btnScrollTop: document.getElementById('btn-scroll-top'),
    btnAutoScroll: document.getElementById('btn-auto-scroll'),
    btnSavePreset: document.getElementById('btn-save-preset'),
    btnLoadPreset: document.getElementById('btn-load-preset'),
    messageSearchInput: document.getElementById('message-search-input'),
    btnClearSearch: document.getElementById('btn-clear-search'),
    exportDropdown: document.querySelector('.export-dropdown'),
    btnExport: document.getElementById('btn-export'),
    exportMenu: document.getElementById('export-menu'),
    presetModal: document.getElementById('preset-modal'),
    presetModalTitle: document.getElementById('preset-modal-title'),
    presetModalBody: document.getElementById('preset-modal-body'),
    presetModalFooter: document.getElementById('preset-modal-footer'),
    presetModalClose: document.getElementById('preset-modal-close'),
    statsModal: document.getElementById('stats-modal'),
    statsModalBody: document.getElementById('stats-modal-body'),
    statsModalClose: document.getElementById('stats-modal-close'),
    btnSaveConnection: document.getElementById('btn-save-connection'),
    btnSavedConnections: document.getElementById('btn-saved-connections'),
    savedConnectionsModal: document.getElementById('saved-connections-modal'),
    savedConnectionsModalTitle: document.getElementById('saved-connections-modal-title'),
    savedConnectionsModalBody: document.getElementById('saved-connections-modal-body'),
    savedConnectionsList: document.getElementById('saved-connections-list'),
    savedConnectionsModalClose: document.getElementById('saved-connections-modal-close'),
    btnCloseSavedModal: document.getElementById('btn-close-saved-modal'),
    btnDeleteAllSaved: document.getElementById('btn-delete-all-saved')
  };

  // Connect to background script
  const port = chrome.runtime.connect({ name: 'stream-panel' });

  port.postMessage({
    type: 'init',
    tabId: chrome.devtools.inspectedWindow.tabId
  });

  // Handle messages from background
  port.onMessage.addListener(function(message) {
    log('Received message:', message.type, message);

    switch (message.type) {
      case 'init-data':
        state.connections = message.data.connections || {};
        log('Initialized with', Object.keys(state.connections).length, 'connections');
        renderConnectionList();
        break;

      case 'stream-event':
        handleStreamEvent(message.payload);
        break;

      case 'navigation':
        state.connections = {};
        state.selectedConnectionId = null;
        state.selectedMessageId = null;
        renderConnectionList();
        renderMessageList();
        showListView();
        break;
    }
  });

  // Initialize all modules
  function initModules() {
    initConnectionManager(elements);
    initMessageRenderer(elements);
    initViewManager(elements);
    initFilterManager(elements);
    initPresetManager(elements);
    initStatisticsManager(elements);
    initSavedConnectionsManager(elements);
    initEventHandlers(elements, port);
    initColumnResizers();

    setupModuleCallbacks();
    setupFilterEvents();
  }

  // Setup callbacks between modules to avoid circular dependencies
  function setupModuleCallbacks() {
    // Connection manager callbacks
    setCallbacks$6({
      renderMessageList,
      showListView,
      renderFilterConditions
    });

    // Message renderer callbacks
    setCallbacks$5({
      filterMessages,
      searchMessages
    });

    // Event handlers callbacks
    setCallbacks$2({
      renderConnectionList,
      renderMessageList,
      showMessageDetail,
      showAdjacentMessage,
      toggleFilterContainer,
      handleExport,
      handleImport,
      showSavePresetModal,
      showLoadPresetModal,
      closePresetModal,
      showStatisticsModal,
      closeStatisticsModal,
      showSaveConnectionModal,
      showSavedConnectionsModal,
      closeSavedConnectionsModal,
      deleteAllSavedConnections,
      updatePinButtonState
    });

    // Filter manager callbacks
    setCallbacks$4({
      renderMessageList,
      updateFilterStats
    });

    // Preset manager callbacks
    setCallbacks$3({
      renderMessageList,
      renderFilterConditions
    });

    // Saved connections manager callbacks
    setCallbacks$1({
      renderConnectionList,
      renderMessageList,
      selectConnection
    });

    // Import manager callbacks
    setCallbacks({
      renderConnectionList,
      renderMessageList,
      selectConnection
    });
  }

  // Setup custom event listeners for filter operations
  function setupFilterEvents() {
    document.addEventListener('addFilter', () => {
      addFilterCondition();
    });

    document.addEventListener('applyFilters', () => {
      applyFilters();
    });

    document.addEventListener('clearFilters', () => {
      clearAllFilters();
    });
  }

  // Re-export functions that need to be accessible globally for modules
  window.__StreamPanel__ = {
    renderConnectionList,
    renderMessageList,
    showMessageDetail,
    showListView,
    showDetailView,
    renderFilterConditions,
    closePresetModal,
    closeStatisticsModal
  };

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModules);
  } else {
    initModules();
  }

  log('Stream Panel initialized with modular architecture');

})();
//# sourceMappingURL=panel.bundle.js.map
