// Export management module

import { state } from './state.js';
import { formatTimestampForExport, downloadFile } from './utils.js';
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

export function getCurrentConnectionExportData() {
  const connection = state.connections[state.selectedConnectionId];
  if (!connection) {
    return null;
  }

  const messages = getVisibleMessages(connection.messages);

  return {
    connection: {
      id: connection.id,
      url: connection.url,
      frameUrl: connection.frameUrl,
      isIframe: connection.isIframe,
      status: connection.status,
      createdAt: formatTimestampForExport(connection.createdAt)
    },
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
        id: conn.id,
        url: conn.url,
        frameUrl: conn.frameUrl,
        isIframe: conn.isIframe,
        status: conn.status,
        createdAt: formatTimestampForExport(conn.createdAt),
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
    headers.unshift('ConnectionURL', 'ConnectionID');
  }

  const rows = messages.map(msg => {
    const escapeCSV = (value) => {
      if (value === null || value === undefined) {
        return '';
      }
      const str = String(value);
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const row = [
      escapeCSV(msg.id),
      escapeCSV(msg.eventType),
      escapeCSV(msg.data),
      escapeCSV(msg.lastEventId),
      escapeCSV(msg.timestamp)
    ];

    if (connectionInfo) {
      row.unshift(escapeCSV(connectionInfo.url), escapeCSV(connectionInfo.id));
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

  const csv = messagesToCSV(formattedMessages);
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
        connectionUrl: conn.url,
        connectionId: conn.id
      });
    });
  });

  if (allMessages.length === 0) {
    alert('没有消息数据可导出');
    return;
  }

  const headers = ['ConnectionID', 'ConnectionURL', 'ID', 'EventType', 'Data', 'LastEventId', 'Timestamp'];
  const rows = allMessages.map(msg => {
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    return [
      escapeCSV(msg.connectionId),
      escapeCSV(msg.connectionUrl),
      escapeCSV(msg.id),
      escapeCSV(msg.eventType),
      escapeCSV(msg.data),
      escapeCSV(msg.lastEventId),
      escapeCSV(msg.timestamp)
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  const filename = `stream-all-messages-${Date.now()}.csv`;
  downloadFile(csv, filename, 'text/csv');
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
