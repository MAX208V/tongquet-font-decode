// Vercel Serverless Function: 动态解码铜雀台 woff2 字体映射
// 用法: GET /api/decode?url=<font_url>
// 返回: { mapping: { [混淆字符码]: 真实字符码 }, count, fontUrl }

const wawoff2 = require('wawoff2');

// === TTF 表解析辅助 ===
function r16(v, o) { return (v[o] << 8) | v[o + 1]; }
function r32(v, o) { return (v[o] << 24) | (v[o + 1] << 16) | (v[o + 2] << 8) | v[o + 3]; }

// 标准 Mac glyph 名字 (索引 0..257)
const MAC_NAMES = [
  '.notdef', '.null', 'nonmarkingreturn', 'space', 'exclam', 'quotedbl', 'numbersign', 'dollar',
  'percent', 'ampersand', 'quotesingle', 'parenleft', 'parenright', 'asterisk', 'plus', 'comma',
  'hyphen', 'period', 'slash', 'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'colon', 'semicolon', 'less', 'equal', 'greater', 'question', 'at',
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  'bracketleft','backslash','bracketright','asciicircum','underscore','grave',
  'a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z',
  'braceleft','bar','braceright','asciitilde',
  'Adieresis','Aring','Ccedilla','Eacute','Ntilde','Odieresis','Udieresis',
  'aacute','agrave','acircumflex','adieresis','atilde','aring','ccedilla','eacute','egrave','ecircumflex','edieresis',
  'iacute','igrave','icircumflex','idieresis','ntilde','oacute','ograve','ocircumflex','odieresis','otilde',
  'uacute','ugrave','ucircumflex','udieresis','dagger','degree','cent','sterling','section','bullet','paragraph','germandbls',
  'registered','copyright','trademark','acute','dieresis','notequal','AE','Oslash','infinity',
  'plusminus','lessequal','greaterequal','yen','mu','partialdiff','summation','product','pi',
  'integral','ordfeminine','ordmasculine','Omega','ae','oslash','questiondown','exclamdown',
  'logicalnot','radical','florin','approxequal','Delta','guillemotleft','guillemotright',
  'ellipsis','nonbreakingspace',
  'Agrave','Atilde','Otilde','OE','oe','endash','emdash','quotedblleft','quotedblright','quoteleft','quoteright',
  'divide','lozenge','ydieresis','Ydieresis','fraction','currency','guilsinglleft','guilsinglright','fi','fl','daggerdbl',
  'periodcentered','quotesinglbase','quotedblbase','perthousand','Acircumflex','Ecircumflex','Aacute','Edieresis','Egrave',
  'Iacute','Icircumflex','Idieresis','Igrave','Oacute','Ocircumflex','apple','Ograve','Uacute','Ucircumflex','Ugrave',
  'dotlessi','circumflex','tilde','macron','breve','dotaccent','ring','cedilla','hungarumlaut','ogonek','caron',
  'Lslash','lslash','Scaron','scaron','Zcaron','zcaron','brokenbar','Eth','eth','Yacute','yacute','Thorn','thorn',
  'minus','multiply','onesuperior','twosuperior','threesuperior','onehalf','onequarter','threequarters','franc',
  'Gbreve','gbreve','Idot','Scedilla','scedilla','Cacute','cacute','Ccaron','ccaron','dcroat'
];
const MAC_LEN = MAC_NAMES.length;

/**
 * 解析已解压的 TTF 字体的 cmap 映射
 * @param {Uint8Array} ttf - 已解压的 TTF 文件数据
 * @returns {object} { [混淆字符码]: 真实 Unicode 码点 }
 */
