/* MARS web - Execute tab (Text Segment, Data Segment, Labels internal frames) and the register panes. */
(function () {
  const M = globalThis.MARS, U = M.ui, S = M.settings, h = U.h, CPU = M.cpu, mem = M.mem;
  const { hex8 } = M;
  const X = (M.exec = {});

  /* value formatting (NumberDisplayBaseChooser) ---------------------------------------- */
  const fmtVal = (v) => (S.valHex ? hex8(v) : String(v | 0));
  const fmtAddr = (a) => (S.addrHex ? hex8(a) : String(a >>> 0));
  const ASCII = (() => {
    const t = new Array(256).fill('.');
    t[0] = '\\0'; t[8] = '\\b'; t[9] = '\\t'; t[10] = '\\n'; t[11] = '\\v'; t[12] = '\\f'; t[13] = '\\r'; t[32] = ' ';
    for (let i = 33; i < 127; i++) t[i] = String.fromCharCode(i);
    return t;
  })();
  const fmtAscii = (v) => { let r = ''; for (let i = 3; i >= 0; i--) r += ASCII[(v >>> (i * 8)) & 0xff].padStart(3, ' '); return r; };
  const fmtFloatCell = (bits) => (S.valHex ? hex8(bits) : M.javaFloat(M.intBitsToFloat(bits)));
  const fmtDoubleCell = (hi, lo) => (S.valHex ? '0x' + (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0') : M.javaDouble(M.twoIntsToDouble(hi, lo)));

  /* internal frames ----------------------------------------------------------------------- */
  const ICON = '<svg viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="12" fill="#b8cfe5" stroke="#6382bf"/><rect x="2.5" y="5" width="11" height="7.5" fill="#fff" stroke="#7a8a99" stroke-width=".6"/><rect x="2" y="3" width="12" height="1.4" fill="#6382bf"/></svg>';
  function iframe(title) {
    const cnt = h('div', { class: 'cnt' });
    const ttl = h('span', { class: 'ttl' }, title);
    const ic = h('span', { style: 'display:inline-flex' }); ic.innerHTML = ICON;
    const bi = h('button', { class: 'wbtn ic' }), bm = h('button', { class: 'wbtn mx' });
    const bar = h('div', { class: 'tbar' }, ic, ttl, bi, bm);
    const el = h('div', { class: 'iframe' }, bar, cnt);
    const f = { el, cnt, bar, title, setBounds(x, y, w, ht) { Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: ht + 'px' }); } };
    el.addEventListener('mousedown', () => activate(f), true);
    bar.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      const x0 = e.clientX - el.offsetLeft, y0 = e.clientY - el.offsetTop;
      const mv = (ev) => { el.style.left = ev.clientX - x0 + 'px'; el.style.top = ev.clientY - y0 + 'px'; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    bar.addEventListener('dblclick', (e) => { if (e.target.tagName !== 'BUTTON') toggleMax(); });
    let saved = null;
    const toggleMax = () => {
      el.classList.remove('iconified');
      if (saved) { el.style.cssText = saved; saved = null; }
      else { saved = el.style.cssText; Object.assign(el.style, { left: 0, top: 0, width: '100%', height: '100%' }); }
    };
    bm.addEventListener('click', toggleMax);
    bi.addEventListener('click', () => el.classList.toggle('iconified'));
    el.addEventListener('mousemove', (e) => {
      if (e.buttons) return;
      el.style.cursor = edge(e).cursor;
    });
    const edge = (e) => {
      const r = el.getBoundingClientRect(), m = 6;
      const w = e.clientX - r.left < m, n = e.clientY - r.top < m, ea = r.right - e.clientX < m, s = r.bottom - e.clientY < m;
      const c = (n ? 'n' : s ? 's' : '') + (w ? 'w' : ea ? 'e' : '');
      return { w, n, e: ea, s, cursor: c ? c + '-resize' : '' };
    };
    el.addEventListener('mousedown', (e) => {
      const g = edge(e);
      if (!g.cursor) return;
      e.preventDefault(); e.stopPropagation();
      const b = { l: el.offsetLeft, t: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, x: e.clientX, y: e.clientY };
      const mv = (ev) => {
        const dx = ev.clientX - b.x, dy = ev.clientY - b.y;
        if (g.e) el.style.width = Math.max(120, b.w + dx) + 'px';
        if (g.s) el.style.height = Math.max(30, b.h + dy) + 'px';
        if (g.w) { el.style.width = Math.max(120, b.w - dx) + 'px'; el.style.left = b.l + dx + 'px'; }
        if (g.n) { el.style.height = Math.max(30, b.h - dy) + 'px'; el.style.top = b.t + dy + 'px'; }
      };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    return f;
  }
  let active = null;
  function activate(f) {
    if (active === f) return;
    if (active) active.el.classList.remove('active');
    active = f; f.el.classList.add('active');
    X.desktop.append(f.el);
  }

  /* building ------------------------------------------------------------------------------- */
  X.init = function (host) {
    X.desktop = h('div', { id: 'desktop' });
    host.append(X.desktop);
    X.text = iframe('Text Segment'); X.data = iframe('Data Segment'); X.labels = iframe('Labels');
    X.desktop.append(X.data.el, X.text.el, X.labels.el);
    X.buildText(); X.buildData(); X.buildLabels();
    activate(X.text);
    new ResizeObserver(() => X.layout()).observe(X.desktop);
    X.syncRowColors();
  };
  X.layout = function () {
    const w = X.desktop.clientWidth, H = X.desktop.clientHeight;
    if (w <= 0 || H <= 0) return;
    const half = Math.floor(H / 2);
    const tw = S.labelWindow ? Math.floor(w * 0.75) : w;
    X.text.setBounds(0, 0, tw, half);
    X.data.setBounds(0, half + 1, w, H - half - 1);
    X.labels.el.style.display = S.labelWindow ? 'flex' : 'none';
    if (S.labelWindow) X.labels.setBounds(tw + 1, 0, w - tw - 1, half);
    X.dataFit();
  };
  X.syncRowColors = function () {
    const r = document.documentElement.style;
    const map = { '--even-bg': S.evenBg, '--even-fg': S.evenFg, '--odd-bg': S.oddBg, '--odd-fg': S.oddFg, '--text-hl-bg': S.textHlBg, '--text-hl-fg': S.textHlFg,
      '--delay-hl-bg': S.delayHlBg, '--delay-hl-fg': S.delayHlFg, '--data-hl-bg': S.dataHlBg, '--data-hl-fg': S.dataHlFg, '--reg-hl-bg': S.regHlBg, '--reg-hl-fg': S.regHlFg };
    for (const k in map) r.setProperty(k, map[k]);
  };

  /* text segment ------------------------------------------------------------------------------ */
  const TIPS = ['If checked, will set an execution breakpoint. Click header to disable/enable breakpoints', 'Text segment address of binary instruction code',
    '32-bit binary MIPS instruction', 'Basic assembler instruction', 'Source code line'];
  X.rows = []; X.byAddr = new Map(); X.bps = new Set(); X.bpsOn = true;
  X.buildText = function () {
    X.argIn = h('input', { class: 'tf', tip: 'Arguments provided to program at runtime via $a0 (argc) and $a1 (argv)' });
    X.argBar = h('div', { id: 'argBar' }, 'Program Arguments:', X.argIn);
    X.tscroll = h('div', { class: 'tscroll' });
    X.text.cnt.append(X.argBar, X.tscroll);
    X.argBar.classList.toggle('show', !!S.programArgs);
  };
  X.setProgramArgsVisible = (v) => X.argBar.classList.toggle('show', v);
  X.setupText = function (machine) {
    X.bps = new Set(); X.bpsOn = true; X.pcRow = null; X.rows = []; X.byAddr = new Map();
    const multi = M.program.programs.length > 1;
    let maxLine = 0;
    for (const s of machine) if (s.sourceLine > maxLine) maxLine = s.sourceLine;
    const digits = String(maxLine).length;
    let last = -1;
    const t = h('table', { class: 'jt', style: 'font-family:var(--mono)' });
    const cg = h('colgroup', null, h('col', { style: 'width:50px' }), h('col', { style: 'width:90px' }), h('col', { style: 'width:90px' }), h('col', { style: 'width:200px' }), h('col'));
    t.append(cg);
    const head = h('tr');
    ['Bkpt', 'Address', 'Code', 'Basic', 'Source'].forEach((n, i) => {
      const th = h('th', { tip: TIPS[i] }, n);
      if (i === 0) th.addEventListener('click', () => M.app.toggleBreakpoints());
      head.append(th);
    });
    t.append(h('thead', null, head));
    const tb = h('tbody');
    const frag = document.createDocumentFragment();
    machine.forEach((st, i) => {
      let src = '';
      if (st.source !== '') {
        let num = String(st.sourceLine).padStart(digits, ' ') + ': ';
        if (st.sourceLine === last) num = ' '.repeat(digits) + '  ';
        src = num + st.source;
      }
      last = st.sourceLine;
      const ck = h('input', { type: 'checkbox' });
      ck.addEventListener('change', () => { if (ck.checked) X.bps.add(st.address); else X.bps.delete(st.address); });
      const cA = h('td', { class: 'r' }, fmtAddr(st.address)), cC = h('td', { class: 'r' }, hex8(st.binary)), cB = h('td', null, M.formatBasic(st)), cS = h('td', null, src);
      const tr = h('tr', { class: i % 2 === 0 ? 'even' : 'odd' }, h('td', { class: 'c' }, ck), cA, cC, cB, cS);
      tr.addEventListener('dblclick', () => { if (st.sourceLine > 0) { M.app.selectTab(0); M.editor.gotoLine(st.sourceLine, 0, multi ? st.file : null); } });
      frag.append(tr);
      const r = { tr, st, ck, cA, cC, cB, cS, i };
      X.rows.push(r); X.byAddr.set(st.address >>> 0, r);
    });
    tb.append(frag); t.append(tb);
    X.tscroll.textContent = ''; X.tscroll.append(t);
    X.tscroll.scrollTop = 0;
  };
  X.clearText = function () { X.tscroll.textContent = ''; X.rows = []; X.byAddr = new Map(); X.pcRow = null; };
  X.refreshText = function () {
    for (const r of X.rows) { r.cA.textContent = fmtAddr(r.st.address); r.cB.textContent = M.formatBasic(r.st); }
  };
  X.refreshSelfMod = function () {
    for (const r of X.rows) {
      const st = mem.text.get(r.st.address >>> 0);
      if (st && st !== r.st) { r.st = st; r.cC.textContent = hex8(st.binary); r.cB.textContent = M.formatBasic(st); }
    }
  };
  X.sortedBreakpoints = () => (X.bpsOn && X.bps.size ? new Set(X.bps) : null);
  X.clearBreakpoints = function () { X.bps = new Set(); for (const r of X.rows) r.ck.checked = false; };
  X.toggleBreakpoints = function () {
    X.bpsOn = !X.bpsOn;
    X.tscroll.style.setProperty('--bk', X.bpsOn ? '1' : '.5');
    for (const r of X.rows) r.ck.style.opacity = X.bpsOn ? 1 : 0.4;
  };
  X.unhighlight = function () { if (X.pcRow) { X.pcRow.tr.querySelectorAll('td').forEach((c) => c.classList.remove('pc', 'ds')); X.pcRow = null; } };
  X.highlightAt = function (addr) {
    X.unhighlight();
    const r = X.byAddr.get(addr >>> 0);
    if (!r) return;
    const inDelay = S.delayedBranching && M.delayed.state === 2;
    r.tr.querySelectorAll('td').forEach((c) => c.classList.add(inDelay ? 'ds' : 'pc'));
    X.pcRow = r;
    const sc = X.tscroll, y = r.tr.offsetTop, H = sc.clientHeight, rh = r.tr.offsetHeight;
    if (y < sc.scrollTop + 20 || y + rh > sc.scrollTop + H) sc.scrollTop = Math.max(0, y - H / 2);
  };
  X.highlightPC = () => X.highlightAt(CPU.pc);

  /* data segment ------------------------------------------------------------------------------ */
  const ROWS = 16, VALS = 8, CHUNK = 512, PREV_NEXT = 256;
  const D = (X.dataState = { base: 0, sel: 0, ascii: false, hlAddr: null });
  function bases() {
    const c = mem.cfg;
    return [
      { label: fmtAddr(c.externBase) + ' (.extern)', addr: () => c.externBase, tip: 'View range around static global base address' },
      { label: fmtAddr(c.dataBase) + ' (.data)', addr: () => c.dataBase, tip: 'View range around static data segment base address' },
      { label: fmtAddr(c.heapBase) + ' (heap)', addr: () => c.heapBase, tip: 'View range around heap base address' },
      { label: 'current $gp', addr: () => (CPU.regs[28] >>> 0) - ((CPU.regs[28] >>> 0) % CHUNK), tip: 'View range around global pointer' },
      { label: 'current $sp', addr: () => { const s = CPU.regs[29] >>> 0; return s - (s % CHUNK); }, tip: 'View range around stack pointer' },
      { label: fmtAddr(c.textBase) + ' (.text)', addr: () => c.textBase, tip: 'View range around program code' },
      { label: fmtAddr(c.kdataBase) + ' (.kdata)', addr: () => c.kdataBase, tip: 'View range around kernel data base address' },
      { label: fmtAddr(c.mmioBase) + ' (MMIO)', addr: () => c.mmioBase, tip: 'View range around MMIO base address' },
    ];
  }
  X.buildData = function () {
    D.scroll = h('div', { class: 'tscroll' });
    const prev = h('button', { class: 'btn nb', tip: 'View next lower address range; hold down for rapid fire' }, h('img', { src: 'images/Previous22.png' }));
    const next = h('button', { class: 'btn nb', tip: 'View next higher address range; hold down for rapid fire' }, h('img', { src: 'images/Next22.png' }));
    const rapid = (b, d) => {
      let t = null, t2 = null;
      const stop = () => { clearTimeout(t); clearInterval(t2); };
      b.addEventListener('mousedown', () => { X.dataMove(d); t = setTimeout(() => { t2 = setInterval(() => X.dataMove(d), 60); }, 300); });
      b.addEventListener('mouseup', stop); b.addEventListener('mouseleave', stop);
    };
    rapid(prev, -PREV_NEXT); rapid(next, PREV_NEXT);
    D.combo = h('select', { class: 'combo', tip: 'Base address for data segment display', onchange: () => { D.sel = +D.combo.value; D.base = bases()[D.sel].addr(); X.updateData(); } });
    X.fillCombo();
    D.ckAddr = U.checkbox('Hexadecimal Addresses', S.addrHex, (v) => M.app.setAddrHex(v), 'If checked, displays all memory addresses in hexadecimal.  Otherwise, decimal.');
    D.ckVal = U.checkbox('Hexadecimal Values', S.valHex, (v) => M.app.setValHex(v), 'If checked, displays all memory and register contents in hexadecimal.  Otherwise, decimal.');
    D.ckAsc = U.checkbox('ASCII', false, (v) => { D.ascii = v; X.updateData(); }, 'Display data segment values in ASCII (overrides Hexadecimal Values setting)');
    const nav = h('div', { id: 'dataNav' }, h('div', { class: 'nbs' }, prev, next), D.combo, D.ckAddr.el, D.ckVal.el, D.ckAsc.el);
    X.data.cnt.append(D.scroll, nav);
    D.base = mem.cfg.dataBase; D.sel = 1; D.combo.value = 1;
    X.buildDataTable();
  };
  X.fillCombo = function () {
    const sel = D.sel; D.combo.textContent = '';
    bases().forEach((b, i) => D.combo.append(h('option', { value: i }, b.label)));
    D.combo.value = sel;
  };
  X.buildDataTable = function () {
    const t = h('table', { class: 'jt' });
    const cg = h('colgroup', null, h('col', { style: 'width:12%' }));
    for (let i = 0; i < VALS; i++) cg.append(h('col'));
    t.append(cg);
    const headRow = h('tr'); D.ths = [];
    for (let i = 0; i <= VALS; i++) { const th = h('th'); D.ths.push(th); headRow.append(th); }
    t.append(h('thead', null, headRow));
    const tb = h('tbody'); D.cells = []; D.addrCells = [];
    for (let r = 0; r < ROWS; r++) {
      const a = h('td', { class: 'r' });
      const tr = h('tr', { class: r % 2 === 0 ? 'even' : 'odd' }, a);
      D.addrCells.push(a);
      const row = [];
      for (let c = 0; c < VALS; c++) {
        const td = h('td', { class: 'r' });
        td.addEventListener('dblclick', () => X.editCell(td, r, c));
        tr.append(td); row.push(td);
      }
      D.cells.push(row); tb.append(tr);
    }
    t.append(tb); D.scroll.append(t);
    X.updateDataHeads();
  };
  X.updateDataHeads = function () {
    const base = S.addrHex ? 16 : 10;
    D.ths[0].textContent = 'Address';
    for (let i = 1; i <= VALS; i++) D.ths[i].textContent = 'Value (+' + ((i - 1) * 4).toString(base) + ')';
  };
  X.dataFit = function () {};
  X.dataMove = function (d) {
    let n = D.base + d;
    if (n < 0) n = 0;
    D.base = n >>> 0; X.updateData();
  };
  X.editCell = function (td, r, c) {
    if (M.app.isRunning()) return;
    const a = (D.base + r * 32 + c * 4) | 0;
    const inp = h('input', { value: td.textContent.trim() });
    td.textContent = ''; td.classList.add('edit'); td.append(inp); inp.select();
    const done = (commit) => {
      td.classList.remove('edit');
      if (commit) {
        try { const v = M.stringToInt(inp.value.trim()); const was = M.backstep.enabled; M.backstep.enabled = false; mem.setWord(a, v); M.backstep.enabled = was; } catch (e) { /* invalid: ignored like Swing */ }
      }
      X.updateData(); M.app.refreshRegs && M.app.refreshRegs();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); });
    inp.addEventListener('blur', () => { if (inp.isConnected) done(false); });
    inp.focus();
  };
  const readCell = (a) => {
    if (mem.isCode(a)) return mem.getWordNoNotify(a);
    return mem.rawWord(a);
  };
  X.updateData = function () {
    let a = D.base | 0;
    for (let r = 0; r < ROWS; r++) {
      D.addrCells[r].textContent = fmtAddr(a);
      for (let c = 0; c < VALS; c++) {
        const v = readCell(a), td = D.cells[r][c];
        const txt = D.ascii ? fmtAscii(v) : fmtVal(v);
        if (td.textContent !== txt) td.textContent = txt;
        td.classList.toggle('hl', D.hlAddr !== null && S.dataHighlight && (D.hlAddr & ~3) === (a & ~3));
        a = (a + 4) | 0;
      }
    }
  };
  X.showAddress = function (addr, highlight) {
    const u = addr >>> 0;
    if (!(u >= D.base && u < D.base + CHUNK)) {
      D.base = u - (u % PREV_NEXT);
      const bs = bases(); let best = -1, bd = Infinity;
      bs.forEach((b, i) => { if (i !== 3 && i !== 4) { const x = b.addr(); if (u >= x && u - x < bd) { bd = u - x; best = i; } } });
      if (best >= 0) { D.sel = best; D.combo.value = best; }
    }
    if (highlight) D.hlAddr = addr;
    X.updateData();
  };
  X.clearDataHighlight = function () { D.hlAddr = null; X.updateData(); };
  X.resetDataView = function () { D.base = mem.cfg.dataBase; D.sel = 1; D.combo.value = 1; X.fillCombo(); D.hlAddr = null; X.updateData(); };

  /* labels ---------------------------------------------------------------------------------------- */
  const L = (X.labelState = { sort: 0 });
  X.buildLabels = function () {
    L.body = h('div', { id: 'labelsBody' });
    L.ckD = U.checkbox('Data', true, () => X.setupLabels(), 'When checked, data segment labels are displayed.');
    L.ckT = U.checkbox('Text', true, () => X.setupLabels(), 'When checked, text segment labels are displayed.');
    X.labels.cnt.append(L.body, h('div', { id: 'labelsCk' }, L.ckD.el, L.ckT.el));
  };
  X.setupLabels = function () {
    L.body.textContent = '';
    if (!M.program) return;
    const tables = [['(global)', M.globalSymbols]];
    for (const p of M.program.programs) tables.push([p.name.split(/[\\/]/).pop(), p.locals]);
    for (const [nm, tab] of tables) {
      let rows = tab.table.filter((s) => (s.isData ? L.ckD.checked : L.ckT.checked));
      if (!rows.length) continue;
      const cmp = [(a, b) => (a.address >>> 0) - (b.address >>> 0), (a, b) => (b.address >>> 0) - (a.address >>> 0),
        (a, b) => (a.name < b.name ? -1 : 1), (a, b) => (a.name > b.name ? -1 : 1)][L.sort];
      rows = rows.slice().sort(cmp);
      const up = '▲', dn = '▼';
      const t = h('table', { class: 'jt' });
      const hl = h('th', { tip: 'Programmer-defined label (identifier).', onclick: () => { L.sort = L.sort === 2 ? 3 : 2; X.setupLabels(); } }, 'Label' + (L.sort === 2 ? '  ' + up : L.sort === 3 ? '  ' + dn : ''));
      const ha = h('th', { tip: 'Text or data segment address at which label is defined.', onclick: () => { L.sort = L.sort === 0 ? 1 : 0; X.setupLabels(); } }, 'Address' + (L.sort === 0 ? '  ' + up : L.sort === 1 ? '  ' + dn : ''));
      t.append(h('thead', null, h('tr', null, hl, ha)));
      const tb = h('tbody');
      rows.forEach((s, i) => {
        const tr = h('tr', { class: i % 2 === 0 ? 'even' : 'odd' }, h('td', null, s.name), h('td', { class: 'r' }, fmtAddr(s.address)));
        tr.addEventListener('click', () => {
          if (s.isData) X.showAddress(s.address, true);
          else { const r = X.byAddr.get(s.address >>> 0); if (r) { X.tscroll.scrollTop = r.tr.offsetTop - 20; X.flashText(r); } }
        });
        tb.append(tr);
      });
      t.append(tb);
      L.body.append(h('div', { class: 'symt' }, h('div', { class: 'nm' }, nm), t));
    }
  };
  X.flashText = function (r) {
    const cs = r.tr.querySelectorAll('td');
    cs.forEach((c) => c.classList.add('hl')); setTimeout(() => cs.forEach((c) => c.classList.remove('hl')), 700);
  };

  /* register panes ---------------------------------------------------------------------------------- */
  const R = (M.regs = {});
  function regTable(page, headers, widths, rowsDef, tips) {
    const sc = h('div', { class: 'tscroll', style: 'overflow-x:hidden;overflow-y:auto' });
    const t = h('table', { class: 'jt' });
    const sum = widths.reduce((x, y) => x + y, 0);
    const cg = h('colgroup');
    widths.forEach((w) => cg.append(h('col', { style: `width:calc((100% - ${sum}px)/${widths.length} + ${w}px)` })));
    t.append(cg, h('thead', null, h('tr', null, headers.map((n) => h('th', null, n)))));
    const tb = h('tbody'); const out = [];
    rowsDef.forEach((d, i) => {
      const cs = d.map((v, k) => h('td', { class: k === 0 ? '' : 'r' }, v));
      const tr = h('tr', { class: i % 2 === 0 ? 'even' : 'odd', tip: tips ? tips[i] : null }, cs);
      tb.append(tr); out.push({ tr, cs });
    });
    t.append(tb); sc.append(t); page.append(sc);
    return { out, sc };
  }
  R.init = function (pages) {
    const defs = CPU.NAMES.map((n, i) => [n, String(i), '']).concat([['pc', '', ''], ['hi', '', ''], ['lo', '', '']]);
    R.cpu = regTable(pages[0], ['Name', 'Number', 'Value'], [25, 25, 60], defs, M.DATA.tips.reg).out;
    const fd = []; for (let i = 0; i < 32; i++) fd.push(['$f' + i, '', '']);
    const fpT = regTable(pages[1], ['Name', 'Float', 'Double'], [20, 70, 130], fd, M.DATA.tips.fp);
    R.fp = fpT.out;
    const flags = h('div', { style: 'flex:none;padding:3px;background:var(--s3)' }, h('div', { style: 'text-align:center;padding:2px' }, 'Condition Flags'));
    const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:1px 4px;justify-items:center' });
    R.flags = [];
    for (let i = 0; i < 8; i++) {
      const c = U.checkbox(String(i), false, (v) => { CPU.flags = v ? CPU.flags | (1 << i) : CPU.flags & ~(1 << i); }, 'Condition flag ' + i);
      R.flags.push(c); grid.append(c.el);
    }
    flags.append(grid); pages[1].append(flags);
    R.c0 = regTable(pages[2], ['Name', 'Number', 'Value'], [50, 25, 60],
      [['$8 (vaddr)', '8', ''], ['$12 (status)', '12', ''], ['$13 (cause)', '13', ''], ['$14 (epc)', '14', '']], M.DATA.tips.c0).out;
    R.update();
  };
  const C0 = [8, 12, 13, 14];
  R.update = function () {
    for (let i = 0; i < 32; i++) R.cpu[i].cs[2].textContent = fmtVal(CPU.regs[i]);
    R.cpu[32].cs[2].textContent = S.addrHex ? hex8(CPU.pc) : String(CPU.pc | 0);
    R.cpu[33].cs[2].textContent = fmtVal(CPU.regs[33]);
    R.cpu[34].cs[2].textContent = fmtVal(CPU.regs[34]);
    for (let i = 0; i < 32; i++) {
      R.fp[i].cs[1].textContent = fmtFloatCell(CPU.fp[i]);
      R.fp[i].cs[2].textContent = i % 2 === 0 ? fmtDoubleCell(CPU.fp[i + 1], CPU.fp[i]) : '';
    }
    for (let i = 0; i < 8; i++) R.flags[i].checked = (CPU.flags >> i) & 1;
    C0.forEach((n, i) => { R.c0[i].cs[2].textContent = fmtVal(CPU.cp0[n] | 0); });
  };
  R.clearHighlight = function () {
    for (const t of [R.cpu, R.fp, R.c0]) for (const r of t) r.tr.classList.remove('rh');
  };
  /* highlight + bring to front, like the observers of RegistersWindow / Coprocessor1Window */
  R.highlight = function () {
    R.clearHighlight();
    if (!S.regHighlight) { return; }
    const hit = (t, i) => { const r = t[i]; if (r) { r.tr.classList.add('rh'); const sc = r.tr.closest('.tscroll'); if (sc && (r.tr.offsetTop < sc.scrollTop + 19 || r.tr.offsetTop + 16 > sc.scrollTop + sc.clientHeight)) sc.scrollTop = r.tr.offsetTop - 19; } };
    if (CPU.lastC0 >= 0) { hit(R.c0, C0.indexOf(CPU.lastC0)); M.app.selectRegTab(2); }
    if (CPU.lastFp >= 0) { hit(R.fp, CPU.lastFp & ~1); hit(R.fp, CPU.lastFp); M.app.selectRegTab(1); }
    if (CPU.lastReg >= 0) { hit(R.cpu, CPU.lastReg <= 31 ? CPU.lastReg : CPU.lastReg === 33 ? 33 : 34); M.app.selectRegTab(0); }
  };
  X.fmtAddr = fmtAddr;
})();
