/* =============================================================
 * 浏览器端自测（仅当 URL 带 ?test=1 时执行）
 * 目的：在真实浏览器环境验证 IndexedDB 读写、表单绑定、自动计算、
 *       编号递增、单据联动、5 套单据渲染、多语言输出是否正常
 * 结果写入 DOM（#smokeResult），便于 headless 抓取
 * ============================================================= */

import * as db from './core/db.js';
import { STORES } from './core/db.js';
import * as store from './core/store.js';
import { state } from './core/store.js';
import { recalcDoc } from './core/calc.js';
import { DOC_TYPES, docMeta, emptyItem, emptyParty, visibleDocTypes } from './core/schema.js';
import { TEMPLATES, getTemplate, DOC_LANGS } from './core/templates.js';
import { isFixedFormatDoc, isDocTypeHidden } from './core/schema.js';
import { renderDocument, renderStandaloneHtml } from './doc/render.js';
import { pdfFileName } from './doc/pdf.js';

const results = [];
const consoleErrors = [];

function ok(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, err: e && e.message ? e.message : String(e) });
  }
}

async function okAsync(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
  } catch (e) {
    results.push({ name, pass: false, err: e && e.message ? e.message : String(e) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || '值不相等'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

/** 等待条件成立 */
function waitFor(fn, timeout = 6000, step = 60) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let v = false;
      try { v = fn(); } catch { v = false; }
      if (v) return resolve(v);
      if (Date.now() - started > timeout) return reject(new Error('等待超时'));
      setTimeout(tick, step);
    };
    tick();
  });
}

