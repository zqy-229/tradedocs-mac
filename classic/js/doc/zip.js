/* =============================================================
 * ZIP 打包（零依赖）
 *   · 优先用 CompressionStream('deflate-raw') 压缩
 *   · 环境不支持时退回「存储模式」，仍是合法 ZIP
 * 供 .xlsx / .docx 两种 OOXML 导出共用
 * ============================================================= */

/** CRC32 查表 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** 是否支持原生 deflate */
export function canDeflate() {
  return typeof CompressionStream !== 'undefined';
}

async function deflateRaw(bytes) {
  if (!canDeflate()) return { data: bytes, method: 0 };
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = await new Response(stream).arrayBuffer();
    return { data: new Uint8Array(buf), method: 8 };
  } catch {
    return { data: bytes, method: 0 };
  }
}

/**
 * 打一个最小可用的 ZIP（OOXML 够用）
 * @param {Array<{name: string, text: string}>} files
 * @param {string} mime
 * @returns {Promise<Blob>}
 */
export async function makeZip(files, mime = 'application/zip') {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const raw = enc.encode(f.text);
    const crc = crc32(raw);
    const { data, method } = await deflateRaw(raw);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);      // 本地文件头
    lv.setUint16(4, 20, true);              // 解压所需版本
    lv.setUint16(6, 0x0800, true);          // 文件名为 UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);              // 修改时间
    lv.setUint16(12, 0x21, true);           // 修改日期（1980-01-01）
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);    // 压缩后大小
    lv.setUint32(22, raw.length, true);     // 原始大小
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);              // 额外字段长度
    local.set(nameBytes, 30);
    parts.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);      // 中央目录头
    cv.setUint16(4, 20, true);              // 创建版本
    cv.setUint16(6, 20, true);              // 解压版本
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);         // 本地头偏移
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);        // 中央目录结束标记
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: mime });
}
