/* =============================================================
 * 导出 PDF / 打印
 * 方案说明（重点解决「泰文、中文导出 PDF 乱码」问题）：
 *   1) 首选浏览器原生打印通道（window.print → 另存为 PDF）
 *      - 输出为矢量 PDF，字体由系统排版引擎处理
 *      - 泰文 / 中文 / 英文 100% 不乱码，无需嵌入字体
 *      - 离线可用、零依赖
 *   2) 若项目内放置了 vendor/html2pdf.bundle.min.js（可选，见 README），
 *      则额外提供「图片式 PDF 导出」（含自动分页），兼容不支持打印的环境
 * ============================================================= */

import { renderStandaloneHtml, renderDocument, PAPER_CSS } from './render.js';
import { docMeta } from '../core/schema.js';
import { esc } from '../core/util.js';
import { t } from '../core/i18n.js';
import * as toast from '../ui/toast.js';

/** 生成安全文件名：QT-001_客户名.pdf */
export function pdfFileName(doc) {
  const who = (doc.buyer && doc.buyer.companyName) || 'customer';
  const base = [doc.docNo || doc.type, who]
    .join('_')
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'document'}.pdf`;
}

/** 载入可选的 html2pdf 库（本地 vendor 目录，不存在则返回 null） */
async function loadHtml2Pdf() {
  if (window.html2pdf) return window.html2pdf;
  const candidates = ['./vendor/html2pdf.bundle.min.js', '../vendor/html2pdf.bundle.min.js'];
  for (const url of candidates) {
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = resolve;
        s.onerror = () => reject(new Error('not found'));
        document.head.appendChild(s);
      });
      if (window.html2pdf) return window.html2pdf;
    } catch { /* 继续尝试 */ }
  }
  return null;
}

/**
 * 把「当前单据」摆成一份可打印/可导出的独立页面（只留单据，其余界面不出现）
 * 返回 { land, cleanup }，用完必须调 cleanup 还原界面。
 */
function preparePrintDom(doc) {
  const land = !!docMeta(doc.type).landscape;
  const root = document.getElementById('printRoot');
  // 单据字号（doc.fontScale）：打印时单独套一层 zoom，和屏幕预览保持一致
  const fs = Number(doc.fontScale) > 0 ? Number(doc.fontScale) : 1;
  const zoomStyle = fs !== 1 ? ` style="zoom:${fs}"` : '';
  root.innerHTML = `<style>${PAPER_CSS}</style><div class="paper${land ? ' is-landscape' : ''}"><div class="print-fs"${zoomStyle}>${renderDocument(doc)}</div></div>`;

  // 隐藏打印容器之外的兄弟节点由 @media print 处理；这里补一份内联样式
  const style = document.createElement('style');
  style.id = 'printInlineStyle';
  style.textContent = `
    @media print {
      @page { size: ${land ? 'A4 landscape' : 'A4'}; margin: 0; }
      body > *:not(#printRoot) { display: none !important; }
      #printRoot { display: block !important; }
      #printRoot .paper { width: ${land ? '297mm' : '210mm'}; padding: 0; margin: 0 auto; box-shadow: none; }
    }`;
  document.head.appendChild(style);

  const cleanup = () => {
    root.innerHTML = '';
    const s = document.getElementById('printInlineStyle');
    if (s) s.remove();
  };
  return { land, cleanup };
}

/**
 * 方式一：直接打印（弹系统打印对话框）
 */
export function printDocument(doc) {
  if (!doc) { toast.warn(t('msg.needDoc')); return; }
  const { cleanup } = preparePrintDom(doc);
  const onAfter = () => { cleanup(); window.removeEventListener('afterprint', onAfter); };
  window.addEventListener('afterprint', onAfter);

  setTimeout(() => {
    try {
      window.print();
    } catch (err) {
      console.error(err);
      toast.err('调用打印失败，请使用浏览器菜单「打印」');
    }
    setTimeout(() => { cleanup(); window.removeEventListener('afterprint', onAfter); }, 1200);
  }, 60);
}

/**
 * 方式二：html2pdf（图片式 PDF，兼容性更好；需要 vendor 文件）
 * @returns {Promise<boolean>} 是否成功使用该方式
 */
export async function exportByHtml2Pdf(doc) {
  if (!doc) { toast.warn(t('msg.needDoc')); return false; }
  const lib = await loadHtml2Pdf();
  if (!lib) return false;

  const holder = document.createElement('div');
  const land2 = !!docMeta(doc.type).landscape;
  holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${land2 ? '297mm' : '210mm'};background:#fff;`;
  holder.innerHTML = `<style>${PAPER_CSS}</style><div class="paper" style="box-shadow:none;padding:12mm;width:${land2 ? '297mm' : '210mm'};min-height:0">${renderDocument(doc)}</div>`;
  document.body.appendChild(holder);

  try {
    await lib()
      .set({
        margin: 0,
        filename: pdfFileName(doc),
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: holder.scrollWidth },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(holder.firstElementChild)
      .save();
    return true;
  } catch (err) {
    console.error('html2pdf 导出失败', err);
    return false;
  } finally {
    holder.remove();
  }
}

/**
 * 统一导出入口：优先矢量打印，若配置了强制图片模式则用 html2pdf
 * @param {object} doc
 * @param {object} opts { mode: 'print' | 'image' | 'auto' }
 */
/**
 * 导出 PDF 文件。
 *
 * · 桌面版（Electron）：直接生成 PDF **文件**，弹「另存为」让你选位置 —— 不弹打印对话框。
 * · 浏览器版：没有直接写文件的能力，退回打印 → 在打印里选「另存为 PDF」，并提示一句。
 *
 * @param {object} doc
 * @param {object} [opts] { savePath }  —— savePath 给自动化测试用：跳过另存为对话框
 * @returns {Promise<'file'|'print'|'canceled'|undefined>}
 */
export async function exportPdf(doc, opts = {}) {
  if (!doc) { toast.warn(t('msg.needDoc')); return; }
  const mode = opts.mode || 'auto';
  if (mode === 'image') {
    const okImg = await exportByHtml2Pdf(doc);
    if (okImg) { toast.ok('PDF 已生成'); return 'image'; }
    toast.warn('未找到图片导出组件，改用打印导出');
    printDocument(doc);
    return 'print';
  }

  const bridge = window.tdDesktop;
  // 桌面版：真正导出文件
  if (bridge && typeof bridge.exportPdf === 'function') {
    const { land, cleanup } = preparePrintDom(doc);
    try {
      const r = await bridge.exportPdf({
        fileName: pdfFileName(doc),
        landscape: land,
        savePath: opts.savePath || '',
      });
      if (r && r.ok) {
        toast.ok(`PDF 已导出：${r.path}`, 5000);
        return 'file';
      }
      if (r && r.reason === 'canceled') return 'canceled';
      toast.err(`导出失败：${(r && r.error) || '未知原因'}`, 5000);
      return undefined;
    } catch (err) {
      console.error(err);
      toast.err(`导出失败：${err.message || err}`, 5000);
      return undefined;
    } finally {
      cleanup();
    }
  }

  // 浏览器版：只能走打印通道
  toast.info('浏览器里请在打印窗口选择「另存为 PDF」；装桌面版可直接存文件', 4200);
  printDocument(doc);
  return 'print';
}

/** 导出为独立 HTML 文件（便于存档 / 邮件发送 / 二次打印） */
export function exportHtmlFile(doc) {
  if (!doc) { toast.warn(t('msg.needDoc')); return; }
  const html = renderStandaloneHtml(doc, `body { padding: 12mm; }`);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = pdfFileName(doc).replace(/\.pdf$/, '.html');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 打印提示文案 */
export function pdfTip() {
  return esc(t('msg.pdfHint'));
}