function parseTTFCmap(ttf) {
  // 读取 TTF 表目录找到 cmap 和 post
  const numTables = r16(ttf, 4);
  let cmapOff = -1, postOff = -1;

  for (let ti = 0; ti < numTables; ti++) {
    const to = 12 + ti * 16;
    const tag = String.fromCharCode(ttf[to], ttf[to+1], ttf[to+2], ttf[to+3]);
    if (tag === 'cmap') cmapOff = r32(ttf, to+8);
    if (tag === 'post') postOff = r32(ttf, to+8);
  }

  if (cmapOff < 0) throw new Error('cmap table not found');
  if (postOff < 0) throw new Error('post table not found');

  // === 解析 cmap (format 12 优先, format 4 回退) ===
  const numSubtables = r16(ttf, cmapOff + 2);
  const glyphMap = {};

  for (let ci = 0; ci < numSubtables; ci++) {
    const sto = cmapOff + 4 + ci * 8;
    const subOff = r32(ttf, sto + 4);
    const subStart = cmapOff + subOff;
    const fmt = r16(ttf, subStart);

    if (fmt === 12) {
      const nGroups = r32(ttf, subStart + 12);
      for (let gi = 0; gi < nGroups; gi++) {
        const go = subStart + 16 + gi * 12;
        const scc = r32(ttf, go);
        const ecc = r32(ttf, go + 4);
        const sgid = r32(ttf, go + 8);
        for (let c = scc; c <= ecc; c++) glyphMap[c] = sgid + (c - scc);
      }
    } else if (fmt === 4) {
      const segCountX2 = r16(ttf, subStart + 6);
      if (segCountX2 > 0xFFFF) continue;
      const segCount = segCountX2 >>> 1;
      const endCodes = subStart + 14;
      const startCodes = endCodes + segCountX2 + 2;
      const idDelta = startCodes + segCountX2;
      const idRangeOff = idDelta + segCountX2;

      for (let si = 0; si < segCount; si++) {
        const ec = r16(ttf, endCodes + si * 2);
        if (ec === 0xFFFF) break;
        const sc = r16(ttf, startCodes + si * 2);
        const delta = r16(ttf, idDelta + si * 2);
        const sdelta = delta > 0x7FFF ? delta - 0x10000 : delta;
        const ro = r16(ttf, idRangeOff + si * 2);

        if (ro === 0) {
          for (let c = sc; c <= ec; c++) glyphMap[c] = (c + sdelta) & 0xFFFF;
        } else {
          const base = idRangeOff + si * 2;
          for (let c = sc; c <= ec; c++) {
            const ri = (ro >>> 1) + (c - sc) - (segCount - si);
            const gid = r16(ttf, base + ri * 2);
            if (gid !== 0) glyphMap[c] = (gid + sdelta) & 0xFFFF;
          }
        }
      }
    }
  }

  // === 解析 post 表 format 2.0 ===
  const postFmt = r16(ttf, postOff);
  if (postFmt !== 2) throw new Error('post format must be 2, got ' + postFmt);

  const numGlyphs = r16(ttf, postOff + 32);
  const nameIdx = [];
  for (let ni = 0; ni < numGlyphs; ni++) nameIdx.push(r16(ttf, postOff + 34 + ni * 2));

  // 读取自定义 glyph 名字 (在 glyphNameIndex 数组之后)
  // post format 2.0: Pascal-style strings (length-prefixed)
  let namePos = postOff + 34 + numGlyphs * 2;
  const customNames = [];
  while (namePos < ttf.length && customNames.length < numGlyphs) {
    const len = ttf[namePos++];
    if (len === 0) {
      customNames.push('');
      continue;
    }
    let str = '';
    for (let i = 0; i < len && namePos < ttf.length; i++) {
      str += String.fromCharCode(ttf[namePos++]);
    }
    customNames.push(str);
  }

  // 构建 glyph ID → Unicode 码点
  const glyphToUni = {};
  for (let gi = 0; gi < numGlyphs; gi++) {
    const ni = nameIdx[gi];
    const name = ni < MAC_LEN ? MAC_NAMES[ni] : (customNames[ni - MAC_LEN] || '');
    if (name.startsWith('uni') && name.length >= 6) {
      const cp = parseInt(name.substring(3), 16);
      if (!isNaN(cp)) glyphToUni[gi] = cp;
    }
  }

  // === 最终映射: 混淆字符码点 → 真实 Unicode ===
  const result = {};
  for (const [ks, gid] of Object.entries(glyphMap)) {
    const k = Number(ks);
    const real = glyphToUni[gid];
    if (real !== undefined && real !== k) result[k] = real;
  }

  return result;
}

// === HTTP 请求辅助 ===
async function fetchAsBuffer(url, extraHeaders = {}) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...extraHeaders
    }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url.substring(0, 80)}`);
  return new Uint8Array(await resp.arrayBuffer());
}

// === 文本请求辅助 ===
async function fetchAsText(url, extraHeaders = {}) {
  const buf = await fetchAsBuffer(url, extraHeaders);
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

// === Vercel Serverless Handler ===
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=30');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ua = 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  const { url: fontUrl, b64: fontB64, page: pageUrl } = req.query;

  try {
    let fontBuf;

    if (fontB64) {
      // 模式1: ?b64=base64字体数据 → Legado 编码后传给 Vercel 解析
      const binaryStr = atob(fontB64);
      const buf = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) buf[i] = binaryStr.charCodeAt(i);
      fontBuf = buf;
    } else if (fontUrl) {
      // 模式2: ?url=字体URL → Vercel 直接下载字体解析
      fontBuf = await fetchAsBuffer(fontUrl, {
        'Referer': 'https://tongquet.com', 'Origin': 'https://tongquet.com',
        'User-Agent': ua, 'Accept': 'application/font-woff2,*/*'
      });
    } else if (pageUrl) {
      // 模式3: ?page=章节URL → Vercel 全自动获取
      return res.json({ error: 'Vercel IP blocked by tongquet.com, use ?b64= mode instead' });
    } else {
      return res.status(400).json({ error: 'Missing ?url= or ?b64=' });
    }

    const ttfBuf = await wawoff2.decompress(fontBuf);
    const mapping = parseTTFCmap(new Uint8Array(ttfBuf));

    res.json({ mapping, count: Object.keys(mapping).length });
  } catch (e) {
    res.status(500).json({
      error: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
};
