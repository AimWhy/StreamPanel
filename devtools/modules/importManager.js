// Import management module

import { state, addConnection } from './state.js';

let callbacks = {
  renderConnectionList: null,
  renderMessageList: null,
  selectConnection: null
};

export function setCallbacks(cb) {
  callbacks = { ...callbacks, ...cb };
}

export async function handleImport(file) {
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

    connections.forEach(connection => addConnection(connection));

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
