/**
 * 使用体验增强（与原版业务无关的通用层）
 *
 *  · 每个分组标题后面显示「已填 3 / 8」
 *  · 顶部悬浮「待填 N 项」面板：点一项 → 左侧输入框滚动并高亮
 *  · 点右侧单据上的文字 → 左侧对应输入框自动聚焦（按值匹配）
 *
 * 全部基于「DOM 里已有的输入框」，不改任何单据渲染逻辑。
 */

/** 判断一个输入框是否有值（select/textarea/input 通用） */
function hasValue(el) {
  if (!el) return false;
  if (el.tagName === 'SELECT') return !!el.value;
  return String(el.value || '').trim() !== '';
}

/** 取一个输入框的可读名字（label 文本 / placeholder） */
function labelOf(el) {
  const field = el.closest('.field');
  if (field) {
    const lb = field.querySelector('label');
    if (lb) {
      const txt = (lb.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) return txt.replace(/[?？]\s*$/, '');
    }
  }
  return el.getAttribute('placeholder') || el.getAttribute('data-bind') || '未命名字段';
}

/** 给每个分组标题加「已填 x / y」 */
export function decorateSections(host) {
  if (!host) return;
  host.querySelectorAll('.card').forEach((card) => {
    // 只统计「真正要填」的控件：排除按钮区、隐藏卡片
    const controls = [...card.querySelectorAll('input, textarea, select')]
      .filter((el) => el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'file')
      .filter((el) => el.offsetParent !== null);
    const total = controls.length;
    if (!total) return;
    const filled = controls.filter(hasValue).length;
    let badge = card.querySelector('.sec-progress');
    if (!badge) {
      const head = card.querySelector('.card-head');
      if (!head) return;
      badge = document.createElement('span');
      badge.className = 'sec-progress';
      head.appendChild(badge);
    }
    badge.textContent = `${filled} / ${total}`;
    badge.classList.toggle('done', filled === total);
  });
}

/** 待填面板：列出还没填的字段 */
export function buildTodoPanel(host, mount) {
  if (!host || !mount) return;
  let panel = mount.querySelector('#uxTodo');
  const controls = [...host.querySelectorAll('input, textarea, select')]
    .filter((el) => el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'file')
    .filter((el) => el.offsetParent !== null);
  const empties = controls.filter((el) => !hasValue(el));
  if (!empties.length) {
    if (panel) panel.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'uxTodo';
    panel.className = 'ux-todo';
    mount.insertBefore(panel, mount.firstChild);   // 放到最上面，进页面就能看到
  } else if (mount.firstChild !== panel) {
    mount.insertBefore(panel, mount.firstChild);
  }
  panel.innerHTML = `
    <div class="ux-todo-hd">
      <b>还有 ${empties.length} 项没填（选填，按需）</b>\n      <span class="ux-todo-tip">点一项可直接跳到输入框</span>
      <button type="button" class="ux-todo-min" title="收起 / 展开">−</button>
    </div>
    <ul class="ux-todo-list"></ul>`;
  const ul = panel.querySelector('.ux-todo-list');
  empties.slice(0, 12).forEach((el) => {
    const li = document.createElement('li');
    li.textContent = labelOf(el);
    li.onclick = () => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.focus({ preventScroll: true });
      el.classList.add('ux-flash');
      setTimeout(() => el.classList.remove('ux-flash'), 1200);
      panel.classList.add('collapsed');
    };
    ul.appendChild(li);
  });
  panel.querySelector('.ux-todo-min').onclick = () => panel.classList.toggle('collapsed');
}

/** 点右侧单据里的文字 → 左侧对应输入框聚焦（按值匹配） */
export function bindPreviewToForm(paper, formHost) {
  if (!paper || !formHost) return;
  paper.onclick = (e) => {
    const target = e.target.closest('td, div, span, p, li');
    if (!target) return;
    const text = (target.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80) return;
    const controls = [...formHost.querySelectorAll('input, textarea, select')];
    const hit = controls.find((el) => {
      const v = String(el.value || '').trim();
      return v && v === text;
    });
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
    hit.focus({ preventScroll: true });
    hit.classList.add('ux-flash');
    setTimeout(() => hit.classList.remove('ux-flash'), 1200);
  };
}
