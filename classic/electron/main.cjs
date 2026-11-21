/* =============================================================
 * Electron 主进程 —— 把工作台包成真正的桌面应用
 *
 * 为什么还要起本地服务？
 *   本应用是标准 ES Module + Service Worker 架构，file:// 下：
 *     · <script type="module"> 会被 CORS 拦掉
 *     · Service Worker 根本无法注册（离线缓存失效）
 *   所以内置一个只监听 127.0.0.1 的极简静态服务，再把窗口指向它。
 *   这也让「装成 App」的离线能力与浏览器里完全一致。
 * ============================================================= */

const { app, BrowserWindow, shell, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const { registerExportPdf } = require('./export-pdf.cjs');
const { registerBackup } = require('./backup.cjs');
const { resolveDataDir, registerDataDir } = require('./datadir.cjs');
const ROOT = path.join(__dirname, '..');
const IS_DEV = process.argv.includes('--dev');


/**
 * 在 User-Agent 里加一个标记，让渲染进程知道「我是桌面版」。
 *
 * 为什么要这么做：渲染进程开了 contextIsolation 且没给 preload，
 * 拿不到 process.versions.electron，没法区分「浏览器里跑」和「桌面版里跑」。
 * 加个 UA 标记最省事，页面里 `navigator.userAgent.includes('TradeDocsDesktop')` 即可判断。
 * 用途：桌面版不该显示「装成 App 用」的安装提示条。
 */
const DESKTOP_UA_TAG = 'TradeDocsDesktop';
app.userAgentFallback = `${app.userAgentFallback} ${DESKTOP_UA_TAG}`;

/* ------------------------- 内置静态服务 ------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

let server = null;
let baseUrl = '';

function startServer(preferredPort = 41873) {
  return new Promise((resolve, reject) => {
    const handler = (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        let rel = decodeURIComponent(url.pathname);
        if (rel === '/' || rel === '') rel = '/index.html';
        const full = path.join(ROOT, rel);
        // 防目录穿越：必须仍在 ROOT 之内
        if (!full.startsWith(ROOT)) {
          res.writeHead(403).end('Forbidden');
          return;
        }
        if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
          return;
        }
        const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
        const body = fs.readFileSync(full);
        res.writeHead(200, {
          'Content-Type': type,
          'Cache-Control': 'no-cache',
          'Service-Worker-Allowed': '/',
        });
        res.end(body);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(err));
      }
    };

    const tryListen = (port, attempt) => {
      server = http.createServer(handler);
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempt < 12) {
          tryListen(port + 1, attempt + 1);       // 端口被占就顺延，最多试 12 次
        } else {
          reject(err);
        }
      });
      server.listen(port, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${port}/index.html`;
        resolve(baseUrl);
      });
    };
    tryListen(preferredPort, 0);
  });
}

/* ------------------------- 版本变化时清缓存 ------------------------- */

/**
 * 桌面版的静态资源同样会被 Chromium 的 HTTP 缓存和 Service Worker 缓存吃住。
 * 表现就是用户最恼火的那种：「我装了新版本，界面/功能还是老的」。
 *
 * 做法：把「上次运行时的版本号」记在 userData 里，启动时比对；
 * 不一致就先清掉缓存再开窗口，保证这一版的文件一定是最新的。
 *
 * ⚠️ **绝不能清 IndexedDB** —— 那是用户的单据数据，清了就全丢了。
 *    所以这里只清 cache 类存储，明确不包含 indexeddb / localstorage。
 */
async function clearStaleCachesIfUpgraded() {
  const marker = path.join(app.getPath('userData'), 'last-version.txt');
  const current = app.getVersion();
  let last = '';
  try { last = fs.readFileSync(marker, 'utf8').trim(); } catch { /* 首次运行 */ }
  if (last === current) return false;

  try {
    const { session } = require('electron');
    const ses = session.defaultSession;
    await ses.clearCache();                 // HTTP 缓存（css / js / html）
    await ses.clearCodeCaches({});          // 编译后的 JS 代码缓存
    await ses.clearStorageData({
      // 只清缓存类；**不含** indexeddb / localstorage / cookies
      storages: ['serviceworkers', 'cachestorage', 'shadercache'],
    });
    console.log(`[TradeDocs] 版本变化 ${last || '(首次运行)'} → ${current}，已清理缓存`);
  } catch (err) {
    console.warn('[TradeDocs] 清缓存失败（不影响继续启动）:', err && err.message);
  }

  try { fs.writeFileSync(marker, current, 'utf8'); } catch { /* 写不了就算了 */ }
  return true;
}

/* ------------------------- 窗口 ------------------------- */

let win = null;

/**
 * 在页面里点某个按钮（可以给一组候选 id，按顺序取第一个存在的）。
 *
 * 菜单栏、Ctrl+P 这类「原生入口」不要自己直接干活，而是转交给页面里的按钮：
 * 这样打印 / 导出只走页面里那一套逻辑（纸张方向、页边距、状态提示都在页面里）。
 */
function clickInPage(target, ids) {
  if (!target || target.isDestroyed()) return;
  const list = Array.isArray(ids) ? ids : [ids];
  const js = `(() => {
    const ids = ${JSON.stringify(list)};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) { el.click(); return id; }
    }
    return null;
  })()`;
  target.webContents.executeJavaScript(js).catch(() => null);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#eef1f6',
    title: '外贸单证工作台 TradeDocs',
    icon: path.join(ROOT, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  win.once('ready-to-show', () => {
    win.show();
    if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' });
  });

  win.loadURL(baseUrl);

  // 外链一律用系统浏览器打开，别在应用窗口里跳走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(baseUrl.replace('/index.html', ''))) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 用户按 Ctrl+P / 点打印时，走系统打印对话框
  // 统一改成点页面上的「打印」按钮：纸张方向（报关单是横向）、页边距都在页面里控制。
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && input.key.toLowerCase() === 'p') {
      event.preventDefault();
      clickInPage(win, 'btnPrint');
    }
  });

  win.on('closed', () => { win = null; });
}

