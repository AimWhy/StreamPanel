// Message rendering module

import { state, isMessagePinned } from './state.js';
import { copyToClipboard, escapeHtml, formatTime, log } from './utils.js';
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
let jsonFieldContextMenu = null;

export function initMessageRenderer(el) {
  elements = el;

  setupMessageListEventDelegation();
  setupJsonDetailEventDelegation();
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
    formattedData = renderCollapsibleJson(parsed);
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
  elements.detailJson.addEventListener('click', (e) => {
    const toggle = e.target.closest('.json-toggle');
    if (!toggle) return;

    const node = toggle.closest('.json-node');
    if (!node) return;

    const collapsed = node.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▶' : '▼';
    toggle.title = collapsed ? '展开' : '折叠';
  });

  elements.detailJson.addEventListener('contextmenu', (e) => {
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
