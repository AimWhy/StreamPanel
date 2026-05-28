// Message rendering module

import { state, isMessagePinned } from './state.js';
import { escapeHtml, formatTime, syntaxHighlight, log } from './utils.js';
import { showDetailView, showListView } from './viewManager.js';

let elements = {};
let callbacks = {
  filterMessages: null,
  searchMessages: null
};

let lastRenderedConnectionId = null;
let lastRenderedMessageCount = 0;
let lastRenderSignature = '';
let renderTimeout = null;
let renderToken = 0;

export function initMessageRenderer(el) {
  elements = el;

  setupMessageListEventDelegation();
}

export function setCallbacks(cb) {
  callbacks = { ...callbacks, ...cb };
}

export function renderMessageList(options = {}) {
  const currentToken = ++renderToken;
  const connection = state.connections[state.selectedConnectionId];

  if (!connection || connection.messages.length === 0) {
    elements.messageTbody.innerHTML = '';
    elements.messageEmpty.style.display = 'flex';
    elements.messageTbody.parentElement.style.display = 'none';
    lastRenderedConnectionId = null;
    lastRenderedMessageCount = 0;
    lastRenderSignature = '';
    return;
  }

  elements.messageEmpty.style.display = 'none';
  elements.messageTbody.parentElement.style.display = 'flex';

  let filteredMessages = connection.messages;
  if (callbacks.filterMessages) {
    filteredMessages = callbacks.filterMessages(connection.messages);
  }
  if (callbacks.searchMessages) {
    filteredMessages = callbacks.searchMessages(filteredMessages, state.searchQuery);
  }

  updateFilterStats(filteredMessages.length, connection.messages.length);

  const pinnedMessages = filteredMessages.filter(msg => isMessagePinned(state.selectedConnectionId, msg.id));
  const normalMessages = filteredMessages.filter(msg => !isMessagePinned(state.selectedConnectionId, msg.id));
  const displayMessages = [...pinnedMessages, ...normalMessages];

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
        elements.messageTbody.scrollTop + elements.messageTbody.clientHeight >= elements.messageTbody.scrollHeight - 50;

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
    pinned: pinnedIds
  });
}

function renderAllMessages(messages) {
  const fragment = document.createDocumentFragment();

  messages.forEach(msg => {
    const row = createMessageRow(msg);
    fragment.appendChild(row);
  });

  elements.messageTbody.innerHTML = '';
  elements.messageTbody.appendChild(fragment);

  if (state.autoScrollToBottom) {
    elements.messageTbody.scrollTop = elements.messageTbody.scrollHeight;
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

  elements.messageTbody.appendChild(fragment);

  if (state.autoScrollToBottom && isAutoScrolling) {
    elements.messageTbody.scrollTop = elements.messageTbody.scrollHeight;
  }
}

function createMessageRow(msg) {
  const row = document.createElement('div');
  const time = formatTime(msg.timestamp);
  const hasSearch = state.searchQuery.length > 0;
  const isPinned = isMessagePinned(state.selectedConnectionId, msg.id);

  row.className = `message-row ${hasSearch ? 'search-highlight' : ''} ${isPinned ? 'pinned' : ''}`;
  row.dataset.id = msg.id;

  const idCell = document.createElement('div');
  idCell.className = 'message-cell col-id';
  idCell.textContent = `${isPinned ? '📌' : ''}${msg.id}`;

  const typeCell = document.createElement('div');
  typeCell.className = 'message-cell col-type';
  typeCell.innerHTML = hasSearch ? highlightSearchMatches(msg.eventType || '', state.searchQuery) : escapeHtml(msg.eventType || '');

  const dataCell = document.createElement('div');
  dataCell.className = 'message-cell col-data';
  dataCell.innerHTML = hasSearch ? highlightSearchMatches(msg.data || '', state.searchQuery) : escapeHtml(msg.data || '');

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
  elements.messageTbody.addEventListener('click', (e) => {
    const row = e.target.closest('.message-row');
    if (row) {
      const messageId = parseInt(row.dataset.id);
      showMessageDetail(messageId);
    }
  });
}

export function showMessageDetail(messageId) {
  const connection = state.connections[state.selectedConnectionId];
  if (!connection) return;

  const message = connection.messages.find(m => m.id === messageId);
  if (!message) return;

  state.selectedMessageId = messageId;

  elements.detailTitle.textContent = `消息 #${messageId} - ${message.eventType}`;

  let formattedData;
  try {
    const parsed = JSON.parse(message.data);
    formattedData = syntaxHighlight(JSON.stringify(parsed, null, 2));
  } catch (e) {
    formattedData = escapeHtml(message.data);
  }

  elements.detailJson.innerHTML = formattedData;
  updatePinButtonState();
  showDetailView();
}

export function updatePinButtonState() {
  const isPinned = isMessagePinned(state.selectedConnectionId, state.selectedMessageId);
  elements.btnPin.classList.toggle('active', isPinned);
  elements.btnPin.title = isPinned ? '取消置顶此消息' : '置顶此消息';
}

export function updateFilterStats(filteredCount, totalCount) {
  if (state.messageFilters.length === 0) {
    elements.filterStats.textContent = '';
    return;
  }

  if (filteredCount === totalCount) {
    elements.filterStats.textContent = `显示全部 ${totalCount} 条消息`;
  } else {
    elements.filterStats.textContent = `显示 ${filteredCount}/${totalCount} 条消息`;
  }
}

export function highlightSearchMatches(text, query) {
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
