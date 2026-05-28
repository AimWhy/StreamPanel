// Preset management module

import { state } from './state.js';
import { escapeHtml } from './utils.js';

const PRESETS_STORAGE_KEY = 'stream-panel-filter-presets';

let elements = {};
let callbacks = {
  renderMessageList: null,
  renderFilterConditions: null
};

export function initPresetManager(el) {
  elements = el;
}

export function setCallbacks(cb) {
  callbacks = { ...callbacks, ...cb };
}

export function loadPresets() {
  try {
    const stored = localStorage.getItem(PRESETS_STORAGE_KEY);
    const presets = stored ? JSON.parse(stored) : [];
    return Array.isArray(presets) ? presets : [];
  } catch (error) {
    console.warn('[Stream Panel] Failed to load filter presets:', error);
    return [];
  }
}

export function savePresetsToStorage(presets) {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

function formatFilterSummary(filters) {
  return filters
    .map(f => `${escapeHtml(f.field)} ${f.mode === 'equals' ? '=' : '包含'} "${escapeHtml(f.value)}"`)
    .join(' AND ');
}

export function showSavePresetModal() {
  if (state.pendingFilters.length === 0) {
    alert('请先添加筛选条件');
    return;
  }

  elements.presetModalTitle.textContent = '保存筛选预设';
  elements.presetModalBody.innerHTML = `
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

  elements.presetModalFooter.innerHTML = `
    <button class="modal-btn" id="preset-cancel-btn">取消</button>
    <button class="modal-btn primary" id="preset-save-btn">保存</button>
  `;

  elements.presetModal.style.display = 'flex';

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

export function showLoadPresetModal() {
  const presets = loadPresets();

  if (presets.length === 0) {
    alert('暂无已保存的预设');
    return;
  }

  elements.presetModalTitle.textContent = '加载筛选预设';
  elements.presetModalBody.innerHTML = `
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

  elements.presetModalFooter.innerHTML = `
    <button class="modal-btn" id="preset-close-btn">关闭</button>
  `;

  elements.presetModal.style.display = 'flex';

  document.getElementById('preset-close-btn').addEventListener('click', closePresetModal);

  document.querySelectorAll('.load-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetId = btn.dataset.presetId;
      const preset = presets.find(p => p.id === presetId);
      if (preset) {
        state.pendingFilters = JSON.parse(JSON.stringify(preset.filters));
        state.messageFilters = JSON.parse(JSON.stringify(preset.filters));
        elements.messageFilterContainer.style.display = 'block';
        elements.btnToggleFilter.classList.add('expanded');
        if (callbacks.renderFilterConditions) callbacks.renderFilterConditions();
        if (callbacks.renderMessageList) callbacks.renderMessageList();
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

export function closePresetModal() {
  elements.presetModal.style.display = 'none';
}
