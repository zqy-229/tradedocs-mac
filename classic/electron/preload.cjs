/* =============================================================
 * preload —— 桌面端标记 + 机器码
 *
 * 渲染进程开了 contextIsolation 且没有 Node 能力；这里只暴露最小的只读信息。
 * 机器码 = 主机名 + CPU 型号 + 平台 + 用户名的哈希，用于激活窗口里「我的机器码」那一栏
 * （看着正规，客户报问题时报这一串也方便定位是同一台机器）。
 * 安全面依然最小：不暴露文件、进程、网络能力。
 * ============================================================= */

const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

/** 简易哈希 → 3 组 4 位（形如 A1B2-C3D4-E5F6） */
function machineCode() {
  let src = '';
  try {
    const u = (() => { try { return os.userInfo().username; } catch { return ''; } })();
    src = [os.hostname(), (os.cpus()[0] || {}).model || '', os.platform(), os.arch(), u].join('|');
  } catch {
    src = 'unknown';
  }
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = ((h2 << 5) + h2 + c * 31) >>> 0;
  }
  const part = (n) => n.toString(36).toUpperCase().padStart(4, '0').slice(-4);
  return [part(h1), part(h2), part((h1 ^ h2) >>> 0)].join('-');
}

contextBridge.exposeInMainWorld('tdDesktop', {
  isDesktop: true,
  machineCode: machineCode(),
  /** 导出 PDF 文件：弹「另存为」→ 主进程 printToPDF 写盘（不弹打印对话框） */
  exportPdf: (opts) => ipcRenderer.invoke('td:export-pdf', opts || {}),
  dataDir: () => ipcRenderer.invoke('td:data-dir'),
  dataDirInfo: () => ipcRenderer.invoke('td:data-dir-info'),
  dataDirMove: () => ipcRenderer.invoke('td:data-dir-move'),
  dataDirReset: () => ipcRenderer.invoke('td:data-dir-reset'),
  dataDirFallback: () => ipcRenderer.invoke('td:data-dir-fallback'),
  /** 备份：写文件 / 列表 / 读取 / 打开目录 */
  backupSave: (payload) => ipcRenderer.invoke('td:backup-save', payload),
  backupList: () => ipcRenderer.invoke('td:backup-list'),
  backupRead: (name) => ipcRenderer.invoke('td:backup-read', name),
  backupOpenDir: () => ipcRenderer.invoke('td:backup-open-dir'),
  openDataDir: () => ipcRenderer.invoke('td:open-data-dir'),
});
