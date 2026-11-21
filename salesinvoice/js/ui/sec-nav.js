/**
 * 左侧表单：分组导航 + 四段化视觉（不改任何单据渲染）
 *
 *  · 表单顶部固定一条「分组导航」：点一下滚到对应分组
 *  · 滚动时自动高亮当前分组
 *  · 每个分组前面插一条分段标题（📋 单据信息 / 🏢 双方 / 📦 货物 / 📝 条款）
 */
import { esc } from '../core/util.js';

/** 把 section id 归到四大段 */
const GROUP_OF = {
  basic: 'info', quotationSign: 'info', contractSign: 'info',
  seller: 'parties', buyer: 'parties', consignee: 'parties', notify: 'parties',
  items: 'goods', price: 'goods', pricing: 'goods', logistics: 'goods',
  containers: 'goods', plref: 'goods', cols: 'goods', ext: 'goods',
  export: 'goods', customsInfo: 'goods',
  terms: 'terms', bank: 'terms', remarks: 'terms',
};
const GROUP_META = {
  info: { label: '单据信息', icon: '📋' },
  parties: { label: '双方信息', icon: '🏢' },
  goods: { label: '货物与费用', icon: '📦' },
  terms: { label: '条款与备注', icon: '📝' },
};
const GROUP_ORDER = ['info', 'parties', 'goods', 'terms'];

/** 在表单顶部插入分组导航并绑定滚动高亮 */
export function mountSectionNav(host) {
  if (!host) return;
  const cards = [...host.querySelectorAll('.card')];
  if (!cards.length) return;

  // 每个 card 对应的 section id（从 data-sec 或标题推断）
  const items = [];
  cards.forEach((card) => {
    const sec = card.getAttribute('data-sec')
      || (card.id && card.id.startsWith('sec-') ? card.id.slice(4) : '');
    const group = GROUP_OF[sec] || 'info';
    if (!items.some((x) => x.group === group)) items.push({ group, card });
  });
  const groups = GROUP_ORDER.filter((g) => items.some((x) => x.group === g));
  if (groups.length < 2) return;

  let nav = host.querySelector('#secNav');
  if (!nav) {
    nav = document.createElement('div');
    nav.id = 'secNav';
    nav.className = 'sec-nav';
    host.insertBefore(nav, host.firstChild);
  }
  nav.innerHTML = groups.map((g, i) => {
    const meta = GROUP_META[g];
    const tip = {
      info: '单据编号 / 日期 / 语言 / 币种等基础信息',
      parties: '卖方（含 LOGO 印章签名）与买方资料',
      goods: '产品明细、唛头、价格与费用',
      terms: '条款、备注、银行信息与签署',
    }[g] || '';
    return `<button type="button" class="sec-nav-btn${i === 0 ? ' active' : ''}" data-goto="${g}" title="${esc(tip)}">
      <span class="ico">${meta.icon}</span>${esc(meta.label)}</button>`;
  }).join('');

  nav.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.onclick = () => {
      const g = btn.getAttribute('data-goto');
      const target = items.find((x) => x.group === g);
      if (!target) return;
      target.card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      nav.querySelectorAll('.sec-nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
    };
  });
}
