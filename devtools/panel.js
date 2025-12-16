// Panel state
const state = {
  connections: {},
  selectedConnectionId: null,
  selectedMessageId: null,
  filter: '',
  messageFilters: [], // Applied filters
  pendingFilters: [] // Filters being edited, not yet applied
};

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
  btnBack: document.getElementById('btn-back'),
  btnCopy: document.getElementById('btn-copy'),
  filterInput: document.getElementById('filter-input'),
  messageFilterContainer: document.getElementById('message-filter-container'),
  filterConditions: document.getElementById('filter-conditions'),
  filterStats: document.getElementById('filter-stats'),
  btnAddFilter: document.getElementById('btn-add-filter'),
  btnApplyFilters: document.getElementById('btn-apply-filters'),
  btnClearFilters: document.getElementById('btn-clear-filters'),
  btnToggleFilter: document.getElementById('btn-toggle-filter')
};

// Connect to background script
const port = chrome.runtime.connect({ name: 'stream-panel' });

port.postMessage({
  type: 'init',
  tabId: chrome.devtools.inspectedWindow.tabId
});

// Handle messages from background
port.onMessage.addListener(function(message) {
  switch (message.type) {
    case 'init-data':
      // Initialize with existing data
      state.connections = message.data.connections || {};
      renderConnectionList();
      break;

    case 'stream-event':
      handleStreamEvent(message.payload);
      break;

    case 'navigation':
      // Clear on navigation
      state.connections = {};
      state.selectedConnectionId = null;
      state.selectedMessageId = null;
      renderConnectionList();
      renderMessageList();
      showListView();
      break;
  }
});

// Handle stream events
function handleStreamEvent(payload) {
  switch (payload.type) {
    case 'stream-connection':
      // Always create a new connection, even if URL is duplicate
      state.connections[payload.connectionId] = {
        id: payload.connectionId,
        url: payload.url,
        frameUrl: payload.frameUrl,
        isIframe: payload.isIframe,
        status: 'connecting',
        createdAt: payload.timestamp,
        messages: []
      };
      renderConnectionList();
      break;

    case 'stream-open':
      if (state.connections[payload.connectionId]) {
        state.connections[payload.connectionId].status = 'open';
        renderConnectionList();
      }
      break;

    case 'stream-message':
      if (state.connections[payload.connectionId]) {
        state.connections[payload.connectionId].messages.push({
          id: payload.messageId,
          eventType: payload.eventType,
          data: payload.data,
          lastEventId: payload.lastEventId,
          timestamp: payload.timestamp
        });
        renderConnectionList();
        if (state.selectedConnectionId === payload.connectionId) {
          renderMessageList();
        }
      }
      break;

    case 'stream-error':
      if (state.connections[payload.connectionId]) {
        state.connections[payload.connectionId].status = 'error';
        renderConnectionList();
      }
      break;

    case 'stream-close':
      if (state.connections[payload.connectionId]) {
        state.connections[payload.connectionId].status = 'closed';
        renderConnectionList();
      }
      break;
  }
}

