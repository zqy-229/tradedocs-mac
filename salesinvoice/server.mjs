#!/usr/bin/env node
/* =============================================================
 * 外贸单证工作台 —— 本地静态服务器（零依赖，仅监听本机 127.0.0.1）
 * 说明：
 *   1) 本服务器只把本地静态文件发给浏览器，不联网、不上传、不写任何业务数据
 *   2) 业务数据全部保存在浏览器的 IndexedDB（本机）
 *   3) 之所以需要它：浏览器安全策略禁止 file:// 页面加载 ES 模块 / Service Worker，
 *      而 PWA「添加到主屏幕 + 离线打开」必须走 http(s)
 * 用法：node server.mjs [端口]
 * ============================================================= */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const START_PORT = Number(process.argv[2]) || 8080;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-cache',
    // 本地工具，无需跨域，这里仅放开同源之外的本地调试便利
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  } catch {
    send(res, 400, '错误的请求地址');
    return;
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // 防目录穿越：解析后必须仍在项目目录内
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, '禁止访问');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      send(res, 404, `404 未找到：${urlPath}`, { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Content-Length': stat.size };
    if (ext === '.js' || ext === '.mjs' || ext === '.css') headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

/** 端口被占用时自动顺延，避免启动失败 */
function listen(port, attempts = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempts < 20) {
      listen(port + 1, attempts + 1);
    } else {
      console.error(`启动失败：${err.message}`);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}/`;
    console.log('');
    console.log('  ┌──────────────────────────────────────────────┐');
    console.log('  │  外贸单证工作台 TradeDocs 已启动（本地离线）  │');
    console.log('  └──────────────────────────────────────────────┘');
    console.log('');
    console.log(`  请用浏览器打开：  ${url}`);
    console.log('');
    console.log('  · 数据保存在浏览器本机（IndexedDB），不上传任何服务器');
    console.log('  · 手机访问：手机与电脑连同一个局域网，改用本机内网 IP 即可');
    console.log('  · 关闭此窗口即停止服务（已保存的草稿不会丢失）');
    console.log('');
  });
}

listen(START_PORT);

process.on('SIGINT', () => {
  console.log('\n已停止本地服务。');
  process.exit(0);
});
