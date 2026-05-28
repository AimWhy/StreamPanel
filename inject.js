(function() {
  // Prevent multiple injections
  if (window.__STREAM_PANEL_INJECTED__) return;
  window.__STREAM_PANEL_INJECTED__ = true;

  const OriginalEventSource = window.EventSource;
  const OriginalFetch = window.fetch;
  const OriginalXHR = window.XMLHttpRequest;

  const DEBUG = false; // Set to true for debugging

  function log(...args) {
    if (DEBUG) {
      // console.log('[Stream Panel]', ...args);
    }
  }

  // Generate unique ID
  function generateId() {
    return 'stream_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
  }

  // Send message to content script
  function postToContentScript(data) {
    window.postMessage({
      source: 'stream-panel-inject',
      payload: data
    }, '*');
  }

  // Parse complete SSE event blocks. The caller is responsible for buffering
  // incomplete trailing data between chunks.
  function parseSSEEvents(text) {
    const events = [];
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let currentEvent = { data: '', event: 'message', id: '' };

    for (const line of lines) {
      if (line === '') {
        if (currentEvent.data !== '') {
          events.push({
            ...currentEvent,
            data: currentEvent.data.endsWith('\n')
              ? currentEvent.data.slice(0, -1)
              : currentEvent.data
          });
        }
        currentEvent = { data: '', event: 'message', id: '' };
        continue;
      }

      if (line.startsWith(':')) {
        continue;
      }

      const colonIndex = line.indexOf(':');
      const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
      let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
      if (value.startsWith(' ')) {
        value = value.slice(1);
      }

      if (field === 'data') {
        currentEvent.data += value + '\n';
      } else if (field === 'event') {
        currentEvent.event = value || 'message';
      } else if (field === 'id') {
        currentEvent.id = value;
      }
    }

    return events;
  }

  function findCompleteSSEBoundary(buffer) {
    const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const boundaryIndex = normalized.lastIndexOf('\n\n');
    if (boundaryIndex === -1) {
      return null;
    }

    const completeNormalizedLength = boundaryIndex + 2;
    let normalizedCount = 0;
    let originalIndex = 0;

    while (originalIndex < buffer.length && normalizedCount < completeNormalizedLength) {
      if (buffer[originalIndex] === '\r') {
        if (buffer[originalIndex + 1] === '\n') {
          originalIndex += 2;
        } else {
          originalIndex += 1;
        }
        normalizedCount += 1;
      } else {
        originalIndex += 1;
        normalizedCount += 1;
      }
    }

    return originalIndex;
  }

  function isMessageLikeEvent(event) {
    return event && Object.prototype.hasOwnProperty.call(event, 'data');
  }

  function resolveUrl(input, fallbackUrl = window.location.href) {
    if (!input) {
      return fallbackUrl;
    }

    try {
      if (typeof input === 'string') {
        return new URL(input, window.location.href).href;
      }

      if (input instanceof Request) {
        return new URL(input.url, window.location.href).href;
      }

      if (input instanceof URL) {
        return input.href;
      }

      if (typeof input.url === 'string') {
        return new URL(input.url, window.location.href).href;
      }

      return new URL(String(input), window.location.href).href;
    } catch (error) {
      return fallbackUrl;
    }
  }

  // ============================================
  // Intercept native EventSource
  // Standard SSE (Server-Sent Events) API
  // ============================================
  window.EventSource = function(url, options) {
    const es = new OriginalEventSource(url, options);
    const connectionId = generateId();
    let messageIndex = 0;
    const capturedEvents = new WeakSet();
    const listenerMap = new Map();

    // Resolve full URL
    const fullUrl = resolveUrl(url);

    const captureEvent = function(event) {
      if (!isMessageLikeEvent(event) || capturedEvents.has(event)) {
        return;
      }

      capturedEvents.add(event);
      messageIndex++;
      postToContentScript({
        type: 'stream-message',
        connectionId: connectionId,
        messageId: messageIndex,
        eventType: event.type,
        data: event.data,
        lastEventId: event.lastEventId || '',
        timestamp: Date.now()
      });
    };

    const callListener = function(listener, context, event) {
      if (typeof listener === 'function') {
        return listener.call(context, event);
      }
      if (listener && typeof listener.handleEvent === 'function') {
        return listener.handleEvent(event);
      }
      return undefined;
    };

    // Notify new connection
    postToContentScript({
      type: 'stream-connection',
      connectionId: connectionId,
      url: fullUrl,
      timestamp: Date.now(),
      readyState: es.readyState,
      source: 'EventSource'
    });

    // Listen for open event
    es.addEventListener('open', function() {
      postToContentScript({
        type: 'stream-open',
        connectionId: connectionId,
        timestamp: Date.now(),
        readyState: es.readyState
      });
    });

    // Intercept message event listeners
    const originalAddEventListener = es.addEventListener.bind(es);
    const originalRemoveEventListener = es.removeEventListener.bind(es);
    es.addEventListener = function(type, listener, options) {
      if (listener && type !== 'open' && type !== 'error') {
        const wrappedListener = function(event) {
          captureEvent(event);
          return callListener(listener, this, event);
        };

        let typeMap = listenerMap.get(type);
        if (!typeMap) {
          typeMap = new Map();
          listenerMap.set(type, typeMap);
        }
        typeMap.set(listener, wrappedListener);

        return originalAddEventListener(type, wrappedListener, options);
      }
      return originalAddEventListener(type, listener, options);
    };

    es.removeEventListener = function(type, listener, options) {
      const wrappedListener = listenerMap.get(type)?.get(listener);
      if (wrappedListener) {
        listenerMap.get(type).delete(listener);
        return originalRemoveEventListener(type, wrappedListener, options);
      }
      return originalRemoveEventListener(type, listener, options);
    };

    // Intercept onmessage setter
    let _onmessage = null;
    originalAddEventListener('message', function(event) {
      captureEvent(event);
      if (_onmessage) {
        callListener(_onmessage, es, event);
      }
    });

    Object.defineProperty(es, 'onmessage', {
      get: function() {
        return _onmessage;
      },
      set: function(handler) {
        _onmessage = handler;
      }
    });

    // Listen for error event
    es.addEventListener('error', function() {
      postToContentScript({
        type: 'stream-error',
        connectionId: connectionId,
        timestamp: Date.now(),
        readyState: es.readyState
      });
    });

    // Intercept close method
    const originalClose = es.close.bind(es);
    es.close = function() {
      postToContentScript({
        type: 'stream-close',
        connectionId: connectionId,
        timestamp: Date.now()
      });
      return originalClose();
    };

    return es;
  };

  // Copy static properties
  window.EventSource.prototype = OriginalEventSource.prototype;
  window.EventSource.CONNECTING = OriginalEventSource.CONNECTING;
  window.EventSource.OPEN = OriginalEventSource.OPEN;
  window.EventSource.CLOSED = OriginalEventSource.CLOSED;

  // ============================================
  // Intercept Fetch-based SSE and Streaming Responses
  // Only intercepts: SSE (text/event-stream), NDJSON (application/x-ndjson)
  // Does NOT intercept regular JSON/text responses
  // ============================================
  window.fetch = async function(...args) {
    const response = await OriginalFetch.apply(this, args);

    // Get request URL. Some apps pass URL objects to fetch; falling back to
    // the current page URL would make the connection list show the wrong link.
    const fullUrl = resolveUrl(args[0], response.url || window.location.href);

    // Check if response is streaming
    const contentType = response.headers.get('content-type') || '';

    log('Fetch intercepted:', fullUrl, 'Content-Type:', contentType);

    // Only detect true streaming responses by content-type
    // Do NOT use ReadableStream check as almost all fetch responses have it
    const isSSE = contentType.includes('text/event-stream');
    const isNDJSON = contentType.includes('application/x-ndjson') || contentType.includes('application/jsonlines');

    // If not a streaming response, return as-is
    if (!isSSE && !isNDJSON) {
      return response;
    }

    log('Detected streaming response!', {isSSE, isNDJSON, url: fullUrl});

    const connectionId = generateId();
    let messageIndex = 0;
    const streamType = isSSE ? 'SSE' : 'NDJSON';

    // Notify new connection
    const connectionPayload = {
      type: 'stream-connection',
      connectionId: connectionId,
      url: fullUrl,
      timestamp: Date.now(),
      readyState: 1,
      source: `fetch (${streamType})`
    };
    log('Posting connection:', connectionPayload);
    postToContentScript(connectionPayload);

    log('Created connection:', connectionId, streamType);

    // Notify open
    postToContentScript({
      type: 'stream-open',
      connectionId: connectionId,
      timestamp: Date.now(),
      readyState: 1
    });

    // Clone body to intercept
    if (!response.body) {
      log('ERROR: Response body is null! Cannot intercept stream.');
      return response;
    }

    log('Response body exists, creating reader...');

    const originalBody = response.body;
    const reader = originalBody.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Create a new ReadableStream that intercepts data
    const interceptedStream = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // Process any remaining buffer
              if (buffer.trim()) {
                if (isSSE) {
                  const events = parseSSEEvents(buffer + '\n\n');
                  for (const event of events) {
                    messageIndex++;
                    postToContentScript({
                      type: 'stream-message',
                      connectionId: connectionId,
                      messageId: messageIndex,
                      eventType: event.event,
                      data: event.data,
                      lastEventId: event.id,
                      timestamp: Date.now()
                    });
                  }
                } else if (isNDJSON) {
                  // Parse newline-delimited JSON
                  const lines = buffer.split('\n').filter(line => line.trim());
                  for (const line of lines) {
                    messageIndex++;
                    postToContentScript({
                      type: 'stream-message',
                      connectionId: connectionId,
                      messageId: messageIndex,
                      eventType: 'message',
                      data: line,
                      lastEventId: '',
                      timestamp: Date.now()
                    });
                  }
                }
              }

              postToContentScript({
                type: 'stream-close',
                connectionId: connectionId,
                timestamp: Date.now()
              });

              controller.close();
              break;
            }

            // Decode and buffer the chunk
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // Parse based on stream type
            if (isSSE) {
              // Parse complete SSE events from buffer
              const boundaryIndex = findCompleteSSEBoundary(buffer);
              if (boundaryIndex !== null) {
                const completeData = buffer.substring(0, boundaryIndex);
                buffer = buffer.substring(boundaryIndex);

                const events = parseSSEEvents(completeData);
                log('Parsed SSE events:', events.length, 'from', completeData.length, 'bytes');
                for (const event of events) {
                  messageIndex++;
                  const messagePayload = {
                    type: 'stream-message',
                    connectionId: connectionId,
                    messageId: messageIndex,
                    eventType: event.event,
                    data: event.data,
                    lastEventId: event.id,
                    timestamp: Date.now()
                  };
                  log('Posting message #' + messageIndex + ':', event.event);
                  postToContentScript(messagePayload);
                }
              }
            } else if (isNDJSON) {
              // Parse newline-delimited JSON
              const lines = buffer.split('\n');
              // Keep the last incomplete line in buffer
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.trim()) {
                  messageIndex++;
                  postToContentScript({
                    type: 'stream-message',
                    connectionId: connectionId,
                    messageId: messageIndex,
                    eventType: 'message',
                    data: line,
                    lastEventId: '',
                    timestamp: Date.now()
                  });
                }
              }
            }

            // Pass through the original data
            controller.enqueue(value);
          }
        } catch (error) {
          log('Stream error:', error);
          postToContentScript({
            type: 'stream-error',
            connectionId: connectionId,
            timestamp: Date.now(),
            error: error.message
          });
          controller.error(error);
        }
      },

      cancel() {
        log('Stream cancelled');
        postToContentScript({
          type: 'stream-close',
          connectionId: connectionId,
          timestamp: Date.now()
        });
        reader.cancel();
      }
    });

    // Create new response with intercepted body
    return new Response(interceptedStream, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    });
  };

  // ============================================
  // Intercept XMLHttpRequest for SSE and Streaming
  // Supports: text/event-stream, application/x-ndjson, application/jsonlines
  // ============================================
  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();
    let connectionId = null;
    let messageIndex = 0;
    let requestUrl = '';
    let isStreamingResponse = false;
    let processedLength = 0;
    let parseBuffer = '';

    // Intercept open method to capture URL
    const originalOpen = xhr.open;
    xhr.open = function(method, url, ...args) {
      requestUrl = resolveUrl(url);
      log('XHR open:', method, requestUrl);
      return originalOpen.call(this, method, url, ...args);
    };

    function emitXHRMessage(eventType, data, lastEventId = '') {
      messageIndex++;
      postToContentScript({
        type: 'stream-message',
        connectionId: connectionId,
        messageId: messageIndex,
        eventType: eventType,
        data: data,
        lastEventId: lastEventId,
        timestamp: Date.now()
      });
    }

    function processXHRChunk(contentType, chunk) {
      if (!chunk) return;

      parseBuffer += chunk;
      log('XHR received chunk, length:', chunk.length);

      if (contentType.includes('text/event-stream')) {
        const boundaryIndex = findCompleteSSEBoundary(parseBuffer);
        if (boundaryIndex === null) return;

        const completeData = parseBuffer.substring(0, boundaryIndex);
        parseBuffer = parseBuffer.substring(boundaryIndex);

        const events = parseSSEEvents(completeData);
        for (const event of events) {
          emitXHRMessage(event.event, event.data, event.id);
        }
      } else if (contentType.includes('application/x-ndjson') || contentType.includes('application/jsonlines')) {
        const lines = parseBuffer.split(/\r?\n/);
        parseBuffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            emitXHRMessage('message', line);
          }
        }
      }
    }

    function flushXHRBuffer(contentType) {
      if (!parseBuffer.trim()) {
        parseBuffer = '';
        return;
      }

      if (contentType.includes('text/event-stream')) {
        const events = parseSSEEvents(parseBuffer + '\n\n');
        for (const event of events) {
          emitXHRMessage(event.event, event.data, event.id);
        }
      } else if (contentType.includes('application/x-ndjson') || contentType.includes('application/jsonlines')) {
        emitXHRMessage('message', parseBuffer);
      }

      parseBuffer = '';
    }

    xhr.addEventListener('readystatechange', function() {
      log('XHR readyState:', xhr.readyState, 'status:', xhr.status);

      // HEADERS_RECEIVED: Detect if response is streaming
      if (xhr.readyState === 2) {
        const contentType = xhr.getResponseHeader('content-type') || '';
        log('XHR Content-Type:', contentType);

        isStreamingResponse = contentType.includes('text/event-stream') ||
                              contentType.includes('application/x-ndjson') ||
                              contentType.includes('application/jsonlines');

        if (isStreamingResponse) {
          connectionId = generateId();
          messageIndex = 0;
          processedLength = 0;
          parseBuffer = '';

          const streamType = contentType.includes('text/event-stream') ? 'SSE' :
                            contentType.includes('application/x-ndjson') ? 'NDJSON' : 'Stream';

          log('Detected XHR streaming response!', streamType);

          postToContentScript({
            type: 'stream-connection',
            connectionId: connectionId,
            url: requestUrl,
            timestamp: Date.now(),
            readyState: 1,
            source: `XMLHttpRequest (${streamType})`
          });

          postToContentScript({
            type: 'stream-open',
            connectionId: connectionId,
            timestamp: Date.now(),
            readyState: 1
          });
        }
      }

      if ((xhr.readyState === 3 || xhr.readyState === 4) && isStreamingResponse) {
        const contentType = xhr.getResponseHeader('content-type') || '';
        let currentText = '';
        try {
          currentText = xhr.responseText || '';
        } catch (error) {
          postToContentScript({
            type: 'stream-error',
            connectionId: connectionId,
            timestamp: Date.now(),
            error: error.message
          });
          return;
        }
        const newData = currentText.substring(processedLength);
        processedLength = currentText.length;
        processXHRChunk(contentType, newData);
      }

      // DONE: Stream completed
      if (xhr.readyState === 4 && isStreamingResponse) {
        const contentType = xhr.getResponseHeader('content-type') || '';
        flushXHRBuffer(contentType);

        log('XHR stream completed');
        postToContentScript({
          type: 'stream-close',
          connectionId: connectionId,
          timestamp: Date.now()
        });
      }
    });

    // Intercept send method only for logging; monitoring uses the internal
    // readystatechange listener so page callbacks remain untouched.
    const originalSend = xhr.send;
    xhr.send = function(...args) {
      log('XHR send:', requestUrl);
      return originalSend.apply(this, args);
    };

    return xhr;
  };

  // Copy static properties
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest.UNSENT = OriginalXHR.UNSENT;
  window.XMLHttpRequest.OPENED = OriginalXHR.OPENED;
  window.XMLHttpRequest.HEADERS_RECEIVED = OriginalXHR.HEADERS_RECEIVED;
  window.XMLHttpRequest.LOADING = OriginalXHR.LOADING;
  window.XMLHttpRequest.DONE = OriginalXHR.DONE;

  console.log('[Stream Panel] EventSource, Fetch & XMLHttpRequest interceptor injected');
})();