// Render connection list
function renderConnectionList() {
  const connections = Object.values(state.connections);
  const filter = state.filter.toLowerCase();

  // Filter connections
  const filtered = filter
    ? connections.filter(c => c.url.toLowerCase().includes(filter))
    : connections;

  // Sort by creation time (newest first)
  filtered.sort((a, b) => b.createdAt - a.createdAt);

  if (filtered.length === 0) {
    elements.connectionList.innerHTML = '<div class="empty-state">暂无连接</div>';
    return;
  }

  elements.connectionList.innerHTML = filtered.map(conn => {
    const urlPath = getUrlPath(conn.url);
    const isSelected = conn.id === state.selectedConnectionId;
    const badgeClass = conn.isIframe ? 'badge-iframe' : 'badge-main';
    const badgeText = conn.isIframe ? 'iframe' : '主页面';
    const statusClass = `status-${conn.status}`;

    return `
      <div class="connection-item ${isSelected ? 'selected' : ''}" data-id="${conn.id}">
        <div class="connection-url">${escapeHtml(urlPath)}</div>
        <div class="connection-meta">
          <span class="status-dot ${statusClass}"></span>
          <span class="connection-badge ${badgeClass}">${badgeText}</span>
          <span class="message-count">${conn.messages.length} 条</span>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  elements.connectionList.querySelectorAll('.connection-item').forEach(item => {
    item.addEventListener('click', () => {
      selectConnection(item.dataset.id);
    });
  });
}

// Select a connection
function selectConnection(connectionId) {
  state.selectedConnectionId = connectionId;
  state.selectedMessageId = null;
  
  // Sync pending filters with applied filters when switching connection
  state.pendingFilters = JSON.parse(JSON.stringify(state.messageFilters));
  
  renderConnectionList();
  renderMessageList();
  showListView();
  
  // Show filter container if filters exist
  if (state.pendingFilters.length > 0) {
    elements.messageFilterContainer.style.display = 'block';
    renderFilterConditions();
  }
}

// Extract all fields from JSON data recursively
function extractFields(obj, prefix = '', fields = new Set()) {
  if (obj === null || obj === undefined) {
    return fields;
  }

  if (Array.isArray(obj)) {
    // For arrays, check the first element if it exists
    if (obj.length > 0 && typeof obj[0] === 'object') {
      extractFields(obj[0], prefix, fields);
    }
    return fields;
  }

  if (typeof obj === 'object') {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const fieldPath = prefix ? `${prefix}.${key}` : key;
        fields.add(fieldPath);
        
        // Recursively extract nested fields
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          extractFields(obj[key], fieldPath, fields);
        } else if (Array.isArray(obj[key]) && obj[key].length > 0 && typeof obj[key][0] === 'object') {
          extractFields(obj[key][0], fieldPath, fields);
        }
      }
    }
  }

  return fields;
}

// Get all available fields from current connection's messages
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

// Get nested field value from object using dot notation
function getNestedValue(obj, path) {
  const keys = path.split('.');
  let value = obj;
  
  for (const key of keys) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = value[key];
  }
  
  return value;
}

// Filter messages based on current filters
function filterMessages(messages) {
  if (state.messageFilters.length === 0) {
    return messages;
  }

  return messages.filter(msg => {
    try {
      const parsed = JSON.parse(msg.data);
      
      // All filters must match (AND logic)
      return state.messageFilters.every(filter => {
        const fieldValue = getNestedValue(parsed, filter.field);
        
        if (fieldValue === undefined) {
          return false;
        }

        const fieldValueStr = String(fieldValue);
        const filterValueStr = String(filter.value);

        if (filter.mode === 'equals') {
          return fieldValueStr === filterValueStr;
        } else if (filter.mode === 'contains') {
          return fieldValueStr.includes(filterValueStr);
        }
        
        return true;
      });
    } catch (e) {
      // Not JSON, skip filtering for this message
      return false;
    }
  });
}

// Render message list
function renderMessageList() {
  const connection = state.connections[state.selectedConnectionId];

  if (!connection || connection.messages.length === 0) {
    elements.messageTbody.innerHTML = '';
    elements.messageEmpty.style.display = 'flex';
    elements.messageTbody.parentElement.style.display = 'none';
    return;
  }

  elements.messageEmpty.style.display = 'none';
  elements.messageTbody.parentElement.style.display = 'flex';

  // Apply filters
  const filteredMessages = filterMessages(connection.messages);
  
  // Update filter stats
  updateFilterStats(filteredMessages.length, connection.messages.length);

  elements.messageTbody.innerHTML = filteredMessages.map(msg => {
    const time = formatTime(msg.timestamp);

    return `
      <div class="message-row" data-id="${msg.id}">
        <div class="message-cell col-id">${msg.id}</div>
        <div class="message-cell col-type">${escapeHtml(msg.eventType)}</div>
        <div class="message-cell col-data">${escapeHtml(msg.data)}</div>
        <div class="message-cell col-time">${time}</div>
      </div>
    `;
  }).join('');

  // Add click handlers
  elements.messageTbody.querySelectorAll('.message-row').forEach(row => {
    row.addEventListener('click', () => {
      showMessageDetail(parseInt(row.dataset.id));
    });
  });

  // Update filter UI if filters exist
  if (state.messageFilters.length > 0) {
    renderFilterConditions();
  }
}

// Show message detail
function showMessageDetail(messageId) {
  const connection = state.connections[state.selectedConnectionId];
  if (!connection) return;

  const message = connection.messages.find(m => m.id === messageId);
  if (!message) return;

  state.selectedMessageId = messageId;

  // Update detail view
  elements.detailTitle.textContent = `消息 #${messageId} - ${message.eventType}`;

  // Format and highlight JSON
  let formattedData;
  try {
    const parsed = JSON.parse(message.data);
    formattedData = syntaxHighlight(JSON.stringify(parsed, null, 2));
  } catch (e) {
    formattedData = escapeHtml(message.data);
  }

  elements.detailJson.innerHTML = formattedData;

  // Show detail view
  showDetailView();
}

// View switching
function showListView() {
  elements.messageListView.classList.add('active');
  elements.detailView.classList.remove('active');
}

function showDetailView() {
  elements.messageListView.classList.remove('active');
  elements.detailView.classList.add('active');
}

// Event handlers
elements.btnClear.addEventListener('click', () => {
  state.connections = {};
  state.selectedConnectionId = null;
  state.selectedMessageId = null;
  renderConnectionList();
  renderMessageList();
  showListView();

  // Notify background to clear data
  port.postMessage({ type: 'clear' });
});

elements.btnBack.addEventListener('click', () => {
  showListView();
});

elements.btnCopy.addEventListener('click', () => {
  const connection = state.connections[state.selectedConnectionId];
  if (!connection) return;

  const message = connection.messages.find(m => m.id === state.selectedMessageId);
  if (!message) return;

  copyToClipboard(message.data);
});

elements.filterInput.addEventListener('input', (e) => {
  state.filter = e.target.value;
  renderConnectionList();
});

// Add filter condition
function addFilterCondition() {
  const availableFields = getAvailableFields();
  if (availableFields.length === 0) {
    alert('当前没有可用的字段，请先选择连接并等待消息数据。');
    return;
  }

  state.pendingFilters.push({
    field: availableFields[0] || '',
    mode: 'equals',
    value: ''
  });

  elements.messageFilterContainer.style.display = 'block';
  renderFilterConditions();
}

// Remove filter condition
function removeFilterCondition(index) {
  state.pendingFilters.splice(index, 1);
  renderFilterConditions();
}

// Clear all filters
function clearAllFilters() {
  state.pendingFilters = [];
  state.messageFilters = [];
  elements.messageFilterContainer.style.display = 'none';
  renderFilterConditions();
  renderMessageList();
}

// Apply filters
function applyFilters() {
  // Copy pending filters to active filters
  state.messageFilters = JSON.parse(JSON.stringify(state.pendingFilters));
  renderMessageList();
}

// Update pending filter condition
function updatePendingFilterCondition(index, field, mode, value) {
  if (state.pendingFilters[index]) {
    state.pendingFilters[index].field = field;
    state.pendingFilters[index].mode = mode;
    state.pendingFilters[index].value = value;
  }
}

// Render filter conditions
function renderFilterConditions() {
  const availableFields = getAvailableFields();
  
  elements.filterConditions.innerHTML = state.pendingFilters.map((filter, index) => {
    const fieldOptions = availableFields.map(field => 
      `<option value="${escapeHtml(field)}" ${filter.field === field ? 'selected' : ''}>${escapeHtml(field)}</option>`
    ).join('');

    return `
      <div class="filter-row" data-index="${index}">
        <select class="filter-field-select" data-index="${index}">
          ${fieldOptions}
        </select>
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

  // Add event listeners
  elements.filterConditions.querySelectorAll('.filter-field-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      const filter = state.pendingFilters[index];
      updatePendingFilterCondition(index, e.target.value, filter.mode, filter.value);
    });
  });

  elements.filterConditions.querySelectorAll('.filter-mode-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      const filter = state.pendingFilters[index];
      updatePendingFilterCondition(index, filter.field, e.target.value, filter.value);
    });
  });

  elements.filterConditions.querySelectorAll('.filter-value-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const index = parseInt(e.target.dataset.index);
      const filter = state.pendingFilters[index];
      updatePendingFilterCondition(index, filter.field, filter.mode, e.target.value);
    });
    
    // Support Enter key to apply filters
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        applyFilters();
      }
    });
  });

  elements.filterConditions.querySelectorAll('.filter-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const index = parseInt(e.target.dataset.index);
      removeFilterCondition(index);
    });
  });
}

// Update filter stats
function updateFilterStats(filteredCount, totalCount) {
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

// Toggle filter container visibility
function toggleFilterContainer() {
  const isHidden = elements.messageFilterContainer.style.display === 'none';
  elements.messageFilterContainer.style.display = isHidden ? 'block' : 'none';
}

// Event handlers for filter buttons
elements.btnToggleFilter.addEventListener('click', toggleFilterContainer);
elements.btnAddFilter.addEventListener('click', addFilterCondition);
elements.btnApplyFilters.addEventListener('click', applyFilters);
elements.btnClearFilters.addEventListener('click', clearAllFilters);

// Resizer functionality
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

// Utility functions
function getUrlPath(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch (e) {
    return url;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function copyToClipboard(text) {
  // Create a temporary textarea element
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand('copy');
  } catch (err) {
    console.error('Failed to copy:', err);
  }

  document.body.removeChild(textarea);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function syntaxHighlight(json) {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    function(match) {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
          // Remove the colon for keys
          match = match.slice(0, -1);
          return '<span class="' + cls + '">' + escapeHtml(match) + '</span>:';
        } else {
          cls = 'json-string';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-boolean';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return '<span class="' + cls + '">' + escapeHtml(match) + '</span>';
    }
  );
}

// Initial render
renderConnectionList();

// ============================================
// Column Resizing Functionality
// ============================================
(function initColumnResizers() {
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

    // Update CSS variable for the column
    table.style.setProperty('--col-' + colClass + '-width', newWidth + 'px');

    // For data column, also remove flex so width takes effect
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
})();