/* ------------------------- 应用菜单 ------------------------- */

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建窗口', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { type: 'separator' },
        // 打印 / 导出都转交页面按钮：纸张方向与页边距在页面里控制
        { label: '打印当前单据…', accelerator: 'CmdOrCtrl+P', click: () => clickInPage(win, 'btnPrint') },
        // ⚠️ 按钮 ID 改过一轮：早先是 btnExport，现在是 btnPdf（只保留 PDF 导出）。
        //    这里同时试两个，免得以后改 ID 又悄悄失效。
        {
          label: '导出 PDF…',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => clickInPage(win, ['btnPdf', 'btnExport']),
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'forceReload', label: '强制重新载入（清缓存）' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '使用说明',
          click: () => {
            const doc = path.join(ROOT, 'docs', '使用说明.md');
            if (fs.existsSync(doc)) shell.openPath(doc);
          },
        },
        {
          label: '数据存放位置说明',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: '数据存在哪里？',
              message: '数据 100% 存在本机',
              detail: '所有单据、客户、产品都保存在本机浏览器数据库（IndexedDB）中，'
                + '不上传任何服务器。\n\n'
                + '建议定期用「设置 → 备份与恢复 → 导出备份」保存一份 JSON 到 U 盘或网盘。\n\n'
                + `应用文件目录：\n${ROOT}`,
              buttons: ['知道了'],
            });
          },
        },
        { type: 'separator' },
        { label: `版本 ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------- 生命周期 ------------------------- */

// 只允许单实例：第二次点图标时聚焦已有窗口，避免同一份数据被两个进程写
/* 数据目录：默认 %APPDATA%\外贸单证工作台；用户可在设置里改到别的盘 */
let DATA_DIR_FALLBACK = null;
try {
  const resolved = resolveDataDir({ app, productDirName: '外贸单证工作台' });
  DATA_DIR_FALLBACK = resolved.fallbackFrom;
} catch (err) { console.warn('[数据目录] 初始化失败:', err && err.message); }

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(async () => {
    // 先清旧版本缓存，再起服务/开窗口 —— 顺序很重要，否则窗口可能先命中旧缓存
    await clearStaleCachesIfUpgraded();
    try {
      await startServer();
    } catch (err) {
      dialog.showErrorBox('启动失败', `内置服务无法启动：\n${err && err.message ? err.message : err}`);
      app.quit();
      return;
    }
    buildMenu();
    // 「导出 PDF」= 生成文件并另存为（不是弹打印对话框）
    /* 数据目录：设置页显示真实路径 + 一键打开 */
  ipcMain.handle('td:data-dir', () => ({
    path: app.getPath('userData'),
    dbPath: require('node:path').join(app.getPath('userData'), 'IndexedDB'),
  }));
  ipcMain.handle('td:open-data-dir', async () => {
    const dir = require('node:path').join(app.getPath('userData'), 'IndexedDB');
    const target = require('node:fs').existsSync(dir) ? dir : app.getPath('userData');
    const err = await shell.openPath(target);
    return { ok: !err, path: target, error: err || null };
  });

  registerExportPdf({ ipcMain, dialog, BrowserWindow, app, getWindow: () => win });
  registerBackup({ ipcMain, app });   // 备份：写盘/列表/读取
  registerDataDir({ ipcMain, app, dialog, productDirName: '外贸单证工作台', getWindow: () => win });
  ipcMain.handle('td:data-dir-fallback', () => DATA_DIR_FALLBACK);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (server) { try { server.close(); } catch { /* 退出时忽略 */ } }
  });
}
