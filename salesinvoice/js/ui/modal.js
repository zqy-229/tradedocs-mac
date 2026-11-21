/* =============================================================
 * 弹层：通用 Modal / 确认框 / 表单弹层
 * ============================================================= */

import { esc } from '../core/util.js';

let openCount = 0;

function host() {
  return document.getElementById('modalHost');
}

/**
 * 打开弹层
 * @param {object} opts { title, body(HTMLElement|string), footer(HTMLElement|string), width, onClose }
 * @returns {{el:HTMLElement, close:Function, body:HTMLElement, footer:HTMLElement}}
 */
export function openModal(opts = {}) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';

  const modal = document.createElement('div');
  modal.className = 'modal';
  if (opts.width) modal.style.width = `min(${opts.width}, 100%)`;

  // 头部
  const head = document.createElement('div');
  head.className = 'modal-head';
  const titleEl = document.createElement('span');
  titleEl.textContent = opts.title || '';
  head.appendChild(titleEl);
  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  head.appendChild(spacer);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-sm';
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => close();
  head.appendChild(closeBtn);
  modal.appendChild(head);

  // 主体
  const body = document.createElement('div');
  body.className = 'modal-body';
  if (opts.body instanceof Node) body.appendChild(opts.body);
  else if (typeof opts.body === 'string') body.innerHTML = opts.body;
  modal.appendChild(body);

  // 底部
  const footer = document.createElement('div');
  footer.className = 'modal-foot';
  if (opts.footer instanceof Node) footer.appendChild(opts.footer);
  else if (typeof opts.footer === 'string') footer.innerHTML = opts.footer;
  if (footer.childNodes.length) modal.appendChild(footer);
  else footer.remove();

  mask.appendChild(modal);
  host().appendChild(mask);
  openCount += 1;

  function close() {
    mask.remove();
    openCount = Math.max(0, openCount - 1);
    if (typeof opts.onClose === 'function') opts.onClose();
  }

  mask.addEventListener('mousedown', (e) => {
    if (e.target === mask && opts.closeOnMask !== false) close();
  });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  });

  return { el: modal, body, footer, close };
}

/** 确认框 */
export function confirmModal(message, { title = '请确认', okText = '确定', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    const footer = document.createElement('div');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = cancelText;
    const okBtn = document.createElement('button');
    okBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    okBtn.textContent = okText;
    footer.append(cancel, okBtn);

    const ref = openModal({ title, body: `<div style="font-size:13.5px;line-height:1.7">${esc(message)}</div>`, footer, width: '420px' });
    cancel.onclick = () => { ref.close(); resolve(false); };
    okBtn.onclick = () => { ref.close(); resolve(true); };
    ref.el.parentElement.addEventListener('mousedown', (e) => {
      if (e.target === ref.el.parentElement) resolve(false);
    });
    setTimeout(() => okBtn.focus(), 40);
  });
}

/** 提示框（只有一个确定） */
export function alertModal(message, { title = '提示' } = {}) {
  return new Promise((resolve) => {
    const footer = document.createElement('div');
    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-primary';
    okBtn.textContent = '知道了';
    footer.appendChild(okBtn);
    const ref = openModal({ title, body: `<div style="font-size:13.5px;line-height:1.7">${esc(message)}</div>`, footer, width: '420px' });
    okBtn.onclick = () => { ref.close(); resolve(true); };
  });
}

/** 输入框弹层（替代 window.prompt） */
export function promptModal(label, { title = '请输入', value = '', placeholder = '', multiline = false } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="field"><label>${esc(label)}</label></div>`;
    const input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    if (multiline) input.style.minHeight = '140px';
    wrap.querySelector('.field').appendChild(input);

    const footer = document.createElement('div');
    const cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = '取消';
    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-primary';
    okBtn.textContent = '确定';
    footer.append(cancel, okBtn);

    // ⚠️ 必须"先定值再关闭"：ref.close() 会触发 onClose → 如果那里先 resolve(null)，
    //    点「确定」永远拿不到输入值（自定义列加不上的 bug 就是这么来的）。
    // 用 settled 保证只结算一次，且确定优先。
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; resolve(v); };
    const ref = openModal({ title, body: wrap, footer, width: '520px', onClose: () => finish(null) });
    cancel.onclick = () => { finish(null); ref.close(); };
    okBtn.onclick = () => { finish(input.value); ref.close(); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !multiline) { finish(input.value); ref.close(); }
    });
    setTimeout(() => input.focus(), 50);
  });
}

/** 任意内容的弹层快捷封装 */
export function customModal({ title, render, width = '640px' }) {
  const body = document.createElement('div');
  const ref = openModal({ title, body, width });
  render(body, ref);
  return ref;
}

export function hasOpenModal() {
  return openCount > 0;
}
