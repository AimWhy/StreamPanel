// Filter management module

import { state } from './state.js';
import { escapeHtml } from './utils.js';

let elements = {};
let callbacks = {
  renderMessageList: null,
  updateFilterStats: null
};

export function initFilterManager(el) {
  elements = el;
}

export function setCallbacks(cb) {
  callbacks = { ...callbacks, ...cb };
}

export function getAvailableFields() {
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

export function extractFields(obj, prefix = '', fields = new Set()) {
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

export function getNestedValue(obj, path) {
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

export function filterMessages(messages) {
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

export function addFilterCondition() {
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

  elements.messageFilterContainer.style.display = 'block';
  elements.btnToggleFilter.classList.add('expanded');
  renderFilterConditions();

  const lastInput = elements.filterConditions.querySelector(
    `.filter-field-input[data-index="${state.pendingFilters.length - 1}"]`
  );
  if (lastInput) {
    lastInput.focus();
  }
}

export function removeFilterCondition(index) {
  state.pendingFilters.splice(index, 1);
  state.messageFilters = JSON.parse(JSON.stringify(state.pendingFilters));
  renderFilterConditions();
  if (callbacks.renderMessageList) callbacks.renderMessageList();
}

export function clearAllFilters() {
  state.pendingFilters = [];
  state.messageFilters = [];
  elements.messageFilterContainer.style.display = 'none';
  elements.btnToggleFilter.classList.remove('expanded');
  renderFilterConditions();
  if (callbacks.renderMessageList) callbacks.renderMessageList();
}

export function applyFilters() {
  state.messageFilters = JSON.parse(JSON.stringify(state.pendingFilters));
  if (callbacks.renderMessageList) callbacks.renderMessageList();
}

export function updatePendingFilterCondition(index, field, mode, value) {
  if (state.pendingFilters[index]) {
    state.pendingFilters[index].field = field;
    state.pendingFilters[index].mode = mode;
    state.pendingFilters[index].value = value;
  }
}

export function renderFilterConditions() {
  const availableFields = getAvailableFields();

  elements.filterConditions.innerHTML = state.pendingFilters.map((filter, index) => {
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
  elements.filterConditions.querySelectorAll('.filter-field-input').forEach(input => {
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

export function toggleFilterContainer() {
  const isHidden = elements.messageFilterContainer.style.display === 'none';
  elements.messageFilterContainer.style.display = isHidden ? 'block' : 'none';

  if (isHidden) {
    elements.btnToggleFilter.classList.add('expanded');
  } else {
    elements.btnToggleFilter.classList.remove('expanded');
  }
}
