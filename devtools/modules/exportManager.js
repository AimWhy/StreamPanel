// Export management module

import { state } from './state.js';
import { formatTimestampForExport, downloadFile, getRequestType } from './utils.js';
import { filterMessages } from './filterManager.js';
import { searchMessages } from './searchManager.js';

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

export function getCurrentConnectionExportData() {
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

export function getAllConnectionsExportData() {
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

export function exportToJSON(data, filename) {
  const jsonStr = JSON.stringify(data, null, 2);
  downloadFile(jsonStr, filename, 'application/json');
}

export function messagesToCSV(messages, connectionInfo = null) {
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

export function exportCurrentToCSV() {
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

export function exportAllToCSV() {
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

export function handleExport(exportType) {
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
