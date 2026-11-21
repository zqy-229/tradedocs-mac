/* =============================================================
 * 导出 PDF 文件（主进程侧）
 *
 * 「导出 PDF」= 弹「另存为」→ printToPDF 生成矢量 PDF → 写盘。
 * （以前是走 window.print()，弹的是系统打印对话框，用户还得自己另存为 —— 已修）
 *
 * 抽成独立模块的原因：主进程 main.cjs 与自动化测试都能直接调用同一份实现，
 * 不用测试去 require 整个 main（那会把应用真的跑起来）。
 * ============================================================= */

const path = require('node:path');
const fs = require('node:fs');

/**
 * @param {object} deps { ipcMain, dialog, BrowserWindow, app, getWindow }
 */
function registerExportPdf(deps) {
  const { ipcMain, dialog, BrowserWindow, app, getWindow } = deps;

  ipcMain.handle('td:export-pdf', async (event, opts = {}) => {
    const owner = (BrowserWindow && BrowserWindow.fromWebContents(event.sender))
      || (typeof getWindow === 'function' ? getWindow() : null);
    try {
      // 1) 选保存位置（测试可直接传 savePath 跳过对话框）
      let target = opts.savePath || '';
      if (!target) {
        const { canceled, filePath } = await dialog.showSaveDialog(owner, {
          title: '导出 PDF',
          defaultPath: path.join(app.getPath('documents'), opts.fileName || 'document.pdf'),
          filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
        });
        if (canceled || !filePath) return { ok: false, reason: 'canceled' };
        target = /\.pdf$/i.test(filePath) ? filePath : `${filePath}.pdf`;
      }

      // 2) 生成 PDF（打印样式：只留单据，纸张 A4 / 横版按单据类型）
      if (!owner || owner.isDestroyed()) return { ok: false, error: '窗口已关闭' };
      const pdf = await owner.webContents.printToPDF({
        landscape: !!opts.landscape,
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'none' },
        preferCSSPageSize: true,
      });

      // 3) 写盘（先确保目录存在，用户可能手输了一个不存在的文件夹）
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, pdf);
      return { ok: true, path: target, bytes: pdf.length };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
}

module.exports = { registerExportPdf };
