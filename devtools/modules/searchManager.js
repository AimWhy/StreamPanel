// Search management module

import { state } from './state.js';

export function searchMessages(messages, query) {
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
