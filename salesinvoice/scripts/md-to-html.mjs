/* =============================================================
 * Markdown → 单文件 HTML（用于把《使用说明》转成能直接双击打开、能打印成 PDF 的页面）
 *
 * 用法：node scripts/md-to-html.mjs docs/使用说明.md docs/使用说明.html "外贸单证工作台 · 使用说明"
 *
 * 只实现这份文档用到的语法：标题 / 段落 / 表格 / 列表 / 引用 / 代码块 / 行内代码 /
 * 粗体 / 链接 / 分隔线 / 复选框。够用即可，不引第三方依赖。
 * ============================================================= */

import fs from 'node:fs';
import path from 'node:path';

const [, , src, out, titleArg] = process.argv;
if (!src || !out) {
  console.error('用法: node scripts/md-to-html.mjs <输入.md> <输出.html> [标题]');
  process.exit(1);
}

const srcPath = path.resolve(src);
const md = fs.readFileSync(srcPath, 'utf8');
let inlined = 0;
const title = titleArg || path.basename(src, '.md');

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 行内语法 */
function inline(s) {
  let t = esc(s);
  // 图片：![说明](路径) —— 本地图片转成 base64 内嵌，产出单文件 HTML（方便直接发给别人）
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
    let url = src;
    try {
      const abs = path.resolve(path.dirname(srcPath), src);
      if (!/^https?:/i.test(src) && fs.existsSync(abs)) {
        const buf = fs.readFileSync(abs);
        const ext = path.extname(abs).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.gif' ? 'image/gif' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
        url = `data:${mime};base64,${buf.toString('base64')}`;
        inlined += 1;
      }
    } catch { /* 读不到就按原路径引用 */ }
    return `<img src="${url}" alt="${alt}" />`;
  });
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  t = t.replace(/✅/g, '<span class="yes">✅</span>');
  // 段落里的软换行保留
  return t;
}

const slug = (s) => 'h-' + s.replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

const lines = md.split(/\r?\n/);
const html = [];
const toc = [];
let i = 0;
let inCode = false;

const flushList = (stack) => { while (stack.length) html.push(stack.pop()); };

while (i < lines.length) {
  const line = lines[i];

  /* 代码块 */
  if (/^```/.test(line)) {
    if (!inCode) { inCode = true; html.push('<pre><code>'); }
    else { inCode = false; html.push('</code></pre>'); }
    i++; continue;
  }
  if (inCode) { html.push(esc(line)); i++; continue; }

  /* 表格：| a | b |  + 分隔行 */
  if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const head = cells(line);
    i += 2;
    const body = [];
    while (i < lines.length && /^\s*\|/.test(lines[i])) { body.push(cells(lines[i])); i++; }
    html.push('<table><thead><tr>' + head.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>'
      + body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
      + '</tbody></table>');
    continue;
  }

  /* 标题 */
  const h = /^(#{1,6})\s+(.*)$/.exec(line);
  if (h) {
    const lv = h[1].length;
    const id = slug(h[2]);
    if (lv <= 3) toc.push({ lv, id, text: h[2] });
    html.push(`<h${lv} id="${id}">${inline(h[2])}</h${lv}>`);
    i++; continue;
  }

  /* 引用块（连续行合并） */
  if (/^>\s?/.test(line)) {
    const buf = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
    html.push('<blockquote>' + buf.map((b) => (b.trim() ? `<p>${inline(b)}</p>` : '')).join('') + '</blockquote>');
    continue;
  }

  /* 列表 */
  if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
    const ordered = /^\s*\d+\./.test(line);
    const items = [];
    while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
      let text = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
      // 续行（缩进的非列表行）
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i + 1])) {
        i++; text += ' ' + lines[i].trim();
      }
      items.push(`<li>${inline(text)}</li>`);
      i++;
    }
    html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
    continue;
  }

  /* 分隔线 */
  if (/^\s*---+\s*$/.test(line)) { html.push('<hr />'); i++; continue; }

  /* 空行 */
  if (!line.trim()) { i++; continue; }

  /* 段落（连续非空行合并） */
  const buf = [];
  while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|\s*[-*]\s|\s*\d+\.\s|\s*\||```|---)/.test(lines[i])) {
    buf.push(lines[i]); i++;
  }
  if (buf.length) html.push(`<p>${buf.map(inline).join('<br />')}</p>`);
}