export async function runSmokeTest() {
  // 捕获控制台错误，便于定位
  const origError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.map((a) => (a && a.message) || String(a)).join(' '));
    origError.apply(console, args);
  };
  window.addEventListener('error', (e) => consoleErrors.push(`window.error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => consoleErrors.push(`unhandled: ${e.reason}`));

  // ---- 1. 本地数据库 ----
  await okAsync('IndexedDB 可写入与读取（草稿）', async () => {
    const doc = await store.createDoc('quotation', { number: 'QT-TEST-001' });
    const read = await db.getDoc(doc.id);
    assert(read, '读回草稿失败');
    eq(read.docNo, 'QT-TEST-001', '编号不一致');
  });

  await okAsync('IndexedDB 设置项持久化', async () => {
    await db.setSetting('__smoke', { a: 1 });
    const v = await db.getSetting('__smoke');
    eq(v && v.a, 1, '设置未持久化');
  });

  // ---- 2. 编号自动递增 ----
  await okAsync('单据编号自动递增', async () => {
    const d1 = await store.createDoc('pi');
    const d2 = await store.createDoc('pi');
    assert(d1.docNo && d2.docNo && d1.docNo !== d2.docNo, `编号未递增: ${d1.docNo} / ${d2.docNo}`);
    const n1 = Number(String(d1.docNo).split('-').pop());
    const n2 = Number(String(d2.docNo).split('-').pop());
    eq(n2, n1 + 1, '编号序号应 +1');
  });

  // ---- 3. 表单渲染 + 自动计算 + 预览 ----
  await okAsync('全部单据表单与预览均可渲染（水单是银行凭证，本身没有产品明细表）', async () => {
    const mod = await import('./ui/form.js');
    for (const t of DOC_TYPES) {
      const d = await store.createDoc(t.type);
      state.doc = d;
      const host = document.getElementById('formHost');
      mod.renderForm(host, () => {});
      assert(host.innerHTML.length > 500, `${t.type} 表单未渲染`);
      const html = renderDocument(d);
      assert(html && html.includes('doc-root'), `${t.type} 预览未生成`);
      // 水单（mode:bank）按银行收付凭证版式渲染，设计上就没有产品明细行与明细表
      if (docMeta(t.type).mode === 'bank') continue;
      assert(host.querySelector('[data-section="items"]'), `${t.type} 缺少产品明细区`);
      assert(host.querySelectorAll('tr[data-row]').length >= 1, `${t.type} 产品行未渲染`);
      // 报关单走专用版式（对照「中华人民共和国海关出口货物报关单」的带框格表格）
      if (t.type === 'customs_declaration') {
        assert(html.includes('doc-customs') && /class="cus/.test(html), `${t.type} 报关单专用表格版式未生成`);
        continue;
      }
      // 海运提单走专用版式（对照标准海运提单样本 4-1 的 1~22 栏目）
      if (t.type === 'bill_of_lading') {
        assert(html.includes('doc-bl') && /class="bl-/.test(html), `${t.type} 提单专用表格版式未生成`);
        assert(html.includes('<b>1.</b> SHIPPER') && html.includes('<b>22.</b> SIGNED FOR THE CARRIER'), `${t.type} 提单栏目编号不全`);
        continue;
      }
      // 装船指示 / 装船通知 走自己的版式（si-items / sa-items）
      // 注意：这里测的是**空白单据**的版式，所以不校验"有没有截补料时间"这类内容
      if (t.type === 'shipping_instruction') {
        assert(/class="[^"]*doc-si/.test(html) && /<table class="si-items"/.test(html), `${t.type} 装船指示版式未生成`);
        continue;
      }
      if (t.type === 'shipping_advice') {
        assert(/class="[^"]*doc-sa/.test(html) && /<table class="sa-items"/.test(html), `${t.type} 装船通知版式未生成`);
        continue;
      }
      // 申报要素表：自己的表格版式
      if (t.type === 'declaration_elements') {
        assert(/class="[^"]*doc-de/.test(html) && /<table class="de-table"/.test(html), `${t.type} 申报要素表版式未生成`);
        continue;
      }
      // 其余用通用明细表（装箱单是 doc-table pl-table，class 后面还有别的类名）
      assert(/<table class="doc-table[\s"]/.test(html), `${t.type} 预览表格未生成`);
    }
  });

  await okAsync('表单输入触发金额联动重算', async () => {
    state.doc = await store.createDoc('quotation');
    state.doc.items = [
      { ...emptyItem(0), description: 'Widget A', qty: 10, unitPrice: 12.5 },
      { ...emptyItem(1), description: 'Widget B', qty: 4, unitPrice: 30 },
    ];
    recalcDoc(state.doc);
    const mod = await import('./ui/form.js');
    mod.renderForm(document.getElementById('formHost'), () => {});
    eq(document.querySelector('[data-total="amount"]').textContent.trim(), 'USD 245.00', '合计显示错误');
    const first = document.querySelector('tr[data-row="0"] [data-row-amount]');
    eq(first.textContent.trim(), '125.00', '首行金额显示错误');
  });

  await okAsync('修改数量后金额自动刷新', async () => {
    const input = document.querySelector('input[data-bind="items.0.qty"]');
    assert(input, '未找到数量输入框');
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    eq(document.querySelector('tr[data-row="0"] [data-row-amount]').textContent.trim(), '250.00', '行金额未刷新');
    assert(document.querySelector('[data-total="amount"]').textContent.includes('370.00'), '合计未刷新');
  });

  await okAsync('自动保存把输入写入本地库', async () => {
    const doc = state.doc;
    await store.flushAutosave();
    const read = await db.getDoc(doc.id);
    eq(Number(read.items[0].qty), 20, '数量未保存');
    assert(read.totals.totalAmount > 0, '合计未保存');
  });

  // ---- 4. 单据联动 ----
  await okAsync('报价单 → PI / 合同 / CI / PL 一键联动带数据', async () => {
    state.doc.buyer = { ...state.doc.buyer, companyName: 'ACME TRADING CO., LTD.', country: 'USA' };
    state.doc.destination = 'LOS ANGELES';
    state.doc.items[0].hsCode = '8481804090';
    const pi = await store.generateFrom(state.doc, 'pi');
    eq(pi.buyer.companyName, 'ACME TRADING CO., LTD.', 'PI 未带入买方');
    eq(pi.items.length, 2, 'PI 未带入产品行');
    eq(pi.destination, 'LOS ANGELES', 'PI 未带入目的港');
    eq(pi.sourceDocId, state.doc.id, '未记录来源单据');
    assert(pi.docNo !== state.doc.docNo, '编号应重新生成');

    const sc = await store.generateFrom(pi, 'contract');
    assert(sc.contractClauses.length === 7, `合同应带 7 条条款，实为 ${sc.contractClauses.length}`);

    const ci = await store.generateFrom(state.doc, 'ci');
    eq(ci.countryOfOrigin, 'CHINA', 'CI 原产国默认值缺失');
    eq(ci.items[0].hsCode, '8481804090', 'CI 未带入 HS 编码');

    const pl = await store.generateFrom(state.doc, 'pl');
    assert(pl.items[0].ctns >= 1, '装箱单未设置箱数');
  });

  await okAsync('复制单据后两单互不影响', async () => {
    const src = await store.createDoc('quotation');
    src.items[0].description = '原始品名';
    await store.persistDoc(src);
    const copy = await store.duplicateDoc(src.id);
    copy.items[0].description = '副本品名';
    await store.persistDoc(copy);
    const reread = await db.getDoc(src.id);
    eq(reread.items[0].description, '原始品名', '原单据被副本修改影响');
  });

  // ---- 5. 多语言输出 ----
  await okAsync('中/英/泰三种语言预览与关键字段', async () => {
    const doc = await store.createDoc('contract');
    doc.docLang = 'th';
    doc.docNo = 'SC-TH-001';
    doc.buyer.companyName = 'บริษัท ทดสอบ จำกัด';
    const th = renderDocument(doc);
    assert(th.includes('สัญญาการซื้อขาย'), '泰语标题缺失');
    assert(th.includes('บริษัท ทดสอบ จำกัด'), '泰语客户名缺失');
    assert(th.includes('จำนวน'), '泰语表头缺失');

    doc.docLang = 'zh';
    const zh = renderDocument(doc);
    assert(zh.includes('销售合同'), '中文标题缺失');
    assert(zh.includes('总金额'), '中文合计缺失');

    doc.docLang = 'en';
    const en = renderDocument(doc);
    assert(en.includes('SALES CONTRACT'), '英文标题缺失');

    // 导出用独立 HTML
    const standalone = renderStandaloneHtml(doc);
    assert(standalone.includes('<!DOCTYPE html>') && standalone.includes('doc-table'), '独立 HTML 不完整');
  });

  await okAsync('金额大写按语言输出', async () => {
    const { amountInWords } = await import('./core/calc.js');
    assert(amountInWords(1234.5, 'en', 'USD').includes('ONE THOUSAND'), '英文大写错误');
    assert(amountInWords(1234.5, 'zh', 'CNY').includes('壹仟'), '中文大写错误');
  });

  await okAsync('PDF 文件名安全且含编号', () => {
    const name = pdfFileName({ docNo: 'QT-001', type: 'quotation', buyer: { companyName: 'ACME/TRADING:CO' } });
    assert(name.endsWith('.pdf'), '文件名后缀错误');
    assert(!/[\\/:*?"<>|]/.test(name), `文件名含非法字符: ${name}`);
    assert(name.includes('QT-001'), '文件名应含编号');
  });

  // ---- 6. 模板语言包完整性 ----
  ok('各语言单据标题完整（缺的按英语包兜底，但不能退化成类型键）', () => {
    for (const code of ['en', 'zh', 'th']) {
      for (const t of DOC_TYPES) {
        const title = getTemplate(code).docTitle[t.type];
        assert(title && title !== t.type, `${code}.${t.type} 标题缺失或退化成类型键`);
      }
    }
  });

  // ---- 7. 资料库 ----
  await okAsync('客户库 / 产品库 / 条款库可存取', async () => {
    const c = await store.saveCustomer({ name: 'Test Customer', companyName: 'Test Customer', country: 'USA' });
    assert(store.state.customers.some((x) => x.id === c.id), '客户未进入内存库');
    const p = await store.saveProduct({ name: 'Test Product', model: 'M1', hsCode: '1234' });
    assert(store.state.products.some((x) => x.id === p.id), '产品未进入内存库');
    const cl = await store.saveClause({ name: 'Test Clause', category: 'general', body: 'terms body' });
    assert(store.state.clauses.some((x) => x.id === cl.id), '条款未进入内存库');
  });

  // ---- 8. 备份 / 恢复 ----
  await okAsync('导出备份 → 清空 → 导入恢复', async () => {
    const backup = await store.exportBackup();
    const docCount = (backup.data[STORES.docs] || []).length;
    assert(docCount > 0, '备份里没有单据');
    await store.clearAllData();
    eq(store.state.docs.length, 0, '清空失败');
    await store.importBackup(backup);
    await store.refreshDocs();
    eq(store.state.docs.length, docCount, '恢复后单据数量不一致');
  });

  // ---- 9. 界面关键元素 ----
  ok('顶部 Tab / 预览 / 底部状态栏元素齐全', () => {
    eq(document.querySelectorAll('#docTabs .doc-tab').length, visibleDocTypes().length, `应有 ${visibleDocTypes().length} 个单据 Tab（隐藏的类型不出现）`);
    assert(document.getElementById('paper'), '缺少预览纸张容器');
    // 固定格式单据（报关单 / 提单 / 水单）只给中文 / 英文，其他单据 13 种语言
    const langType = (store.state.doc && store.state.doc.type) || '';
    const wantLangs = isFixedFormatDoc(langType) ? 2 : DOC_LANGS.length;
    eq(document.getElementById('previewLang').options.length, wantLangs,
      `${langType || '通用'} 单据语言应有 ${wantLangs} 项`);
    assert(document.getElementById('statusDoc'), '缺少状态栏');
    assert(document.querySelector('.mobile-tabbar'), '缺少手机底部导航');
    assert(document.getElementById('statusChip'), '缺少草稿/已保存状态标识');
    assert(document.getElementById('btnMarkSaved'), '缺少「标记为已保存」按钮');
    assert(document.getElementById('btnHelp'), '缺少使用帮助入口');
  });

  // ---- 11. 草稿 / 已保存单据 分离 ----
  await okAsync('新建单据状态为草稿，且草稿列表只含草稿', async () => {
    const d = await store.createDoc('quotation');
    eq(d.status, 'draft', '新单据应为草稿');
    eq(d.savedAt, 0, '草稿不应有定稿时间');
    const drafts = store.draftDocs();
    const saved = store.savedDocs();
    assert(drafts.some((x) => x.id === d.id), '新单据应出现在草稿列表');
    assert(!saved.some((x) => x.id === d.id), '新单据不应出现在已保存列表');
  });

  await okAsync('完整性检查：缺信息时不允许标记为已保存', async () => {
    // 这条测的是「缺信息拦截」，所以要一张**空白**单据：
    // 新建时默认会预填完整示例（见设置里的「新建单据时预填完整示例」），这里显式关掉
    const d = await store.createDoc('quotation', { sample: false });
    const r1 = await store.markDocSaved(d);            // 没填买卖双方与产品
    eq(r1.ok, false, '空单据不应允许存为正式单据');
    assert(['no-seller', 'no-buyer', 'no-items'].includes(r1.reason), `原因异常: ${r1.reason}`);

    d.seller.companyName = 'SELLER CO';
    const r2 = await store.markDocSaved(d);
    eq(r2.reason, 'no-buyer', '应提示缺买方');

    d.buyer.companyName = 'BUYER CO';
    const r3 = await store.markDocSaved(d);
    eq(r3.reason, 'no-items', '应提示缺产品行');
  });

  await okAsync('信息齐全后可标记为已保存，并从草稿移入已保存', async () => {
    const d = await store.createDoc('quotation');
    d.seller.companyName = 'SELLER CO';
    d.buyer.companyName = 'BUYER CO';
    d.items[0].description = 'Widget';
    d.items[0].qty = 2;
    d.items[0].unitPrice = 5;
    await store.persistDoc(d);
    const r = await store.markDocSaved(store.state.doc && store.state.doc.id === d.id ? store.state.doc : d);
    eq(r.ok, true, `标记失败: ${r.reason}`);
    const reread = await db.getDoc(d.id);
    eq(reread.status, 'saved', '库中状态应为 saved');
    assert(reread.savedAt > 0, '应记录定稿时间');
    assert(store.savedDocs().some((x) => x.id === d.id), '应出现在已保存列表');
    assert(!store.draftDocs().some((x) => x.id === d.id), '不应再出现在草稿列表');
  });

  await okAsync('已保存单据可退回草稿', async () => {
    const target = store.savedDocs()[0];
    assert(target, '没有可测试的已保存单据');
    const doc = await store.openDoc(target.id);
    await store.markDocDraft(doc);
    const reread = await db.getDoc(target.id);
    eq(reread.status, 'draft', '应退回草稿');
    eq(reread.savedAt, 0, '应清除定稿时间');
    assert(store.draftDocs().some((x) => x.id === target.id), '应回到草稿列表');
  });

  await okAsync('单据联动生成的单据是草稿', async () => {
    const src = await store.createDoc('quotation');
    src.seller.companyName = 'S';
    src.buyer.companyName = 'B';
    src.items[0].description = 'X';
    await store.persistDoc(src);
    const pi = await store.generateFrom(src, 'pi');
    eq(pi.status, 'draft', '联动生成应为草稿');
  });

  await okAsync('复制单据得到的是新草稿且编号不同', async () => {
    const src = await store.createDoc('quotation');
    await store.persistDoc(src);
    await store.markDocSaved(src);
    const copy = await store.duplicateDoc(src.id);
    eq(copy.status, 'draft', '副本应为草稿');
    assert(copy.docNo !== src.docNo, '副本应换新编号');
    eq(copy.savedAt, 0, '副本不应带定稿时间');
  });

  await okAsync('草稿/已保存 计数与页签一致', async () => {
    const counts = store.docCounts();
    const totalDraft = Object.values(counts).reduce((s, c) => s + c.draft, 0);
    const totalSaved = Object.values(counts).reduce((s, c) => s + c.saved, 0);
    eq(totalDraft, store.draftDocs().length, '草稿计数不一致');
    eq(totalSaved, store.savedDocs().length, '已保存计数不一致');
  });

  await okAsync('抽屉可在「草稿 / 已保存单据」之间切换筛选', async () => {
    document.getElementById('btnDrafts').click();
    await waitFor(() => document.querySelector('#draftTabs button[data-tab="saved"]'), 3000);
    const tabs = document.querySelectorAll('#draftTabs button');
    eq(tabs.length, 2, '应有两个页签');

    tabs[0].click();
    await new Promise((r) => setTimeout(r, 80));
    const draftRows = document.querySelectorAll('#draftList .draft-item').length;
    const visibleOf = (list) => list.filter((d) => !isDocTypeHidden(d.type));
    eq(draftRows, visibleOf(store.draftDocs()).length,
      `草稿页签行数应为 ${visibleOf(store.draftDocs()).length}（隐藏类型的单据不显示）`);

    tabs[1].click();
    await new Promise((r) => setTimeout(r, 80));
    const savedRows = document.querySelectorAll('#draftList .draft-item').length;
    eq(savedRows, visibleOf(store.savedDocs()).length,
      `已保存页签行数应为 ${visibleOf(store.savedDocs()).length}（隐藏类型的单据不显示）`);
    assert(document.querySelector('#draftList .badge-saved') !== null || savedRows === 0, '已保存列表应显示已保存徽标');

    const cntDraft = Number(document.getElementById('cntDraft').textContent);
    const cntSaved = Number(document.getElementById('cntSaved').textContent);
    // 计数徽标也只数「显示中的类型」（隐藏类型的单据不显示，计数也应一致）
    eq(cntDraft, visibleOf(store.draftDocs()).length, '草稿计数徽标错误（应只数显示中的类型）');
    eq(cntSaved, visibleOf(store.savedDocs()).length, '已保存计数徽标错误（应只数显示中的类型）');
    document.getElementById('drawerDraftsClose').click();
  });

  // ---- 12. 多语言 ----
  await okAsync('12 种语言都能渲染出正确标题与表头', async () => {
    const langs = ['en', 'zh', 'th', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'vi', 'ja', 'ko'];
    const expect = {
      en: 'QUOTATION', zh: '报价单', th: 'ใบเสนอราคา', es: 'COTIZACIÓN', fr: 'DEVIS',
      de: 'ANGEBOT', pt: 'COTAÇÃO', ru: 'КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ', ar: 'عرض سعر',
      vi: 'BẢNG BÁO GIÁ', ja: '御見積書', ko: '견적서',
    };
    const doc = await store.createDoc('quotation');
    doc.seller.companyName = 'SELLER';
    doc.buyer.companyName = 'BUYER';
    for (const code of langs) {
      doc.docLang = code;
      const html = renderDocument(doc);
      assert(html.includes(expect[code]), `${code} 标题渲染缺失: ${expect[code]}`);
      assert(html.includes('doc-table'), `${code} 表格未渲染`);
      const dir = code === 'ar' ? 'rtl' : 'ltr';
      assert(html.includes(`dir="${dir}"`), `${code} 方向应为 ${dir}`);
    }
    doc.docLang = 'en';
  });

  await okAsync('阿拉伯语单据为 RTL 且镜像排版', async () => {
    const doc = await store.createDoc('pi');
    doc.docLang = 'ar';
    doc.seller.companyName = 'شركة الاختبار';
    doc.buyer.companyName = 'شركة المشتري';
    const html = renderDocument(doc);
    assert(html.includes('dir="rtl"'), '根节点应带 dir=rtl');
    assert(html.includes('lang="ar"'), '根节点应带 lang=ar');
    assert(html.includes('فاتورة أولية'), '阿语标题缺失');
    assert(html.includes('شركة الاختبار'), '阿语公司名缺失');
    assert(html.includes('الكمية'), '阿语表头缺失');
  });

  await okAsync('非英文单据带英文标准名副标题', async () => {
    const doc = await store.createDoc('pi');
    doc.docLang = 'ja';
    const html = renderDocument(doc);
    assert(html.includes('PROFORMA INVOICE'), '非英文单据应显示英文标准名，方便国外客户识别');
    doc.docLang = 'zh';
    const zh = renderDocument(doc);
    assert(zh.includes('PROFORMA INVOICE'), '中文单据也应带英文副标题');
  });

  await okAsync('切换单据语言后表单与预览同步（含阿拉伯语）', async () => {
    const doc = await store.createDoc('quotation');
    store.state.doc = doc;
    const formMod = await import('./ui/form.js');
    formMod.refreshFormView();
    const sel = document.getElementById('previewLang');
    for (const code of ['ar', 'ja', 'de', 'zh', 'en']) {
      sel.value = code;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const langSelect = document.querySelector('#formHost select[data-bind="docLang"]');
      assert(langSelect && langSelect.value === code, `表单语言未同步到 ${code}`);
    }
  });

  // ---- 13. 面向中年用户的可用性 ----
  await okAsync('大字号模式可切换并持久化', async () => {
    const btn = document.getElementById('btnHelp');
    assert(btn, '缺少帮助入口');
    // 直接测试设置项读写（不打开弹层，避免干扰）
    await db.setSetting('bigText', true);
    document.documentElement.setAttribute('data-bigtext', '1');
    const lh = getComputedStyle(document.documentElement).fontSize;
    assert(parseFloat(lh) >= 17, `大字号应放大基础字号，实际 ${lh}`);
    document.documentElement.setAttribute('data-bigtext', '0');
    await db.setSetting('bigText', false);
  });

  await okAsync('帮助面板可打开且含三步说明', async () => {
    document.getElementById('btnHelp').click();
    await waitFor(() => document.querySelector('#modalHost .help-step'), 3000);
    const steps = document.querySelectorAll('#modalHost .help-step').length;
    eq(steps, 3, '帮助应有 3 步');
    assert(document.querySelector('#modalHost .help-tipbox'), '帮助应说明草稿与已保存的区别');
    const closeBtn = document.querySelector('#modalHost .modal-foot .btn');
    closeBtn.click();
    await new Promise((r) => setTimeout(r, 120));
  });

  await okAsync('关键字段带悬停说明（降低理解成本）', async () => {
    const doc = await store.createDoc('quotation');
    doc.items[0].description = 'X';
    store.state.doc = doc;
    const formMod = await import('./ui/form.js');
    formMod.refreshFormView();
    const currencySelect = document.querySelector('#formHost select[data-bind="currency"]');
    assert(currencySelect, '未找到币种下拉');
    assert(currencySelect.getAttribute('title'), '币种下拉应有说明');
    const firstOpt = currencySelect.options[0].textContent;
    assert(firstOpt.includes('美元') || firstOpt.includes('$'), `币种选项应含中文名，实际 ${firstOpt}`);
    const incotermsSelect = document.querySelector('#formHost select[data-bind="incoterms"]');
    assert(incotermsSelect.options[0].textContent.includes('—'), '贸易术语应带中文解释');
    assert(document.querySelector('#formHost .tip-mark'), '字段应有 ? 说明标记');
  });

  await okAsync('手机端底部导航标签完整', async () => {
    const labels = Array.from(document.querySelectorAll('#mobileTabbar button')).map((b) => b.textContent.trim());
    eq(labels.length, 4, '底部导航应有 4 项');
    assert(labels.every((l) => l.length > 0), '底部导航标签不应为空');
    assert(!labels.some((l) => l.includes('Save Draft') || l.includes('保存草稿')), '底部导航不应误用「保存草稿」文案');
  });

  await okAsync('缩放控件可改变纸张比例', async () => {
    document.getElementById('zoom100').click();
    await new Promise((r) => setTimeout(r, 40));
    eq(document.getElementById('zoomValue').textContent, '100%', '缩放未切换到 100%');
    document.getElementById('zoomFit').click();
    await new Promise((r) => setTimeout(r, 40));
    assert(/^\d+%$/.test(document.getElementById('zoomValue').textContent), '适合宽度未生效');
  });

  // ---- 10. 真实 UI 交互（点 Tab / 切语言 / 预览联动） ----
  await okAsync('点击顶部 Tab 可切换单据类型', async () => {
    const tab = document.querySelector('#docTabs .doc-tab[data-type="pi"]');
    assert(tab, '未找到 PI Tab');
    tab.click();
    await waitFor(() => document.querySelector('#docTabs .doc-tab[data-type="pi"]').classList.contains('active'), 4000);
    await waitFor(() => document.querySelector('#formHost [data-section="bank"]'), 4000);
    assert(document.querySelector('#formHost [data-section="bank"]'), 'PI 表单应含银行信息区');
  });

  await okAsync('切换单据语言后右侧预览同步变更', async () => {
    const sel = document.getElementById('previewLang');
    sel.value = 'th';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => (document.getElementById('paper').innerText || '').includes('ใบแจ้งหนี้ชั่วคราว'), 5000);
    assert((document.getElementById('paper').innerText || '').includes('ใบแจ้งหนี้ชั่วคราว'), '预览未切换为泰语');

    sel.value = 'en';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => (document.getElementById('paper').innerText || '').includes('PROFORMA INVOICE'), 5000);
    assert(true);
  });

  await okAsync('新建按钮生成带编号的空白单据', async () => {
    const before = store.state.docs.filter((d) => d.type === 'ci').length;
    const created = await store.createDoc('ci');
    assert(String(created.docNo).startsWith('CI-'), `CI 编号格式错误: ${created.docNo}`);
    const after = store.state.docs.filter((d) => d.type === 'ci').length;
    eq(after, before + 1, '新建后草稿数量应 +1');
  });

  await okAsync('汇率换算助手可打开并计算、应用到空单价行', async () => {
    const doc = await store.createDoc('quotation');
    doc.currency = 'USD';
    doc.items = [{ ...emptyItem(0), description: 'FX 测试', qty: 10, unitPrice: 0 }];
    store.state.doc = doc;                       // 直接挂到当前单据
    const mod = await import('./ui/form.js');
    mod.refreshFormView();                       // 仅重画表单，不新建单据
    const btn = document.querySelector('[data-act="fx-helper"]');
    assert(btn, '未找到汇率换算助手按钮');
    btn.click();
    await waitFor(() => document.querySelector('#fxCost'), 3000);
    const cost = document.querySelector('#fxCost');
    const rate = document.querySelector('#fxRate');
    const margin = document.querySelector('#fxMargin');
    cost.value = '700';
    rate.value = '7';
    margin.value = '10';
    cost.dispatchEvent(new Event('input', { bubbles: true }));
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    margin.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const out = document.querySelector('#fxOut').value;
    assert(out.includes('110.00'), `700 元 ÷ 7 × 1.1 应约 110，实际 ${out}`);
    const applyBtn = Array.from(document.querySelectorAll('.modal-foot .btn')).find((b) => b.textContent.includes('应用到所有空单价'));
    assert(applyBtn, '未找到应用按钮');
    applyBtn.click();
    await new Promise((r) => setTimeout(r, 150));
    eq(Number(doc.items[0].unitPrice), 110, '单价未应用');
    eq(Number(doc.totals.totalAmount), 1100, '合计未重算');
  });

  await okAsync('装箱单不显示条款与银行信息', async () => {
    const src = await store.createDoc('pi');
    src.bank.accountNo = '1234567890';
    src.terms = 'PI TERMS SHOULD NOT LEAK';
    await store.persistDoc(src);
    const pl = await store.generateFrom(src, 'pl');
    eq(pl.terms, '', '装箱单不应带条款');
    const html = renderDocument(pl);
    assert(!html.includes('PI TERMS SHOULD NOT LEAK'), '装箱单预览泄漏了 PI 条款');
    assert(!html.includes('1234567890'), '装箱单预览泄漏了银行账号');
  });

  await okAsync('无单据时工具栏不应显示「标记为已保存」', async () => {
    // 走应用真实的 renderAll 路径（?test=1 下同样暴露了调试钩子）
    assert(window.__TD__ && typeof window.__TD__.renderAll === 'function', '缺少 renderAll 调试钩子');
    const keep = store.state.doc;
    store.state.doc = null;
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 120));
    const chip = document.getElementById('statusChip');
    const ms = document.getElementById('btnMarkSaved');
    const bd = document.getElementById('btnBackDraft');
    eq(chip.getAttribute('data-status'), 'none', `无单据时状态标识应为 none，实际 ${chip.getAttribute('data-status')}`);
    eq(getComputedStyle(chip).display, 'none', `无单据时状态标识应隐藏，实际 ${getComputedStyle(chip).display}`);
    eq(getComputedStyle(ms).display, 'none', `无单据时「标记为已保存」应隐藏，实际 ${getComputedStyle(ms).display}`);
    eq(getComputedStyle(bd).display, 'none', `无单据时「退回草稿」应隐藏，实际 ${getComputedStyle(bd).display}`);
    store.state.doc = keep;
    window.__TD__.renderAll();
  });

  await okAsync('有草稿时状态标识与按钮正确显示', async () => {
    const d = await store.createDoc('quotation');
    store.state.doc = d;
    window.__TD__ && window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 120));
    const chip = document.getElementById('statusChip');
    eq(chip.dataset.status, 'draft', '状态标识应为草稿');
    eq(getComputedStyle(chip).display !== 'none', true, '草稿状态下状态标识应可见');
    eq(document.getElementById('btnMarkSaved').hidden, false, '草稿应显示「标记为已保存」');
    eq(document.getElementById('btnBackDraft').hidden, true, '草稿不应显示「退回草稿」');
  });

  // ---- 14. 底部留白 / 尺寸（防止内容被固定底栏遮盖） ----
  await okAsync('左栏底部留白足够，内容不被状态栏遮盖', async () => {
    const doc = await store.createDoc('pi');
    doc.seller.companyName = 'SELLER CO';
    doc.buyer.companyName = 'BUYER CO';
    doc.items = Array.from({ length: 6 }, (_, i) => ({
      ...emptyItem(i), description: 'Item ' + i, qty: 10, unitPrice: 5,
    }));
    doc.bank.bankName = 'BANK OF CHINA';
    doc.terms = 'Terms. '.repeat(60);
    await store.persistDoc(doc);
    window.__TD__.mountDoc(doc);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 200));

    const pane = document.getElementById('paneLeft');
    pane.scrollTop = pane.scrollHeight;
    await new Promise((r) => setTimeout(r, 60));
    const status = document.querySelector('.status-bar');
    const statusTop = status.getBoundingClientRect().top;
    const padBottom = parseFloat(getComputedStyle(pane).paddingBottom) || 0;
    // 内容底边（含 padding）不应超过状态栏顶边
    const contentBottom = pane.getBoundingClientRect().bottom - padBottom;
    assert(padBottom >= 60, `左栏底部留白应 >= 60px，实际 ${padBottom}px`);
    assert(contentBottom <= statusTop + 1,
      `内容底边 ${Math.round(contentBottom)} 不应越过状态栏顶边 ${Math.round(statusTop)}`);
    // 最后一个区块的底边也应留出空隙
    const last = pane.lastElementChild;
    const lastBottom = last.getBoundingClientRect().bottom;
    assert(lastBottom <= statusTop + 1, `最后区块底边 ${Math.round(lastBottom)} 被状态栏遮盖`);
  });

  await okAsync('模态框内容底部有留白，按钮不被裁掉', async () => {
    document.getElementById('btnHelp').click();
    await waitFor(() => document.querySelector('#modalHost .modal-body'), 3000);
    await new Promise((r) => setTimeout(r, 150));
    const bodyEl = document.querySelector('#modalHost .modal-body');
    const pad = parseFloat(getComputedStyle(bodyEl).paddingBottom) || 0;
    assert(pad >= 12, `模态框内容底部留白应 >= 12px，实际 ${pad}px`);
    const footEl = document.querySelector('#modalHost .modal-foot');
    assert(footEl, '模态框应有底部按钮区');
    document.querySelector('#modalHost .modal-foot .btn').click();
    await new Promise((r) => setTimeout(r, 120));
  });

  // ---- 15. 输入历史与下拉自动补全 ----
  await okAsync('填过的公司名会记入输入历史（去重 + 最近优先）', async () => {
    await store.clearHistory();
    await store.rememberValue('seller.companyName', 'SHENZHEN SUNVL TECHNOLOGY CO., LTD.');
    await store.rememberValue('seller.companyName', 'GUANGZHOU BRIGHT IMPORT & EXPORT CO.');
    await store.rememberValue('seller.companyName', 'SHENZHEN SUNVL TECHNOLOGY CO., LTD.'); // 重复填一次
    const raw = store.historyOf('seller.companyName');
    eq(raw.length, 2, `应去重为 2 条，实际 ${raw.length}`);
    assert(raw.every((x) => x && typeof x.value === 'string' && typeof x.count === 'number'),
      '历史条目应为 {value,count,lastUsed} 结构');
    const vals = store.historyValues('seller.companyName');
    assert(vals.every((v) => typeof v === 'string'), 'historyValues 应返回字符串数组');
    eq(vals[0], 'SHENZHEN SUNVL TECHNOLOGY CO., LTD.', '最近填过的应排在最前');
    assert(store.historyTotal() >= 2, '历史总数应统计到');
  });

  await okAsync('下拉候选按最近填写优先排序', async () => {
    await store.clearHistory();
    await store.rememberValue('city', '广州');
    await store.rememberValue('city', '深圳');
    eq(store.historyValues('city')[0], '深圳', '最近填的应排在最前');
    await store.rememberValue('city', '广州');   // 再填一次广州 → 变成最近
    eq(store.historyValues('city')[0], '广州', '重新填过的应升到最前');
  });

  await okAsync('输入框带 datalist 候选，可直接下拉选择', async () => {
    await store.rememberValue('seller.companyName', 'SHENZHEN SUNVL TECHNOLOGY CO., LTD.');
    await store.rememberValue('seller.companyName', 'NINGBO NEW HORIZON INDUSTRIAL CO., LTD.');
    const doc = await store.createDoc('quotation');
    doc.seller.companyName = '';
    window.__TD__.mountDoc(doc);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 200));
    const input = document.querySelector('#formHost input[data-bind="seller.companyName"]');
    assert(input, '未找到卖方公司名输入框');
    const listId = input.getAttribute('list');
    assert(listId, '公司名输入框应绑定 datalist');
    const dl = document.getElementById(listId);
    assert(dl, `datalist ${listId} 不存在`);
    const values = Array.from(dl.querySelectorAll('option')).map((o) => o.value);
    assert(values.length >= 2, `候选应至少 2 条，实际 ${values.length}: ${JSON.stringify(values)}`);
    assert(values.includes('NINGBO NEW HORIZON INDUSTRIAL CO., LTD.'), '候选应包含填过的公司名');
  });

  await okAsync('买方公司名候选会带上客户库', async () => {
    await store.saveCustomer({ name: 'ACME TRADING CO., LTD.', companyName: 'ACME TRADING CO., LTD.', city: 'Los Angeles' });
    const doc = await store.createDoc('quotation');
    window.__TD__.mountDoc(doc);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 200));
    const input = document.querySelector('#formHost input[data-bind="buyer.companyName"]');
    const dl = document.getElementById(input.getAttribute('list'));
    const values = Array.from(dl.querySelectorAll('option')).map((o) => o.value);
    assert(values.includes('ACME TRADING CO., LTD.'), `买方候选应含客户库公司，实际 ${JSON.stringify(values)}`);
  });

  await okAsync('买方公司名匹配客户库时自动补全其余字段', async () => {
    const doc = await store.createDoc('quotation');
    window.__TD__.mountDoc(doc);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 200));
    const input = document.querySelector('#formHost input[data-bind="buyer.companyName"]');
    input.value = 'ACME TRADING CO., LTD.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    eq(doc.buyer.city, 'Los Angeles', '选中客户后城市应自动填好');
    const cityInput = document.querySelector('#formHost input[data-bind="buyer.city"]');
    eq(cityInput.value, 'Los Angeles', '界面上的城市输入框也应同步');
  });

  await okAsync('失焦时把新填的公司名写入历史', async () => {
    const doc = await store.createDoc('quotation');
    window.__TD__.mountDoc(doc);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 200));
    const input = document.querySelector('#formHost input[data-bind="seller.companyName"]');
    input.value = 'NINGBO NEW HORIZON INDUSTRIAL CO., LTD.';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    const list = store.historyValues('seller.companyName');
    assert(list.includes('NINGBO NEW HORIZON INDUSTRIAL CO., LTD.'), `失焦后应写入历史，实际 ${JSON.stringify(list)}`);
    eq(list[0], 'NINGBO NEW HORIZON INDUSTRIAL CO., LTD.', '刚填的应排在最前，方便下次直接选');
  });

  await okAsync('常用公司：可新增、可删除（模板库历史公司）', async () => {
    const formMod = await import('./ui/form.js');
    // 新增第一份
    formMod.openProfileEditor(null, { companyName: 'SHENZHEN SUNVL TECHNOLOGY CO., LTD.', city: 'Shenzhen', country: 'China' });
    await waitFor(() => document.querySelector('#modalHost [data-f="companyName"]'), 3000);
    document.querySelector('#modalHost [data-f="companyName"]').value = 'SHENZHEN SUNVL TECHNOLOGY CO., LTD.';
    document.querySelector('#modalHost .modal-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 400));

    // 新增第二份
    formMod.openProfileEditor(null, { companyName: 'NINGBO NEW HORIZON INDUSTRIAL CO., LTD.' });
    await waitFor(() => document.querySelector('#modalHost [data-f="companyName"]'), 3000);
    document.querySelector('#modalHost [data-f="companyName"]').value = 'NINGBO NEW HORIZON INDUSTRIAL CO., LTD.';
    document.querySelector('#modalHost .modal-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 400));

    const list = store.state.profiles.map((p) => p.companyName);
    eq(list.length, 2, `应有 2 份常用公司，实际 ${list.length}: ${JSON.stringify(list)}`);

    // 删除第一份
    const target = store.state.profiles[0];
    await store.removeProfile(target.id);
    eq(store.state.profiles.length, 1, '删除后应剩 1 份');
    assert(!store.state.profiles.some((p) => p.id === target.id), '被删除的公司不应还在列表里');
    const reread = await db.getAll('profiles');
    eq(reread.length, 1, '删除应落库');
  });

  await okAsync('常用公司：卖方区一键带出整栏', async () => {
    const doc = await store.createDoc('quotation');
    window.__TD__.mountDoc(doc);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 250));
    const btn = document.querySelector('#formHost [data-act="pick-company"]');
    assert(btn, '卖方区应有「从常用公司选择」按钮');
    btn.click();
    await waitFor(() => document.querySelector('#modalHost [data-use]'), 3000);
    assert(document.querySelectorAll('#modalHost [data-use]').length >= 1, '弹层应列出常用公司');
    document.querySelector('#modalHost [data-use]').click();
    await new Promise((r) => setTimeout(r, 350));
    assert(state.doc.seller.companyName.length > 0, '点选后应填入公司名');
    const input = document.querySelector('#formHost input[data-bind="seller.companyName"]');
    eq(input.value, state.doc.seller.companyName, '界面输入框应同步填好');
  });

  await okAsync('模板库三个「添加」都能真正写入（历史 Bug 回归）', async () => {
    const formMod = await import('./ui/form.js');
    // 客户：走完整弹层保存流程
    formMod.openCustomerEditor(null, null);
    await waitFor(() => document.querySelector('#modalHost [data-f="name"]'), 3000);
    document.querySelector('#modalHost [data-f="name"]').value = 'REGRESSION CUSTOMER';
    document.querySelector('#modalHost [data-f="city"]').value = 'Bangkok';
    document.querySelector('#modalHost .modal-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 450));
    assert(store.state.customers.some((c) => c.name === 'REGRESSION CUSTOMER'),
      `客户未写入：${JSON.stringify(store.state.customers.map((c) => c.name))}`);

    // 产品
    formMod.openProductEditor(null, null);
    await waitFor(() => document.querySelector('#modalHost [data-f="name"]'), 3000);
    document.querySelector('#modalHost [data-f="name"]').value = 'REGRESSION PRODUCT';
    document.querySelector('#modalHost [data-f="hsCode"]').value = '8481804090';
    document.querySelector('#modalHost .modal-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 450));
    const prod = store.state.products.find((p) => p.name === 'REGRESSION PRODUCT');
    assert(prod, '产品未写入');
    eq(prod.hsCode, '8481804090', '产品 HS 编码未保存');

    // 条款
    formMod.openClauseEditor(null, null);
    await waitFor(() => document.querySelector('#modalHost [data-f="name"]'), 3000);
    document.querySelector('#modalHost [data-f="name"]').value = 'REGRESSION CLAUSE';
    document.querySelector('#modalHost [data-f="body"]').value = '30% T/T deposit, 70% before shipment.';
    document.querySelector('#modalHost .modal-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 450));
    assert(store.state.clauses.some((c) => c.name === 'REGRESSION CLAUSE'), '条款未写入');
  });

  await okAsync('添加弹层：必填校验不通过时给出明确提示且不写入', async () => {
    const formMod = await import('./ui/form.js');
    const before = store.state.customers.length;
    formMod.openCustomerEditor(null, null);
    await waitFor(() => document.querySelector('#modalHost [data-f="name"]'), 3000);
    document.querySelector('#modalHost .modal-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 300));
    const errText = document.querySelector('#modalHost .editor-error')?.textContent || '';
    assert(errText.includes('客户名称'), `应提示必填，实际：${errText}`);
    eq(store.state.customers.length, before, '校验失败不应写入');
    // 关掉弹层
    document.querySelector('#modalHost .modal-head .btn').click();
    await new Promise((r) => setTimeout(r, 200));
  });

  await okAsync('添加弹层：编辑已有条目（修改）', async () => {
    const formMod = await import('./ui/form.js');
    const target = store.state.products.find((p) => p.name === 'REGRESSION PRODUCT');
    assert(target, '缺少用于修改的产品');
    formMod.openProductEditor(target.id, null);
    await waitFor(() => document.querySelector('#modalHost [data-f="name"]'), 3000);
    const nameEl = document.querySelector('#modalHost [data-f="name"]');
    eq(nameEl.value, 'REGRESSION PRODUCT', '修改时应带出原值');
    document.querySelector('#modalHost [data-f="model"]').value = 'SV-NEW-001';
    document.querySelector('#modalHost .modal-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 450));
    const updated = store.state.products.find((p) => p.id === target.id);
    eq(updated.model, 'SV-NEW-001', '修改未生效');
    eq(store.state.products.filter((p) => p.name === 'REGRESSION PRODUCT').length, 1, '修改不应产生重复条目');
  });

  await okAsync('条款支持整组合同条款（JSON）校验', async () => {
    const formMod = await import('./ui/form.js');
    formMod.openClauseEditor(null, { name: 'X', category: 'contract', body: 'not-json' });
    await waitFor(() => document.querySelector('#modalHost [data-f="body"]'), 3000);
    document.querySelector('#modalHost [data-f="body"]').value = 'not-json';
    document.querySelector('#modalHost .modal-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 300));
    const errText = document.querySelector('#modalHost .editor-error')?.textContent || '';
    assert(errText.includes('JSON'), `应提示 JSON 格式错误，实际：${errText}`);
    document.querySelector('#modalHost .modal-head .btn').click();
    await new Promise((r) => setTimeout(r, 200));
  });

  // ---- 16. 偏好设置 ----
  await okAsync('大字号与简化界面偏好可持久化', async () => {
    await db.setSetting('bigText', true);
    await db.setSetting('simpleMode', true);
    eq(await db.getSetting('bigText', false), true, '大字号偏好未保存');
    eq(await db.getSetting('simpleMode', false), true, '简化界面偏好未保存');
    await db.setSetting('bigText', false);
    await db.setSetting('simpleMode', false);
  });

  // ---- 17. 单位选择（重量 / 体积 / 包装）与产品图片 ----
  await okAsync('产品库可保存图片与单位', async () => {
    const formMod = await import('./ui/form.js');
    formMod.openProductEditor(null, null);
    await waitFor(() => document.querySelector('#modalHost [data-f="name"]'), 3000);
    const photoField = document.querySelector('#modalHost [data-photo-pick]');
    assert(photoField, '产品编辑器应有图片上传字段');
    assert(photoField.querySelector('input[type="file"]'), '图片字段应含文件选择框');
    photoField.querySelector('[data-f="photo"]').value = 'data:image/png;base64,iVBORw0KGgo=';
    document.querySelector('#modalHost [data-f="name"]').value = 'UNIT TEST PRODUCT';
    document.querySelector('#modalHost [data-f="weightUnit"]').value = 'lb';
    document.querySelector('#modalHost [data-f="measUnit"]').value = 'cbm';
    document.querySelector('#modalHost [data-f="packUnit"]').value = 'pallet';
    document.querySelector('#modalHost [data-f="gw"]').value = '12.5';
    document.querySelector('#modalHost .modal-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 500));
    const p = store.state.products.find((x) => x.name === 'UNIT TEST PRODUCT');
    assert(p, '产品未保存');
    eq(p.photo, 'data:image/png;base64,iVBORw0KGgo=', '产品图片未保存');
    eq(p.weightUnit, 'lb', '重量单位未保存');
    eq(p.measUnit, 'cbm', '体积单位未保存');
    eq(p.packUnit, 'pallet', '包装单位未保存');
    eq(Number(p.gw), 12.5, '毛重未保存');
  });

  await okAsync('产品编辑器单位有默认值（kg / m³ / ctn）', async () => {
    const formMod = await import('./ui/form.js');
    formMod.openProductEditor(null, null);
    await waitFor(() => document.querySelector('#modalHost [data-f="weightUnit"]'), 3000);
    eq(document.querySelector('#modalHost [data-f="weightUnit"]').value, 'kg', '重量单位默认应为 kg');
    eq(document.querySelector('#modalHost [data-f="measUnit"]').value, 'm³', '体积单位默认应为 m³');
    eq(document.querySelector('#modalHost [data-f="packUnit"]').value, 'ctn', '包装单位默认应为 ctn');
    const opt = document.querySelector('#modalHost [data-f="weightUnit"]').options[0].textContent;
    assert(opt.includes('千克'), `单位应带中文说明，实际 ${opt}`);
    document.querySelector('#modalHost .modal-head .btn').click();
    await new Promise((r) => setTimeout(r, 200));
  });

  await okAsync('装箱单产品行有单位下拉，且可改', async () => {
    const doc = await store.createDoc('pl');
    window.__TD__.mountDoc(doc);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 250));
    const wSel = document.querySelector('#itemBody select[data-bind="items.0.weightUnit"]');
    const mSel = document.querySelector('#itemBody select[data-bind="items.0.measUnit"]');
    const pSel = document.querySelector('#itemBody select[data-bind="items.0.packUnit"]');
    assert(wSel && mSel && pSel, '装箱单行应有重量/体积/包装单位下拉');
    eq(wSel.value, 'kg', '重量单位默认 kg');
    eq(mSel.value, 'm³', '体积单位默认 m³');
    eq(pSel.value, 'ctn', '包装单位默认 ctn');
    wSel.value = 'ton';
    wSel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    eq(doc.items[0].weightUnit, 'ton', '切换单位未写回单据');
  });

  await okAsync('单据预览会显示所选单位（表头下方单位行）', async () => {
    const doc = await store.createDoc('pl');
    doc.seller.companyName = 'S';
    doc.buyer.companyName = 'B';
    doc.items = [{
      ...emptyItem(0), description: 'Valve', ctns: 10, packUnit: 'pallet',
      nw: 12, gw: 13.5, meas: 0.05, weightUnit: 'lb', measUnit: 'cbm',
    }];
    recalcDoc(doc);
    const html = renderDocument(doc);
    // 装箱单把单位放在表头下方的单位行里（对照真实 PL 模板），不跟在数值后面
    assert(html.includes('unit-tr'), '应有表头单位行');
    assert(html.includes('>LB<'), '单位行应显示所选重量单位 LB');
    assert(html.includes('>CBM<'), '单位行应显示所选体积单位 CBM');
    assert(html.includes('>13.5<'), '毛重数值应渲染');
    assert(html.includes('>12<'), '净重数值应渲染');
  });

  await okAsync('老数据没有单位字段时回退 kg / m³', async () => {
    const doc = await store.createDoc('pl');
    doc.items = [{ id: 'old', order: 0, description: 'Legacy item', ctns: 2, nw: 5, gw: 6, meas: 0.01 }];
    delete doc.items[0].weightUnit;
    delete doc.items[0].measUnit;
    delete doc.items[0].packUnit;
    recalcDoc(doc);
    const html = renderDocument(doc);
    assert(html.includes('>KG<'), '旧数据重量单位应回退 KG');
    assert(html.includes('>M³<') || html.includes('>M3<'), '旧数据体积单位应回退 M³');
    assert(html.includes('>6<'), '毛重数值应渲染');
  });

  // ---- 18. 单据信息完整度（对照真实 CI 版式） ----
  await okAsync('双方信息块每行都带字段前缀（Address/Attn/Tel…）', async () => {
    const doc = await store.createDoc('quotation');
    doc.seller = {
      ...doc.seller, companyName: 'SHANGHAI TEXTILE EXPORT CO., LTD.',
      address: 'No. 168 South Zhongshan Road', city: 'Shanghai', state: 'Shanghai',
      zip: '200010', country: 'China', contact: 'John Smith',
      tel: '+86 21 6321 8888', email: 'export@shanghai-textile.com',
    };
    doc.buyer = {
      ...doc.buyer, companyName: 'Smith Trading LLC',
      address: '1234 Commerce Street, Suite 500', city: 'New York', state: 'NY',
      zip: '10001', country: 'USA', contact: 'John Smith', tel: '+1 212 555 0100',
    };
    const html = renderDocument(doc);
    // 两栏结构：标签单独一列（.k），值在 .v，不再用「标签: 值」挤成一行
    for (const label of ['Address', 'City', 'State', 'Zip Code', 'Country', 'Attn', 'Tel', 'E-mail']) {
      assert(new RegExp(`class="k">${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`).test(html),
        `双方信息块缺少标签列 ${label}`);
    }
    for (const label of ['Address', 'City', 'Zip Code', 'Country', 'Attn', 'Tel', 'E-mail']) {
      assert(html.includes(`<span class="v">`), `缺少对应的值列（${label}）`);
    }
    assert(html.includes('class="ln"'), '应有 .ln 行容器');
    assert(html.includes('SHANGHAI TEXTILE EXPORT CO., LTD.'), '卖方公司名缺失');
  });

  await okAsync('PI/CI 显示清关参考信息条（PO / L/C / AWB / 出口国 / 贸易术语）', async () => {
    const doc = await store.createDoc('ci');
    doc.seller.companyName = 'SHANGHAI TEXTILE EXPORT CO., LTD.';
    doc.seller.country = 'China';
    doc.buyer.companyName = 'Smith Trading LLC';
    doc.poNo = 'PO-SMITH-2026-003';
    doc.lcNo = 'LC-12345678';
    doc.awbNo = '7731 8821 0000';
    doc.shippingMethod = 'Sea';
    doc.reasonForExport = 'Commercial';
    doc.countryOfOrigin = 'CHINA';
    doc.countryOfExport = 'China';     // 显式填（不再靠兜底取卖方国家）
    doc.incoterms = 'EXW';
    doc.tradeTermsPlace = 'Shenzhen, China';
    doc.items = [{ ...emptyItem(0), description: 'Silk Blouse', unit: 'pcs', qty: 200, unitPrice: 25, ctns: 10, gw: 24.5, nw: 23 }];
    recalcDoc(doc);
    const html = renderDocument(doc);
    assert(html.includes('ref-table'), 'CI 应有参考号信息条');
    assert(html.includes('PO-SMITH-2026-003'), 'PO 号未显示');
    assert(html.includes('LC-12345678'), 'L/C 号未显示');
    assert(html.includes('7731 8821 0000'), '空运单号未显示');
    assert(html.includes('Country of Export'), '出口国标签未显示');
    assert(html.includes('EXW Shenzhen, China'), '贸易术语与交货地未正确拼接');
    assert(html.includes('Commercial'), '出口原因未显示');
  });

  await okAsync('CI 头部显示收款银行信息，且底部不重复', async () => {
    const doc = await store.createDoc('ci');
    doc.seller.companyName = 'S'; doc.buyer.companyName = 'B';
    doc.beneficiaryAccount = 'Shanghai Textile Export Co., Ltd.';
    doc.bank = {
      bankName: 'Bank of China, Shanghai Branch',
      bankAddress: 'No. 200 Yin Cheng Rd, Pudong',
      accountNo: '6217 0012 3456 7890',
      swift: 'BKCHCNBJ300',
      beneficiary: 'Shanghai Textile Export Co., Ltd.',
    };
    const html = renderDocument(doc);
    const count = (html.match(/BKCHCNBJ300/g) || []).length;
    eq(count, 1, `银行信息应只出现一次（头部），实际 ${count} 次`);
    assert(html.includes('6217 0012 3456 7890'), '银行账号未显示');
  });

  await okAsync('CI 合计下方显示总件数与总毛重', async () => {
    const doc = await store.createDoc('ci');
    doc.seller.companyName = 'S'; doc.buyer.companyName = 'B';
    doc.items = [{ ...emptyItem(0), description: 'A', qty: 200, unitPrice: 25, ctns: 10, gw: 24.5, weightUnit: 'kg' }];
    recalcDoc(doc);
    const html = renderDocument(doc);
    assert(html.includes('pkg-line'), '应有件数/毛重行');
    assert(html.includes('24.5 kg'), '总毛重未显示');
  });

  // 行为变更（2026-10）：不再"留空就取卖方国家" —— 新建单据是真空白，
  // 单据上也不该凭空出现"出口国 China"。留空 = 这一行不印。
  await okAsync('出口国留空时不印该行（不再自动取卖方国家）', async () => {
    const doc = await store.createDoc('ci');
    doc.seller.companyName = 'S'; doc.seller.country = 'China';
    doc.buyer.companyName = 'B';
    doc.countryOfExport = '';
    doc.items = [{ ...emptyItem(0), description: 'A' }];
    recalcDoc(doc);
    const html = renderDocument(doc);
    assert(!html.includes('Country of Export'), '出口国留空时不应印出该行');
    // 但填了就要印
    doc.countryOfExport = 'China';
    recalcDoc(doc);
    const html2 = renderDocument(doc);
    assert(html2.includes('Country of Export') && html2.includes('China'), '填了出口国就要印出来');
  });

  await okAsync('参考号条只显示填了的字段，不出现空框', async () => {
    const doc = await store.createDoc('ci');
    doc.seller.companyName = 'S'; doc.buyer.companyName = 'B';
    doc.poNo = 'PO-1';
    doc.lcNo = ''; doc.awbNo = ''; doc.shippingMethod = '';
    doc.items = [{ ...emptyItem(0), description: 'A' }];
    recalcDoc(doc);
    const html = renderDocument(doc);
    assert(html.includes('PO-1'), '已填字段应显示');
    assert(!html.includes('L/C No.'), '未填字段不应出现空框');
    assert(!html.includes('AWB / B/L No.'), '未填字段不应出现空行');
  });

  // ---- 19. 主题配色 ----
  await okAsync('主题可切换、落库，并影响单据配色', async () => {
    const styles = await import('./doc/render.js');
    // 主题清单齐全
    eq(store.THEMES.length, 7, `应有 7 套主题，实际 ${store.THEMES.length}`);
    assert(store.THEMES.every((x) => x.code && x.label && x.color), '主题项应含 code/label/color');

    // 切到中国红
    await store.setTheme('red');
    eq(state.theme, 'red', '主题未写入 state');
    eq(await db.getSetting('theme', null), 'red', '主题未落库');

    // 非法主题回退 blue
    await store.setTheme('not-a-theme');
    eq(state.theme, 'blue', '非法主题应回退 blue');

    await store.setTheme('green');

    // 独立导出的 HTML 会带上对应主题变量（打印颜色与预览一致）
    const doc = await store.createDoc('quotation');
    const red = styles.renderStandaloneHtml(doc, '', 'red');
    assert(red.includes('--doc-ink: #8c1c22'), 'red 主题未注入单据变量');
    const green = styles.renderStandaloneHtml(doc, '', 'green');
    assert(green.includes('--doc-ink: #14523f'), 'green 主题未注入单据变量');
    const blue = styles.renderStandaloneHtml(doc, '', 'blue');
    assert(blue.includes('--doc-ink: #16233a'), 'blue 主题未注入单据变量');
    // 未知主题回退蓝
    const fallback = styles.renderStandaloneHtml(doc, '', 'nope');
    assert(fallback.includes('--doc-ink: #16233a'), '未知主题应回退 blue');

    await store.setTheme('blue');
  });

  await okAsync('主题切换后界面变量随之改变', async () => {
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 120));
    const chip = document.getElementById('statusChip');
    void chip;
    // 通过 CSS 变量验证主题生效
    const before = getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim();
    document.documentElement.setAttribute('data-theme', 'red');
    const after = getComputedStyle(document.documentElement).getPropertyValue('--c-primary').trim();
    document.documentElement.removeAttribute('data-theme');
    assert(before && after && before !== after,
      `主题变量未生效：默认 ${before} / red ${after}`);
    eq(after, '#c8232c', 'red 主题主色应为 #c8232c');
  });

  // ---- 20. 每个 Tab 只管自己那一类单据 ----
  await okAsync('切到没有单据的类型时显示空态，不会跳到别的类型', async () => {
    // 先清干净，确保只有报价单
    for (const d of store.state.docs) await store.removeDoc(d.id);
    const q = await store.createDoc('quotation');
    q.seller.companyName = 'S'; q.buyer.companyName = 'B';
    await store.persistDoc(q);

    window.__TD__.mountDoc(q);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 150));

    // 点「装箱单」Tab（一张装箱单都没有）
    document.querySelector('#docTabs .doc-tab[data-type="pl"]').click();
    await new Promise((r) => setTimeout(r, 500));
    eq(state.doc, null, '没有装箱单时应进入空态，而不是打开别的类型');
    assert(document.querySelector('#formHost .empty-state'), '应显示空态提示');
    assert(document.getElementById('docTabs').querySelector('[data-type="pl"]').classList.contains('active'),
      '装箱单 Tab 应处于选中态');
    // 空态里应当能直接新建「装箱单」
    const btns = Array.from(document.querySelectorAll('#formHost [data-newtype]')).map((b) => b.getAttribute('data-newtype'));
    assert(btns.includes('pl'), `空态应提供新建入口，实际 ${JSON.stringify(btns)}`);
  });

  await okAsync('空态点新建 → 建出的正是该类型单据', async () => {
    const btn = Array.from(document.querySelectorAll('#formHost [data-newtype]')).find((b) => b.getAttribute('data-newtype') === 'pl');
    btn.click();
    await waitFor(() => state.doc && state.doc.type === 'pl', 4000);
    eq(state.doc.type, 'pl', '应新建装箱单');
    assert(String(state.doc.docNo).startsWith('PL-'), `编号应为 PL- 开头，实际 ${state.doc.docNo}`);
  });

  await okAsync('「＋ 新建」按当前所在类型新建', async () => {
    document.querySelector('#docTabs .doc-tab[data-type="ci"]').click();
    await new Promise((r) => setTimeout(r, 400));
    eq(state.doc, null, 'CI 无单据应为空态');
    document.getElementById('btnNew').click();
    await waitFor(() => state.doc && state.doc.type === 'ci', 4000);
    eq(state.doc.type, 'ci', '「新建」应产出商业发票');
  });

  // ---- 21. 返回上一条单据（只在本类型内） ----
  await okAsync('返回只在本单据类型内：CI 只回 CI', async () => {
    for (const d of store.state.docs.slice()) await store.removeDoc(d.id);
    await store.refreshDocs();

    // 建 2 张 CI + 2 张报价单，交错创建，验证返回不会串到别的类型
    const q1 = await store.createDoc('quotation');
    await new Promise((r) => setTimeout(r, 25));
    const ci1 = await store.createDoc('ci');
    await new Promise((r) => setTimeout(r, 25));
    const q2 = await store.createDoc('quotation');
    await new Promise((r) => setTimeout(r, 25));
    const ci2 = await store.createDoc('ci');
    await store.refreshDocs();

    // 打开第 2 张 CI，返回应到第 1 张 CI（而不是中间那张报价单）
    window.__TD__.mountDoc(ci2);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 250));
    const back = document.getElementById('btnBack');
    assert(back && back.hidden === false, '同类型有上一条时返回按钮应可见');
    back.click();
    await new Promise((r) => setTimeout(r, 700));
    eq(state.doc.type, 'ci', `返回后应仍是 CI，实际 ${state.doc && state.doc.type}`);
    eq(state.doc.id, ci1.id, '应回到第 1 张 CI');
    assert(state.doc.id !== q1.id && state.doc.id !== q2.id, '不应跳到报价单');

    // 已是本类型最早一条 → 置灰（不再消失：整组按钮保持位置，避免忽左忽右）
    eq(document.getElementById('btnBack').disabled, true, '本类型最早一条时上一条应置灰不可点');
    eq(document.getElementById('docNav').hidden, false, '同类型有 2 张以上时导航组应显示');

    // 「›」前进回第 2 张 CI
    const next = document.getElementById('btnNext');
    assert(next && next.hidden === false, '同类型有下一条时前进按钮应可见');
    next.click();
    await new Promise((r) => setTimeout(r, 700));
    eq(state.doc.id, ci2.id, '前进应回到第 2 张 CI');
    eq(document.getElementById('btnNext').disabled, true, '最后一条时下一条应置灰');

    // 报价单类型同样只在自己的范围内走
    window.__TD__.mountDoc(q2);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('btnBack').click();
    await new Promise((r) => setTimeout(r, 700));
    eq(state.doc.id, q1.id, '报价单应回到第 1 张报价单');
  });

  await okAsync('顺序提示按同类型计数', async () => {
    const hint = document.getElementById('orderHint');
    assert(hint, '应有顺序提示元素');
    eq(hint.hidden, false, '同类型多张时应显示顺序');
    // 此时是第 1 张报价单。位置只显示「1 / 2」，单据类型由页签表达，避免顶栏出现"第几条"这种看不懂的话
    eq(hint.textContent.trim(), '1 / 2', `提示文案应为「1 / 2」，实际：${hint.textContent}`);
    assert((hint.title || '').includes('同类单据'), '悬浮提示应说明这是同类单据之间的位置');
  });

  // ---- 23. 印章上传与保存 ----
  await okAsync('上传印章后进入单据，并渲染到单据版式上', async () => {
    const doc = await store.createDoc('contract');
    doc.seller.companyName = 'SHENZHEN SUNVL TECHNOLOGY CO., LTD.';
    doc.buyer.companyName = 'ACME TRADING CO., LTD.';
    doc.items = [{ ...emptyItem(0), description: 'A' }];
    recalcDoc(doc);
    window.__TD__.mountDoc(doc);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 250));

    assert(document.querySelector('#formHost [data-act="upload-stamp"]'), '卖方区应有上传印章按钮');
    assert(document.getElementById('fileStamp'), '应有印章文件输入框');

    const stampPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    state.doc.seller.stamp = stampPng;
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 250));

    const html = renderDocument(state.doc);
    assert(html.includes('sign-stamp'), '合同单据应渲染印章');
    assert(html.includes(stampPng), '印章图片未进入单据 HTML');
  });

  await okAsync('印章可存进资料库，之后新建单据自动带上', async () => {
    const stampPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    const formMod = await import('./ui/form.js');

    state.doc.seller.stamp = stampPng;
    formMod.refreshFormView();
    await new Promise((r) => setTimeout(r, 250));
    const btn = document.querySelector('#formHost [data-act="save-stamp"]');
    assert(btn, '应有保存印章按钮');
    btn.click();
    await new Promise((r) => setTimeout(r, 700));

    const saved = await db.getSetting('company', null);
    assert(saved && saved.stamp === stampPng, '印章未存入默认公司');

    const fresh = await store.createDoc('pi');
    eq(fresh.seller.stamp, stampPng, '新建单据未自动带上印章');
  });

  await okAsync('印章会同步到同名的常用公司档案', async () => {
    const stampPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    const name = 'STAMP SYNC CO., LTD.';
    await store.saveProfile({ companyName: name });
    const doc = await store.createDoc('quotation');
    doc.seller.companyName = name;
    doc.seller.stamp = stampPng;
    store.state.doc = doc;
    const r = await store.saveStampToLibrary(stampPng);
    eq(r.updatedProfiles, 1, '应同步 1 份同名常用公司');
    const hit = store.state.profiles.find((p) => p.companyName === name);
    assert(hit && hit.stamp === stampPng, '常用公司档案未带上印章');
  });

  await okAsync('从常用公司选择时印章一起带过来', async () => {
    const stampPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    const prof = store.state.profiles.find((p) => p.stamp === stampPng);
    assert(prof, '缺少带印章的常用公司档案');
    const doc = await store.createDoc('quotation');
    doc.seller = { ...emptyParty(), ...prof };
    recalcDoc(doc);
    eq(doc.seller.stamp, stampPng, '从常用公司带入时印章应一起过来');
  });

  await okAsync('印章压缩保留透明通道（PNG 输出）', async () => {
    const util = await import('./core/util.js');
    assert(util.isPngLike('data:image/png;base64,xxx'), 'PNG 应识别为透明图');
    assert(!util.isPngLike('data:image/jpeg;base64,xxx'), 'JPEG 不应识别为透明图');
    assert(typeof util.compressStamp === 'function', '应导出 compressStamp');
  });

  // ---- 22. 专业字段（对照真实报价单模板） ----
  await okAsync('费用与总计：小计 → 折扣 → 增值税 → 运费 → 总计', async () => {
    const doc = await store.createDoc('quotation');
    doc.currency = 'USD';
    doc.items = [{ ...emptyItem(0), description: 'Widget', qty: 100, unitPrice: 10 }];
    doc.discount = 50;
    doc.taxRate = 13;
    doc.shippingFee = 20;
    doc.insuranceFee = 5;
    doc.otherFee = 0;
    recalcDoc(doc);
    const t = doc.totals;
    eq(t.subtotal, 1000, '小计应为 1000');
    eq(t.taxable, 950, '计税金额应为 1000-50=950');
    eq(t.taxAmount, 123.5, '增值税 13% 应为 123.5');
    eq(t.grandTotal, 1000 - 50 + 123.5 + 5 + 20, '总计算错');
    eq(doc.grandTotal, t.grandTotal, 'grandTotal 应同步');
  });

  await okAsync('未填任何费用时总计等于总金额', async () => {
    const doc = await store.createDoc('quotation');
    doc.items = [{ ...emptyItem(0), description: 'A', qty: 2, unitPrice: 5 }];
    doc.discount = 0; doc.taxRate = 0; doc.shippingFee = 0; doc.insuranceFee = 0; doc.otherFee = 0; doc.toolingFee = 0;
    recalcDoc(doc);
    eq(doc.totals.grandTotal, 10, '无费用时总计应等于总金额');
    const html = renderDocument(doc);
    assert(!html.includes('Subtotal'), '无费用时不应出现小计行');
    assert(!html.includes('VAT'), '无费用时不应出现增值税行');
  });

  await okAsync('产品规格会印在单据描述栏里', async () => {
    const doc = await store.createDoc('quotation');
    doc.docLang = 'en';
    doc.seller.companyName = 'S'; doc.buyer.companyName = 'B';
    doc.items = [{
      ...emptyItem(0), description: 'Ceramic Mug', qty: 1500, unitPrice: 1,
      styleName: 'KH001', size: 'standard', color: 'yellow', material: 'ceramic',
      moq: 500, leadTime: '45 days', unitsPerCtn: 24, ctnL: 60, ctnW: 60, ctnH: 80,
      netWeight: 200, toolingCost: 2500, sampleFee: 100, sampleQty: 2, bulkPrice: 0.85,
      specNote: '颜色可按 Pantone 定制',
    }];
    recalcDoc(doc);
    const html = renderDocument(doc);
    for (const frag of ['KH001', 'standard', 'yellow', 'ceramic', 'MOQ', '45 days',
      '60×60×80 cm', '2,500.00', '0.85', '颜色可按 Pantone 定制']) {
      assert(html.includes(frag), `描述栏缺少规格内容：${frag}`);
    }
    assert(html.includes('spec-lines'), '应有规格样式块');
    assert(html.includes('Units/ctn'), '应有每箱数量');
    assert(html.includes('Sample price'), '应有样品价');
    assert(html.includes('Bulk price'), '应有大货价');
  });

  await okAsync('产品规格弹层可保存到当前行', async () => {
    const formMod = await import('./ui/form.js');
    const doc = await store.createDoc('quotation');
    doc.items[0].description = 'Spec test';
    store.state.doc = doc;
    formMod.refreshFormView();
    await new Promise((r) => setTimeout(r, 200));

    formMod.openItemSpecEditor(0);
    await waitFor(() => document.querySelector('#modalHost [data-f="size"]'), 3000);
    document.querySelector('#modalHost [data-f="size"]').value = 'L 2000mm';
    document.querySelector('#modalHost [data-f="color"]').value = 'blue';
    document.querySelector('#modalHost [data-f="material"]').value = 'SPCC T=1.0';
    document.querySelector('#modalHost [data-f="moq"]').value = '1000';
    document.querySelector('#modalHost [data-f="toolingCost"]').value = '3000';
    document.querySelector('#modalHost .modal-foot .btn-primary').click();
    await new Promise((r) => setTimeout(r, 500));
    const it = doc.items[0];
    eq(it.size, 'L 2000mm', '规格未保存');
    eq(it.color, 'blue', '颜色未保存');
    eq(it.material, 'SPCC T=1.0', '材质未保存');
    eq(Number(it.moq), 1000, 'MOQ 未保存');
    eq(Number(it.toolingCost), 3000, '模具费未保存');
  });

  await okAsync('报价单表单含价格与交货售后区块', async () => {
    const formMod = await import('./ui/form.js');
    const doc = await store.createDoc('quotation');
    store.state.doc = doc;
    formMod.refreshFormView();
    await new Promise((r) => setTimeout(r, 200));
    const sections = Array.from(document.querySelectorAll('#formHost [data-section]')).map((s) => s.getAttribute('data-section'));
    assert(sections.includes('pricing'), `应有价格与费用区块，实际 ${JSON.stringify(sections)}`);
    assert(sections.includes('logistics'), '应有交货与售后区块');
    assert(document.querySelector('#formHost [data-bind="discount"]'), '缺少折扣输入');
    assert(document.querySelector('#formHost [data-bind="taxRate"]'), '缺少增值税率输入');
    assert(document.querySelector('#formHost [data-bind="productionTime"]'), '缺少生产周期输入');
    assert(document.querySelector('#formHost [data-bind="warranty"]'), '缺少保修输入');
  });

  await okAsync('交货售后信息会出现在单据上', async () => {
    const doc = await store.createDoc('quotation');
    doc.seller.companyName = 'S'; doc.buyer.companyName = 'B';
    doc.deliveryPlace = '客户指定处';
    doc.productionTime = '30 working days';
    doc.warranty = '保修期 12 个月';
    doc.invoiceType = '增值税专用发票';
    doc.sampleNote = '样品费可在正式下单后全额退还';
    doc.items = [{ ...emptyItem(0), description: 'A' }];
    recalcDoc(doc);
    const html = renderDocument(doc);
    for (const frag of ['客户指定处', '30 working days', '保修期 12 个月', '增值税专用发票', '样品费可在正式下单后全额退还']) {
      assert(html.includes(frag), `单据缺少交货售后信息：${frag}`);
    }
  });

  await okAsync('装箱单不显示价格与费用区块', async () => {
    const formMod = await import('./ui/form.js');
    const doc = await store.createDoc('pl');
    store.state.doc = doc;
    formMod.refreshFormView();
    await new Promise((r) => setTimeout(r, 200));
    const sections = Array.from(document.querySelectorAll('#formHost [data-section]')).map((s) => s.getAttribute('data-section'));
    assert(!sections.includes('pricing'), '装箱单不应有价格与费用区块');
    assert(!document.querySelector('#formHost [data-bind="discount"]'), '装箱单不应有折扣输入');
  });

  // ---- 24. 文案卫生：不允许界面上出现 i18n key ----
  await okAsync('界面上不出现未翻译的 i18n key', async () => {
    const doc = await store.createDoc('quotation');
    doc.seller.companyName = 'S';
    doc.buyer.companyName = 'B';
    doc.items[0].description = 'A';
    recalcDoc(doc);
    window.__TD__.mountDoc(doc);
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 300));

    const suspects = [];
    document.querySelectorAll('button, label, .hint, .msg, .ttl, .st, .k').forEach((el) => {
      // 只看元素自身直接文本，避免子元素干扰
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(' ')
        .trim();
      if (!own) return;
      // 形如 lib.xxx / btn.xxx / f.xxx / stamp.xxx 的都算漏翻译
      if (/^(lib|btn|f|sum|stamp|set|tab|msg|drafts|status|help|lang|tip)\.[A-Za-z][\w.]*$/.test(own)) {
        suspects.push(own);
      }
    });
    // 也扫一遍 HTML 里没被替换掉的 data-i18n（applyI18n 后应已变成文案）
    const unapplied = Array.from(document.querySelectorAll('[data-i18n]'))
      .map((el) => el.textContent.trim())
      .filter((txt) => /^(lib|btn|f|sum|stamp|set|tab|msg|drafts|status|help|lang|tip)\.[A-Za-z][\w.]*$/.test(txt));

    assert(suspects.length === 0, `界面上出现未翻译的 key：${JSON.stringify([...new Set(suspects)])}`);
    assert(unapplied.length === 0, `data-i18n 未被替换：${JSON.stringify([...new Set(unapplied)])}`);
  });

  await okAsync('关键按钮文案不是 i18n key（卖方区）', async () => {
    const texts = Array.from(document.querySelectorAll('#formHost [data-section="seller"] button'))
      .map((b) => b.textContent.trim());
    assert(texts.length > 0, '卖方区应有按钮');
    const bad = texts.filter((x) => /^[a-z]+\.[A-Za-z]/.test(x));
    assert(bad.length === 0, `卖方区按钮文案异常：${JSON.stringify(bad)}`);
    assert(texts.some((x) => x.includes('常用公司')), `应有「常用公司」按钮，实际 ${JSON.stringify(texts)}`);
    assert(texts.some((x) => x.includes('印章')), `应有印章按钮，实际 ${JSON.stringify(texts)}`);
  });

  // ---- 25. 两套 UI 布局 ----
  await okAsync('默认顶栏式：竖向菜单隐藏，顶部工具栏显示', async () => {
    const app = await import('./app.js');
    eq(app.LAYOUTS.length, 2, '应有 2 种布局');
    eq(state.layout, 'top', `默认应为顶栏式，实际 ${state.layout}`);
    eq(document.documentElement.getAttribute('data-layout'), 'top', 'html 上应标记 data-layout=top');
    eq(getComputedStyle(document.getElementById('appRail')).display, 'none', '顶栏式下侧栏应隐藏');
    eq(getComputedStyle(document.querySelector('.left-toolbar')).display, 'flex', '顶栏式下工具栏应显示');
  });

  await okAsync('侧栏菜单项齐全（新建/生成/复制/返回/状态/帮助/单据/模板库/设置）', async () => {
    const need = ['railNew', 'railGenerate', 'railDuplicate', 'railBack', 'railNext',
      'railMarkSaved', 'railBackDraft', 'railHelp', 'railDrafts', 'railLibrary', 'railSettings', 'railToggle'];
    for (const id of need) assert(document.getElementById(id), `侧栏缺少 #${id}`);
    // 图标 + 文字结构
    const item = document.getElementById('railNew');
    assert(item.querySelector('.ico'), '菜单项应有图标');
    assert(item.querySelector('.txt'), '菜单项应有文字');
    // 分组标题
    assert(document.querySelectorAll('#appRail .rail-label').length >= 3, '应有分组标题');
  });

  await okAsync('收起 / 展开切换 + Ctrl+B 快捷键', async () => {
    const rail = document.getElementById('appRail');
    const toggle = document.getElementById('railToggle');
    rail.classList.remove('open');
    toggle.click();
    assert(rail.classList.contains('open'), '点展开按钮后应加上 open');
    toggle.click();
    assert(!rail.classList.contains('open'), '再点应收起');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    assert(rail.classList.contains('open'), 'Ctrl+B 应能展开');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    assert(!rail.classList.contains('open'), 'Ctrl+B 应能收起');
  });

  await okAsync('侧栏菜单点「新建」按当前类型建单', async () => {
    document.querySelector('#docTabs .doc-tab[data-type="pi"]').click();
    await new Promise((r) => setTimeout(r, 400));
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 150));
    const before = state.docs.filter((d) => d.type === 'pi').length;
    document.getElementById('railNew').click();
    await waitFor(() => state.doc && state.doc.type === 'pi'
      && state.docs.filter((d) => d.type === 'pi').length > before, 5000);
    eq(state.doc.type, 'pi', '侧栏「新建」应建 PI');
  });

  await okAsync('侧栏下单号状态同步显示', async () => {
    window.__TD__.renderAll();
    await new Promise((r) => setTimeout(r, 250));
    const chip = document.getElementById('railStatusChip');
    const src = document.getElementById('statusChip');
    assert(chip && src, '应有侧栏状态标识');
    eq(chip.dataset.status, src.dataset.status, '侧栏状态标识应与主状态一致');
    assert(chip.textContent.trim().length > 0, '侧栏状态标识应有文字');
  });

  await okAsync('切到顶栏式：工具栏显示、侧栏隐藏，且落库', async () => {
    document.getElementById('btnSettings').click();
    await waitFor(() => document.querySelector('#setLayout [data-layout="top"]'), 3000);
    document.querySelector('#setLayout [data-layout="top"]').click();
    await new Promise((r) => setTimeout(r, 400));

    eq(state.layout, 'top', 'state.layout 应为 top');
    eq(document.documentElement.getAttribute('data-layout'), 'top', 'html 属性未切换');
    eq(getComputedStyle(document.getElementById('appRail')).display, 'none', '顶栏式下侧栏应隐藏');
    eq(getComputedStyle(document.querySelector('.left-toolbar')).display, 'flex', '顶栏式下工具栏应显示');
    eq(await db.getSetting('layout', null), 'top', '布局未落库');

    // 切回侧栏式，后续用例保持一致
    document.querySelector('#setLayout [data-layout="side"]').click();
    await new Promise((r) => setTimeout(r, 350));
    eq(state.layout, 'side', '应能切回侧栏式');
    // 关掉设置弹层
    const closeBtn = document.querySelector('#modalHost .modal-foot .btn');
    if (closeBtn) closeBtn.click();
    await new Promise((r) => setTimeout(r, 300));
  });

  // ---- 26. 示例数据 ----
  await okAsync('载入示例数据：每种单据各一张 + 客户 / 产品 / 条款 / 常用公司', async () => {
    for (const d of store.state.docs.slice()) await store.removeDoc(d.id);
    await store.refreshDocs();
    await db.clear(STORES.customers);
    await db.clear(STORES.products);
    await db.clear(STORES.clauses);
    await db.clear(STORES.profiles);
    await store.refreshLibraries();
    await store.refreshProfiles();

    const r = await store.loadSampleData(true);
    assert(r.ok, '示例数据应载入成功');
    eq(r.docs, DOC_TYPES.length, `应为每种单据各一张，实际 ${r.docs}`);
    assert(r.customers >= 5, `应有至少 5 个客户，实际 ${r.customers}`);
    assert(r.products >= 5, `应有至少 5 个产品，实际 ${r.products}`);

    const types = new Set(store.state.docs.map((d) => d.type));
    for (const t of DOC_TYPES) assert(types.has(t.type), `示例数据缺少 ${t.type} 单据`);
    assert(store.state.customers.length >= 5, '客户库未刷新');
    assert(store.state.products.length >= 5, '产品库未刷新');
    assert(store.state.clauses.length >= 5, '条款库未刷新');
    assert(store.state.profiles.length >= 3, '常用公司未刷新');
  });

  await okAsync('示例数据单据信息完整（卖方 / 买方 / 印章 / 基本信息 / 各单据特有字段）', async () => {
    // 15 种单据都预填：卖方（含印章）、买方、基本信息
    for (const d of store.state.docs) {
      assert(d.seller.companyName, `${d.type} 缺卖方名称`);
      assert(d.seller.stamp, `${d.type} 缺卖方印章`);
      // 申报要素表是报关资料，表上不印买卖双方（只列产品要素），不要求买方
      if (d.type !== 'declaration_elements') assert(d.buyer.companyName, `${d.type} 缺买方名称`);
      assert(d.incoterms && d.currency && d.paymentTerms, `${d.type} 缺基本信息`);
    }

    // 有产品明细的单据：明细行与关键列
    const ci = store.state.docs.find((d) => d.type === 'ci');
    assert(ci.items.length >= 2, 'CI 应有明细');
    assert(ci.items[0].hsCode, 'CI 明细应有 HS 编码');
    const pl = store.state.docs.find((d) => d.type === 'pl');
    assert(pl.items[0].gw && pl.items[0].nw && pl.items[0].meas, '装箱单明细应有毛重 / 净重 / 体积');
    const money = ci.totals && ci.totals.totalAmount;
    assert(money > 0, 'CI 应算出合计金额');

    // 各单据特有字段（融合新增的类型）
    const bl = store.state.docs.find((d) => d.type === 'bill_of_lading');
    assert(bl.vessel && bl.portOfLoading && bl.portOfDischarge, '提单应有船名与装卸港');
    const co = store.state.docs.find((d) => d.type === 'certificate_of_origin');
    assert(co.issuingAuthority && co.originCountry, '原产地证明应有签发机构与原产国');
    const ip = store.state.docs.find((d) => d.type === 'insurance_policy');
    assert(ip.policyNo && ip.insurer && ip.insuredAmount > 0, '保险单应有保单号 / 保险人 / 保额');
    const fc = store.state.docs.find((d) => d.type === 'fumigation_certificate');
    assert(fc.treatmentType && fc.fumigationMethod, '熏蒸证书应有处理方式与药剂');

    const sc = store.state.docs.find((d) => d.type === 'contract');
    assert(sc.contractClauses && sc.contractClauses.length >= 7, '合同应有 7 条以上条款');
  });

  await okAsync('示例数据能正常渲染成单据', async () => {
    for (const d of store.state.docs) {
      const html = renderDocument(d);
      assert(html.length > 800, `${d.type} 渲染结果过短`);
      assert(!html.includes('undefined'), `${d.type} 渲染出现 undefined`);
      if (d.type !== 'declaration_elements') assert(html.includes(d.seller.companyName.slice(0, 10)), `${d.type} 缺少卖方名称`);
    }
  });

  await okAsync('本机已有数据时拒绝覆盖式载入示例', async () => {
    const r = await store.loadSampleData(false);
    eq(r.ok, false, '已有单据时应拒绝载入');
    eq(r.reason, 'exists', '拒绝原因应为 exists');
  });

  // ---- 清理测试数据 ----
  await db.clear(STORES.docs);
  await db.clear(STORES.revisions);
  await db.clear(STORES.customers);
  await db.clear(STORES.products);
  await db.clear(STORES.clauses);

  // ---- 留一份示例单据，便于人工目视检查版式 ----
  const demo = await store.createDoc('quotation');
  demo.docLang = 'en';
  demo.incoterms = 'FOB';
  demo.destination = 'LOS ANGELES, USA';
  demo.loadingPort = 'SHENZHEN, CHINA';
  demo.leadTime = '25-30 days after receipt of deposit';
  demo.paymentTerms = 'T/T 30% deposit, 70% before shipment';
  demo.terms = TEMPLATES.en.defaults.quotationTerms;
  demo.remarks = 'Lead time starts from receipt of deposit. Packing: standard export carton.';
  demo.seller = {
    companyName: 'SHENZHEN SUNVL TECHNOLOGY CO., LTD.',
    address: 'Room 1203, Building A, Hi-Tech Industrial Park, Nanshan District',
    city: 'Shenzhen', state: 'Guangdong', zip: '518057', country: 'China',
    contact: 'Mr. Chen Wei', tel: '+86 755 8888 6666', email: 'sales@sunvl-demo.com',
  };
  demo.buyer = {
    companyName: 'ACME TRADING CO., LTD.',
    address: '2450 Westwood Blvd, Suite 300',
    city: 'Los Angeles', state: 'CA', zip: '90064', country: 'USA',
    contact: 'Ms. Emily Carter', tel: '+1 310 555 0182', email: 'purchase@acme-demo.com',
  };
  demo.items = [
    { ...emptyItem(0), description: 'Stainless Steel Ball Valve, 1/2 inch, PN16, Full Port', model: 'SV-BV050', hsCode: '8481804090', unit: 'pc', qty: 500, unitPrice: 8.5 },
    { ...emptyItem(1), description: 'Brass Gate Valve, 3/4 inch, with Cast Iron Handle', model: 'SV-GV075', hsCode: '8481809000', unit: 'pc', qty: 300, unitPrice: 12.4 },
    { ...emptyItem(2), description: 'Flexible Hose, 1/2 inch × 60 cm, Braided Stainless Steel', model: 'SV-FH060', hsCode: '8307100000', unit: 'pair', qty: 200, unitPrice: 4.75 },
  ];
  recalcDoc(demo);
  await store.persistDoc(demo);
  state.doc = demo;
  document.getElementById('previewLang').value = demo.docLang;
  const formMod = await import('./ui/form.js');
  formMod.renderForm(document.getElementById('formHost'), () => {});
  const renderMod = await import('./doc/render.js');
  document.getElementById('paper').innerHTML = renderMod.renderDocument(demo);
  document.getElementById('zoomFit').click();

  console.error = origError;

  // ---- 输出 ----
  const failed = results.filter((r) => !r.pass);
  const payload = {
    total: results.length,
    failed: failed.length,
    results,
    consoleErrors,
  };
  const host = document.createElement('pre');
  host.id = 'smokeResult';
  host.textContent = JSON.stringify(payload, null, 2);
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#fff;color:#111;font-size:11px;max-height:100vh;overflow:auto';
  document.body.appendChild(host);
  document.title = failed.length === 0 ? `SMOKE-OK ${results.length}` : `SMOKE-FAIL ${failed.length}/${results.length}`;
  return payload;
}

export function isTestMode() {
  return /(^|[?&])test=1(&|$)/.test(location.search);
}

export { waitFor };
