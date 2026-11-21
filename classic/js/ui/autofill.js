/* =============================================================
 * 智能联想下拉（Autofill Suggest）
 * 用于「填一个 → 自动带出」：
 * 输入部分字符即模糊匹配客户 / 产品库，选中时填当前输入框，
 * 并触发一个选中回调（由调用方完成关联字段的批量自动带出）。
 * 这是一个轻量自建浮层，不依赖原生 <datalist>（那个只能补值、不能补关联字段）。
 * ============================================================= */

/** 当前打开的浮层（全局只允许一个，避免叠一起） */
let activeLayer = null;
let activeInput = null;

/** 关闭当前浮层 */
export function closeSuggest() {
  if (activeLayer) {
    activeLayer.remove();
    activeLayer = null;
  }
  if (activeInput) activeInput = null;
}

/**
 * 在输入框下打开联想浮层
 * @param {HTMLInputElement} input 触发输入框
 * @param {Array} items [{ label, sub, meta }]
 * @param {Function} onPick 选中回调 (item, input) => void；返回 true 表示调用方自行关浮层
 * @param {object} opts { maxHeight, minWidth, offsetY }
 */
export function openSuggest(input, items, onPick, opts = {}) {
  closeSuggest();
  if (!items || !items.length) return;

  const rect = input.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'suggest-layer';
  layer.style.left = `${Math.min(rect.left, window.innerWidth - 220)}px`;
  layer.style.top = `${rect.bottom + (opts.offsetY || 4)}px`;
  if (opts.minWidth) layer.style.minWidth = `${opts.minWidth}px`;
  if (opts.maxHeight) layer.style.maxHeight = `${opts.maxHeight}px`;

  const ul = document.createElement('ul');
  ul.className = 'suggest-list';
  items.forEach((it) => {
    const li = document.createElement('li');
    li.className = 'suggest-item';
    li.innerHTML = `<span class="s-label">${it.label}</span>${
      it.sub ? `<span class="s-sub">${it.sub}</span>` : ''
    }`;
    li.onclick = () => {
      const keep = onPick(it, input);
      if (keep !== true) closeSuggest();
    };
    ul.appendChild(li);
  });
  layer.appendChild(ul);
  document.body.appendChild(layer);

  activeLayer = layer;
  activeInput = input;

  // 点击外部关闭
  setTimeout(() => {
    document.addEventListener('click', outsideHandler, true);
  }, 0);
  return layer;
}

function outsideHandler(e) {
  if (activeLayer && !activeLayer.contains(e.target) && !(activeInput && activeInput.contains(e.target))) {
    closeSuggest();
    document.removeEventListener('click', outsideHandler, true);
  }
}

/** 键盘导航：上下移动 + 回车选中 + Esc 关闭 */
export function bindSuggestKeys(input, getLayer) {
  const handler = (e) => {
    const layer = getLayer();
    if (!layer) return;
    const items = [...layer.querySelectorAll('.suggest-item')];
    if (!items.length) return;
    let idx = items.findIndex((i) => i.classList.contains('sel'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      items.forEach((i) => i.classList.remove('sel'));
      idx = (idx + dir + items.length) % items.length;
      items[idx].classList.add('sel');
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && idx >= 0) {
      e.preventDefault();
      e.stopPropagation();
      items[idx].click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSuggest();
    }
  };
  input.addEventListener('keydown', handler);
  return () => input.removeEventListener('keydown', handler);
}
