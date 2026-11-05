/* MARS web - "Tirar prints": renders the MARS window to PNG images without any screen-capture
   permission and packs them into a Word document.
   Rendering: the live DOM is cloned into an SVG <foreignObject> with the stylesheet embedded, which
   the browser rasterises. Scroll positions don't survive cloning, so scrolled panes are rebuilt with
   an offset and drawn scrollbars. */
(function () {
  const M = globalThis.MARS, U = M.ui, h = U.h, ed = M.editor;
  const P = (M.prints = { busy: false });
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = () => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 120); }); // the timeout covers hidden tabs

  /* ---------- rendering ---------------------------------------------------------------------- */
  let cssText = null;
  const dataCache = new Map();
  const toData = (blob) => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(blob); });
  async function imgData(src) {
    if (!dataCache.has(src)) dataCache.set(src, await toData(await (await fetch(src)).blob()));
    return dataCache.get(src);
  }
  const clean = (s) => s.replace(/[^\x09\x0a\x0d\x20-퟿-�]/g, ' ');
  const BAR = 17;
  function scrollbars(box, o, showV, showH) {
    const cw = o.clientWidth, ch = o.clientHeight;
    const bar = (cls, len, client, full, pos) => {
      const track = len - 2 * BAR, thumb = Math.max(20, Math.round((track * client) / Math.max(full, client)));
      const off = BAR + (full > client ? Math.round(((track - thumb) * pos) / (full - client)) : 0);
      const b = document.createElementNS(XHTML, 'div'); b.className = 'fsb ' + cls;
      const mk = (c, st) => { const i = document.createElementNS(XHTML, 'i'); i.className = c; if (st) i.style.cssText = st; b.append(i); };
      mk('a'); mk('b');
      if (full > client) mk('t', cls === 'v' ? `top:${off}px;height:${thumb}px` : `left:${off}px;width:${thumb}px`);
      return b;
    };
    if (showV) { const b = bar('v', ch + (showH ? BAR : 0), ch, o.scrollHeight, o.scrollTop); b.style.bottom = showH ? BAR + 'px' : '0'; box.append(b); }
    if (showH) { const b = bar('h', cw + (showV ? BAR : 0), cw, o.scrollWidth, o.scrollLeft); b.style.right = showV ? BAR + 'px' : '0'; box.append(b); }
  }
  function replaceTextarea(o, c, isEditor) {
    const cs = getComputedStyle(o);
    const d = document.createElementNS(XHTML, 'div');
    const props = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'flex', 'minWidth', 'fontFamily', 'fontSize', 'lineHeight', 'fontWeight', 'fontStyle', 'backgroundColor', 'boxSizing', 'tabSize', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'paddingLeft', 'paddingRight'];
    for (const p of props) d.style[p] = cs[p];
    d.style.overflow = 'hidden'; d.style.whiteSpace = 'pre'; d.style.color = '#000';
    if (cs.position !== 'absolute') d.style.position = 'relative';
    const inner = document.createElementNS(XHTML, 'div');
    inner.style.transform = `translate(${-o.scrollLeft}px,${-o.scrollTop}px)`;
    if (!isEditor) inner.textContent = clean(o.value);
    d.append(inner);
    const sv = o.scrollHeight > o.clientHeight || cs.overflowY === 'scroll', sh = o.scrollWidth > o.clientWidth || cs.overflowX === 'scroll';
    scrollbars(d, o, sv, sh);
    c.replaceWith(d);
  }
  function tableScroller(o, c) {
    const trsO = o.querySelectorAll('tbody tr'), trsC = c.querySelectorAll('tbody tr');
    const headH = o.querySelector('thead') ? o.querySelector('thead').offsetHeight : 0;
    trsO.forEach((tr, i) => { if (tr.offsetTop + tr.offsetHeight <= o.scrollTop + headH) trsC[i].remove(); });
    const sv = o.scrollHeight > o.clientHeight, sh = o.scrollWidth > o.clientWidth;
    c.style.overflow = 'hidden';
    if (sv) c.style.paddingRight = BAR + 'px';
    if (sh) c.style.paddingBottom = BAR + 'px';
    if (sv || sh) scrollbars(c, o, sv, sh);
  }
  P.snapshot = async function (scale) {
    const k = scale || 2, w = innerWidth, ht = innerHeight;
    if (cssText === null) cssText = await (await fetch('css/mars.css')).text();
    const body = document.body;
    const orig = [body, ...body.querySelectorAll('*')];
    const copy = body.cloneNode(true);
    const dup = [copy, ...copy.querySelectorAll('*')];
    const later = [];
    for (let i = 0; i < orig.length; i++) {
      const o = orig[i], c = dup[i], tag = o.tagName;
      if (tag === 'SCRIPT' || o.id === 'tip' || o.id === 'guide') { later.push(() => c.remove()); continue; }
      if (tag === 'TEXTAREA') later.push(() => replaceTextarea(o, c, o.parentElement.classList.contains('scroller')));
      else if (tag === 'IMG') { const src = o.getAttribute('src'); if (src) { const d = await imgData(src); c.setAttribute('src', d); } }
      else if (tag === 'INPUT') {
        c.setAttribute('value', o.value);
        if (o.checked) c.setAttribute('checked', 'checked'); else c.removeAttribute('checked');
      } else if (tag === 'OPTION') { if (o.selected) c.setAttribute('selected', 'selected'); else c.removeAttribute('selected'); }
      else if (tag === 'CANVAS') {
        const im = document.createElementNS(XHTML, 'img');
        try { im.setAttribute('src', o.toDataURL()); } catch (e) { /* tainted */ }
        im.style.cssText = o.style.cssText; im.width = o.clientWidth || o.width; im.height = o.clientHeight || o.height;
        later.push(() => c.replaceWith(im));
      } else if (tag === 'IFRAME') later.push(() => c.remove());
      else if (o.classList && o.classList.contains('tscroll')) later.push(() => tableScroller(o, c));
      else if (o.classList && o.classList.contains('gutter')) {
        const inner = document.createElementNS(XHTML, 'div');
        inner.textContent = o.textContent; inner.style.transform = `translateY(${-o.scrollTop}px)`;
        later.push(() => { c.textContent = ''; c.append(inner); });
      } else if (o.id === 'labelsBody') {
        later.push(() => {
          const inner = document.createElementNS(XHTML, 'div');
          inner.style.transform = `translateY(${-o.scrollTop}px)`;
          while (c.firstChild) inner.append(c.firstChild);
          c.append(inner); c.style.overflow = 'hidden'; c.style.position = 'relative';
          if (o.scrollHeight > o.clientHeight) scrollbars(c, o, true, false);
        });
      }
    }
    later.forEach((f) => f());
    /* preferences stored as CSS variables, fixed elements inside foreignObject */
    const vars = document.documentElement.style.cssText;
    const fix = '.dlgwrap,.popup{position:absolute!important}html,body{width:100%;height:100%;margin:0}';
    const wrap = document.createElementNS(XHTML, 'div');
    wrap.setAttribute('style', `${vars};position:absolute;left:0;top:0;width:${w}px;height:${ht}px;overflow:hidden;background:#eee;font:bold 12px Arial`);
    const style = document.createElementNS(XHTML, 'style'); style.textContent = cssText + fix;
    const inner = document.createElementNS(XHTML, 'div'); inner.setAttribute('style', 'position:absolute;inset:0');
    while (copy.firstChild) inner.append(copy.firstChild);
    wrap.append(style, inner);
    const xml = new XMLSerializer().serializeToString(wrap);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * k}" height="${ht * k}" viewBox="0 0 ${w} ${ht}"><foreignObject x="0" y="0" width="${w}" height="${ht}">${xml}</foreignObject></svg>`;
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('render failed')); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const cv = document.createElement('canvas'); cv.width = w * k; cv.height = ht * k;
    const g = cv.getContext('2d'); g.fillStyle = '#eee'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0);
    return cv;
  };
  const pngOf = (cv) => new Promise((res, rej) => cv.toBlob((b) => (b ? b.arrayBuffer().then((x) => res(new Uint8Array(x)), rej) : rej(new Error('a janela está oculta ou sem tamanho'))), 'image/png'));

  /* ---------- the sequence of prints ------------------------------------------------------------ */
  async function shot(list, caption, f) {
    await frames(); await wait(30);
    const k = 2, full = await P.snapshot(k);
    /* crop to the code: line numbers + text, without the panes or the scrollbars */
    const r = f.root.getBoundingClientRect(), t = f.ta.getBoundingClientRect();
    const x = r.left + 1, y = t.top, w = t.left - x + f.ta.clientWidth, ht = f.ta.clientHeight;
    const cv = document.createElement('canvas'); cv.width = w * k; cv.height = ht * k;
    cv.getContext('2d').drawImage(full, -x * k, -y * k);
    list.push({ caption, png: await pngOf(cv), w: cv.width, h: cv.height });
  }
  async function pages(list, f) {
    const ta = f.ta, lineH = ed.lineH();
    const total = ta.value.replace(/\s+$/, '').split('\n').length, per = Math.max(1, Math.floor(ta.clientHeight / lineH));
    for (let top = 0; top < total; top += per) {
      ta.scrollTop = top * lineH;
      ed.sync(f);
      const a = Math.round(ta.scrollTop / lineH) + 1, b = Math.min(total, a + per - 1); // the last page can't scroll any further
      await shot(list, total > per ? `C\u00f3digo-fonte (linhas ${a} a ${b})` : 'C\u00f3digo-fonte', f);
    }
  }
  P.run = async function () {
    const app = M.app, f = ed.cur;
    if (P.busy || !f) return;
    if (M.sim.running) return;
    P.busy = true; app.updateState();
    const list = [], base = f.name.split(/[\/]/).pop().replace(/\.\w+$/, '');
    /* the other panes are hidden meanwhile so that each print holds as much code as possible */
    const msg = document.getElementById('msgPane'), reg = document.getElementById('regPane');
    const tab = app.mainTabs.selected, top = f.ta.scrollTop, left = f.ta.scrollLeft;
    try {
      msg.style.display = 'none'; reg.style.display = 'none';
      f.cl.style.visibility = 'hidden';
      app.selectTab(0); f.ta.blur(); f.ta.scrollLeft = 0;
      await frames();
      await pages(list, f);
      if (!f.ta.value.trim()) throw new Error('o arquivo est\u00e1 vazio');
      const name = base + '-prints.docx';
      const blob = buildDocx(list, f.name.split(/[\/]/).pop());
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      P.last = { blob, name, count: list.length, captions: list.map((x) => x.caption) };
      U.message('Tirar prints', list.length + ' prints exportados em ' + name + '.');
    } catch (e) {
      U.message('Tirar prints', 'N\u00e3o foi poss\u00edvel gerar os prints: ' + e.message, 'error');
    } finally {
      msg.style.display = ''; reg.style.display = ''; f.cl.style.visibility = '';
      app.selectTab(tab); f.ta.scrollTop = top; f.ta.scrollLeft = left; ed.sync(f);
      P.busy = false; app.updateState();
    }
  };

  /* ---------- docx (a zip with stored entries) ------------------------------------------------------ */
  const crcT = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
  const crc32 = (u8) => { let c = -1; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
    const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [name, data0] of files) {
      const data = typeof data0 === 'string' ? enc.encode(data0) : data0, nm = enc.encode(name), crc = crc32(data);
      const head = (sig, extra) => {
        const b = new DataView(new ArrayBuffer(sig === 0x04034b50 ? 30 : 46)); let p = 0;
        b.setUint32(p, sig, true); p += 4;
        if (sig !== 0x04034b50) { b.setUint16(p, 20, true); p += 2; }
        b.setUint16(p, 20, true); p += 2; b.setUint16(p, 0x0800, true); p += 2; b.setUint16(p, 0, true); p += 2;
        b.setUint16(p, time, true); p += 2; b.setUint16(p, date, true); p += 2;
        b.setUint32(p, crc, true); p += 4; b.setUint32(p, data.length, true); p += 4; b.setUint32(p, data.length, true); p += 4;
        b.setUint16(p, nm.length, true); p += 2; b.setUint16(p, 0, true); p += 2;
        if (extra !== undefined) b.setUint32(42, extra, true);
        return new Uint8Array(b.buffer);
      };
      const l = head(0x04034b50);
      parts.push(l, nm, data);
      cen.push(head(0x02014b50, off), nm);
      off += l.length + nm.length + data.length;
    }
    const cs = cen.reduce((a, x) => a + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cs, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...cen, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  const xe = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function buildDocx(list, fileName) {
    const W_EMU = 9612000, MAX_H = 5940000; // 26.7 x 16.5 cm: A4 landscape minus margins and caption
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    let body = '', rels = '';
    list.forEach((s, i) => {
      const n = i + 1, id = 'rId' + n, fit = Math.min(W_EMU, Math.round((MAX_H * s.w) / s.h)), cx = fit, cy = Math.round((fit * s.h) / s.w);
      rels += `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${n}.png"/>`;
      const alt = xe(`${s.caption} - ${fileName}`);
      body += `<w:p><w:pPr><w:keepNext/>${i ? '<w:pageBreakBefore/>' : ''}<w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${xe(`Print ${n}: ${s.caption}`)}</w:t></w:r></w:p>`;
      body += `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Print ${n}" descr="${alt}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    });
    const hd = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const doc = `${hd}<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const files = [
      ['[Content_Types].xml', `${hd}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
      ['_rels/.rels', `${hd}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
      ['word/document.xml', doc],
      ['word/_rels/document.xml.rels', `${hd}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`],
    ];
    list.forEach((s, i) => files.push([`word/media/image${i + 1}.png`, s.png]));
    return zip(files);
  }
  P.buildDocx = buildDocx;
})();