const tocHtml = toc.filter((t) => t.lv <= 3).map((t) => `<a class="toc-l${t.lv}" href="#${t.id}">${esc(t.text)}</a>`).join('');

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { --ink:#1f2937; --mute:#6b7280; --line:#e5e7eb; --accent:#2563eb; --bg:#f6f7f9; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font: 15px/1.85 -apple-system, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 32px 22px 80px; }
  .sheet { background:#fff; border-radius: 14px; padding: 34px 40px 46px; box-shadow: 0 6px 28px rgba(0,0,0,.07); }
  h1 { font-size: 27px; margin: 0 0 6px; padding-bottom: 12px; border-bottom: 2px solid var(--accent); }
  h2 { font-size: 21px; margin: 34px 0 10px; padding-left: 10px; border-left: 4px solid var(--accent); }
  h3 { font-size: 17px; margin: 24px 0 8px; color:#111827; }
  h4 { font-size: 15px; margin: 18px 0 6px; color:var(--mute); }
  p { margin: 9px 0; }
  a { color: var(--accent); }
  code { background:#f1f5f9; border:1px solid var(--line); border-radius:4px; padding:1px 5px;
    font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
  pre { background:#0f172a; color:#e2e8f0; padding:14px 16px; border-radius:9px; overflow:auto; }
  pre code { background:none; border:none; color:inherit; padding:0; }
  img { max-width: 100%; height: auto; display: block; margin: 14px auto 6px;
    border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.08); }
  p > img + em { display:block; text-align:center; color:var(--mute); font-size:12.5px; }
  table { border-collapse: collapse; width:100%; margin: 12px 0 16px; font-size: 14px; }
  th, td { border:1px solid var(--line); padding: 7px 10px; text-align:left; vertical-align: top; }
  th { background:#f8fafc; font-weight:600; }
  tr:nth-child(even) td { background:#fcfcfd; }
  blockquote { margin: 12px 0; padding: 10px 16px; background:#f8fafc; border-left: 4px solid #cbd5e1;
    border-radius: 0 8px 8px 0; color:#334155; }
  blockquote p { margin: 4px 0; }
  hr { border:0; border-top:1px dashed var(--line); margin: 26px 0; }
  ul, ol { padding-left: 24px; margin: 8px 0; }
  li { margin: 4px 0; }
  .yes { color:#16a34a; }
  .toc { background:#fff; border-radius:12px; padding:16px 20px; margin-bottom:20px; box-shadow:0 4px 18px rgba(0,0,0,.05); }
  .toc .ttl { font-weight:600; margin-bottom:8px; }
  .toc a { display:block; text-decoration:none; color:#334155; font-size:13.5px; padding:2px 0; }
  .toc a:hover { color: var(--accent); }
  .toc .toc-l2 { padding-left: 0; }
  .toc .toc-l3 { padding-left: 16px; color:#64748b; }
  .bar { position: sticky; top:0; z-index:9; display:flex; gap:8px; align-items:center;
    padding:10px 0 14px; background:linear-gradient(var(--bg), rgba(246,247,249,.85)); }
  .bar button { font: inherit; font-size:13.5px; padding:7px 14px; border-radius:8px; border:1px solid var(--line);
    background:#fff; cursor:pointer; }
  .bar button.primary { background: var(--accent); color:#fff; border-color: var(--accent); }
  .bar .meta { color: var(--mute); font-size: 12.5px; margin-left:auto; }
  @media print {
    body { background:#fff; } .bar, .toc { display:none; }
    .sheet { box-shadow:none; border-radius:0; padding:0; } .wrap { max-width:none; padding:0; }
    h2 { break-after: avoid; } table, pre, blockquote { break-inside: avoid; }
  }
</style></head>
<body><div class="wrap">
  <div class="bar">
    <button class="primary" onclick="window.print()">🖨 打印 / 存成 PDF</button>
    <button onclick="document.querySelectorAll('.toc a')[0].click()">↑ 回到开头</button>
    <span class="meta">${esc(title)} · 由 Markdown 生成</span>
  </div>
  <div class="toc"><div class="ttl">目录</div>${tocHtml}</div>
  <div class="sheet">${html.join('\n')}</div>
</div></body></html>`;

fs.writeFileSync(out, page);
console.log(`✓ 已生成 ${out}`);
console.log(`  源文件 ${md.split(/\r?\n/).length} 行 → 网页 ${page.split(/\r?\n/).length} 行，目录 ${toc.length} 项`);
