/* MARS web - Tools menu. Implemented: Bitmap Display, Keyboard and Display MMIO Simulator,
   Instruction Counter, Instruction Statistics, Floating Point Representation,
   Memory Reference Visualization, Data Cache Simulator, Introduction to Tools.
   tools2.js and xray.js add the remaining ones. */
(function () {
  const M = globalThis.MARS, U = M.ui, h = U.h, mem = M.mem, sim = M.sim, CPU = M.cpu;
  const T = (M.tools = { open: null, active: new Set() });
  T.notify = (ev) => { for (const t of T.active) if (t.connected && t.onReset) t.onReset(); };

  /* frame shared by every tool (AbstractMarsToolAndApplication) ------------------------- */
  function tool(title, heading, body, opts) {
    const t = Object.assign({ connected: false, onReset: null, attach() {}, detach() {} }, opts || {});
    const conn = h('button', { class: 'btn', tip: 'Control whether tool will respond to running MIPS program' }, 'Connect to MIPS');
    conn.addEventListener('click', () => {
      t.connected = !t.connected;
      conn.textContent = t.connected ? 'Disconnect from MIPS' : 'Connect to MIPS';
      if (t.connected) t.attach(); else t.detach();
    });
    const content = h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, h('div', { class: 'toolhd' }, heading), body,
      h('div', { style: 'display:flex;gap:8px;justify-content:center;padding-top:4px' }, conn,
        h('button', { class: 'btn', tip: 'Reset all counters and other structures', onclick: () => t.onReset && t.onReset() }, 'Reset'),
        t.help ? h('button', { class: 'btn', onclick: () => U.message(title, t.help, 'info') }, 'Help') : null,
        h('button', { class: 'btn', tip: 'Close (exit) this tool', onclick: () => t.dlg.close() }, 'Close')));
    t.dlg = U.dialog(title, content, null, { modal: false, noEnter: true, onClose: () => { if (t.connected) t.detach(); t.connected = false; T.active.delete(t); } });
    T.active.add(t);
    return t;
  }

  /* memory observer helper ---------------------------------------------------------------- */
  const addObs = (f) => mem.observers.push(f);
  const delObs = (f) => { const i = mem.observers.indexOf(f); if (i >= 0) mem.observers.splice(i, 1); };
  const addInst = (f) => sim.instrObservers.push(f);
  const delInst = (f) => { const i = sim.instrObservers.indexOf(f); if (i >= 0) sim.instrObservers.splice(i, 1); };
  const sel = (vals, def, on) => { const s = h('select', { class: 'combo' }, vals.map((v) => h('option', { selected: String(v) === String(def) }, String(v)))); s.addEventListener('change', () => on && on(s.value)); return s; };

  /* Bitmap Display ------------------------------------------------------------------------- */
  function bitmap() {
    const st = { uw: 1, uh: 1, dw: 512, dh: 256, base: mem.cfg.dataBase };
    const cv = h('canvas', { class: 'bmp' }); const g = cv.getContext('2d');
    const cols = () => st.dw / st.uw | 0, rows = () => st.dh / st.uh | 0;
    let img;
    const size = () => { cv.width = cols(); cv.height = rows(); cv.style.width = st.dw + 'px'; cv.style.height = st.dh + 'px'; img = g.createImageData(cols(), rows()); redraw(); };
    const put = (i, v) => { const d = img.data; d[i * 4] = (v >>> 16) & 255; d[i * 4 + 1] = (v >>> 8) & 255; d[i * 4 + 2] = v & 255; d[i * 4 + 3] = 255; };
    const redraw = () => { const n = cols() * rows(); for (let i = 0; i < n; i++) put(i, mem.rawWord((st.base + i * 4) | 0)); g.putImageData(img, 0, 0); };
    let dirty = false, raf = 0;
    const paint = () => { raf = 0; if (dirty) { dirty = false; g.putImageData(img, 0, 0); } };
    const obs = (rw, a, len) => {
      if (rw !== 'w') return;
      const off = (a >>> 0) - (st.base >>> 0);
      if (off < 0 || off >= cols() * rows() * 4) return;
      put(off >> 2, mem.rawWord(a & ~3)); dirty = true;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const bases = [['0x10000000 (global data)', mem.cfg.dataSegBase], ['0x10008000 ($gp)', mem.cfg.gp], ['0x10010000 (static data)', mem.cfg.dataBase], ['0x10040000 (heap)', mem.cfg.heapBase], ['0xffff0000 (memory map)', mem.cfg.mmioBase]];
    const pixel = [1, 2, 4, 8, 16, 32], disp = [64, 128, 256, 512, 1024, 2048];
    const form = h('div', { class: 'toolrow', style: 'max-width:420px' },
      'Unit Width in Pixels', sel(pixel, 1, (v) => { st.uw = +v; size(); }), 'Unit Height in Pixels', sel(pixel, 1, (v) => { st.uh = +v; size(); }),
      'Display Width in Pixels', sel(disp, 512, (v) => { st.dw = +v; size(); }), 'Display Height in Pixels', sel(disp, 256, (v) => { st.dh = +v; size(); }),
      'Base address for display', sel(bases.map((b) => b[0]), bases[2][0], (v) => { st.base = bases.find((b) => b[0] === v)[1]; redraw(); }));
    size();
    tool('Bitmap Display, Version 1.0', 'Bitmap Display', h('div', { style: 'display:flex;flex-direction:column;gap:8px;align-items:center' }, form, cv), {
      attach() { addObs(obs); redraw(); }, detach() { delObs(obs); }, onReset: redraw,
    });
  }

  /* Keyboard and Display MMIO --------------------------------------------------------------- */
  function keyboard() {
    const RC = mem.cfg.mmioBase | 0, RD = (RC + 4) | 0, TC = (RC + 8) | 0, TD = (RC + 12) | 0;
    const disp = h('textarea', { class: 'ta', rows: 12, cols: 62, readonly: true });
    const kb = h('textarea', { class: 'ta', rows: 5, cols: 62 });
    const delay = h('input', { class: 'tf', type: 'number', value: 5, min: 1, style: 'width:60px' });
    let queue = [], countdown = 0, pendingChar = null;
    const setRaw = (a, v) => mem.rawSetWord(a, v);
    const reset = () => { queue = []; countdown = 0; pendingChar = null; setRaw(RC, 0); setRaw(TC, 1); setRaw(RD, 0); setRaw(TD, 0); };
    const deliver = () => {
      if (queue.length && (mem.rawWord(RC) & 1) === 0) {
        setRaw(RD, queue.shift()); setRaw(RC, mem.rawWord(RC) | 1);
        if (mem.rawWord(RC) & 2) sim.extInterrupt = 0x40;
      }
    };
    kb.addEventListener('keypress', (e) => { const c = e.key === 'Enter' ? 10 : e.key.length === 1 ? e.key.charCodeAt(0) : 0; if (c) { queue.push(c); deliver(); } });
    const inst = () => {
      if (countdown > 0 && --countdown === 0) {
        if (pendingChar !== null) {
          if (pendingChar === 12) disp.value = ''; else disp.value += String.fromCharCode(pendingChar);
          disp.scrollTop = disp.scrollHeight; pendingChar = null;
        }
        setRaw(TC, mem.rawWord(TC) | 1);
        if (mem.rawWord(TC) & 2) sim.extInterrupt = 0x80;
      }
      deliver();
    };
    const write = (a, v) => {
      if (a === TD) { pendingChar = v & 255; countdown = Math.max(1, +delay.value || 1); setRaw(TC, mem.rawWord(TC) & ~1); }
    };
    const read = (a) => { if (a === RD) setRaw(RC, mem.rawWord(RC) & ~1); };
    const body = h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
      h('div', { style: 'color:#333' }, 'Display'), disp,
      h('div', { style: 'display:flex;gap:8px;align-items:center' }, 'Delay Length (instruction count)', delay, h('button', { class: 'btn', onclick: () => { disp.value = ''; } }, 'Clear')),
      h('div', { style: 'color:#333' }, 'Keyboard'), kb);
    tool('Keyboard and Display MMIO Simulator, Version 1.4', 'Keyboard and Display MMIO Simulator', body, {
      attach() { reset(); mem.mmioWrite = write; mem.mmioRead = read; addInst(inst); },
      detach() { mem.mmioWrite = null; mem.mmioRead = null; delInst(inst); },
      onReset() { disp.value = ''; kb.value = ''; reset(); },
    });
  }

  /* Instruction Counter ------------------------------------------------------------------------- */
  function counter() {
    const c = { total: 0, R: 0, I: 0, J: 0 };
    const f = {}; const row = (k, lbl) => { f[k] = { n: h('input', { class: 'tf', readonly: true, style: 'width:90px;text-align:right', value: 0 }), b: h('div', { class: 'bar', style: 'width:130px' }, h('i'), h('b', null, '0%')) }; return [lbl, f[k].n, k === 'total' ? h('span') : f[k].b]; };
    const grid = h('div', { style: 'display:grid;grid-template-columns:auto auto auto;gap:4px 10px;align-items:center' }, row('total', 'Instructions so far:'), row('R', 'R-type:'), row('I', 'I-type:'), row('J', 'J-type:'));
    let last = 0;
    const show = () => { for (const k of ['total', 'R', 'I', 'J']) { f[k].n.value = c[k]; if (k !== 'total') { const p = c.total ? (c[k] * 100) / c.total : 0; f[k].b.firstChild.style.width = p + '%'; f[k].b.lastChild.textContent = Math.round(p) + '%'; } } };
    const obs = (st) => { c.total++; const fm = st.inst.format; if (fm === 'R_FORMAT') c.R++; else if (fm === 'J_FORMAT') c.J++; else c.I++; const n = performance.now(); if (n - last > 100) { last = n; show(); } };
    const stop = () => show();
    tool('Instruction Counter, Version 1.0 (Felipe Lessa)', 'Instruction Counter', grid, {
      attach() { addInst(obs); sim.stopObservers.push(stop); }, detach() { delInst(obs); sim.stopObservers.splice(sim.stopObservers.indexOf(stop), 1); },
      onReset() { c.total = c.R = c.I = c.J = 0; show(); },
    });
  }

  /* Instruction Statistics ------------------------------------------------------------------------ */
  function stats() {
    const CATS = ['ALU', 'Jump', 'Branch', 'Memory', 'Other'];
    const n = [0, 0, 0, 0, 0]; let total = 0, last = 0;
    const f = CATS.map(() => ({ n: h('input', { class: 'tf', readonly: true, style: 'width:90px;text-align:right', value: 0 }), b: h('div', { class: 'bar', style: 'width:150px' }, h('i'), h('b', null, '0%')) }));
    const tot = h('input', { class: 'tf', readonly: true, style: 'width:90px;text-align:right', value: 0 });
    const grid = h('div', { style: 'display:grid;grid-template-columns:auto auto auto;gap:4px 10px;align-items:center' }, 'Total:', tot, h('span'), CATS.flatMap((c, i) => [c + ':', f[i].n, f[i].b]));
    const show = () => { tot.value = total; f.forEach((x, i) => { const p = total ? (n[i] * 100) / total : 0; x.n.value = n[i]; x.b.firstChild.style.width = p + '%'; x.b.lastChild.textContent = Math.round(p) + '%'; }); };
    const cat = (name) => {
      if (/^(j|jr|jal|jalr)$/.test(name)) return 1;
      if (/^(beq|bne|bgez|bgezal|bgtz|blez|bltz|bltzal|bc1t|bc1f)$/.test(name)) return 2;
      if (/^(lw|lh|lhu|lb|lbu|lwl|lwr|ll|sw|sh|sb|swl|swr|sc|lwc1|ldc1|swc1|sdc1)$/.test(name)) return 3;
      if (/^(add|addu|addi|addiu|sub|subu|and|andi|or|ori|xor|xori|nor|sll|sllv|srl|srlv|sra|srav|slt|sltu|slti|sltiu|mult|multu|mul|div|divu|madd|maddu|msub|msubu|lui)$/.test(name) || /\.[sd]$/.test(name)) return 0;
      return 4;
    };
    const obs = (st) => { total++; n[cat(st.inst.name)]++; const t = performance.now(); if (t - last > 100) { last = t; show(); } };
    const stop = () => show();
    tool('Instruction Statistics, Version 1.0 (Ingo Kofler)', 'Instruction Statistics', grid, {
      attach() { addInst(obs); sim.stopObservers.push(stop); }, detach() { delInst(obs); sim.stopObservers.splice(sim.stopObservers.indexOf(stop), 1); },
      onReset() { total = 0; n.fill(0); show(); },
    });
  }

  /* Floating Point Representation -------------------------------------------------------------------- */
  function floatRep() {
    const hexI = h('input', { class: 'tf', style: 'width:110px;font-family:var(--mono)' }), decI = h('input', { class: 'tf', style: 'width:200px;font-family:var(--mono)' }), binI = h('input', { class: 'tf', style: 'width:300px;font-family:var(--mono)' });
    const expn = h('span', { style: 'font:12px var(--mono);color:#000' });
    let bits = 0;
    const show = (from) => {
      if (from !== 'h') hexI.value = M.hex8(bits);
      if (from !== 'd') decI.value = M.javaFloat(M.intBitsToFloat(bits));
      const b = (bits >>> 0).toString(2).padStart(32, '0');
      if (from !== 'b') binI.value = b[0] + ' ' + b.slice(1, 9) + ' ' + b.slice(9);
      const s = b[0] === '1' ? '-1' : '+1', e = parseInt(b.slice(1, 9), 2), m = parseInt(b.slice(9), 2);
      expn.textContent = `(${s}) * 2^(${e} - 127) * ${e === 0 ? '0' : '1'}.${b.slice(9).replace(/0+$/, '') || '0'}₂`;
    };
    hexI.addEventListener('input', () => { try { let v = hexI.value.trim(); if (!v.startsWith('0x')) v = '0x' + v; bits = M.stringToInt(v); show('h'); } catch (e) { /* ignore */ } });
    decI.addEventListener('input', () => { try { bits = M.floatToIntBits(Math.fround(M.parseDouble(decI.value))); show('d'); } catch (e) { /* ignore */ } });
    binI.addEventListener('input', () => { const t = binI.value.replace(/\s/g, ''); if (/^[01]{1,32}$/.test(t)) { bits = parseInt(t.padEnd(32, '0'), 2) | 0; show('b'); } });
    const regSel = h('select', { class: 'combo' }, h('option', null, 'None'), Array.from({ length: 32 }, (_, i) => h('option', null, '$f' + i)));
    const regOf = () => (regSel.value === 'None' ? -1 : +regSel.value.slice(2));
    const obs = () => { const r = regOf(); if (r >= 0 && CPU.fp[r] !== bits) { bits = CPU.fp[r]; show(''); } };
    regSel.addEventListener('change', obs);
    show('');
    tool('Floating Point Representation, Version 1.1', 'Floating Point Representation', h('div', { class: 'field', style: 'grid-template-columns:auto auto' }, 'Hexadecimal', hexI, 'Binary (sign exponent fraction)', binI, 'Decimal', decI, 'Expansion', expn, 'MIPS register', regSel), {
      attach() { addInst(obs); }, detach() { delInst(obs); }, onReset() { bits = 0; show(''); },
    });
  }

  /* Memory Reference Visualization ---------------------------------------------------------------------- */
  function memRef() {
    const st = { unit: 1, bw: 8, bh: 8, dw: 64, dh: 256, words: 1, base: mem.cfg.dataBase };
    const counts = new Map();
    const cv = h('canvas', { class: 'bmp' }), g = cv.getContext('2d');
    const size = () => { cv.width = st.dw * 4; cv.height = st.dh * 4; cv.style.width = st.dw * 4 + 'px'; cv.style.height = st.dh * 4 + 'px'; draw(); };
    const color = (n) => { if (n === 0) return '#000'; const t = Math.min(1, Math.log2(n + 1) / 8); return `rgb(${Math.round(255 * Math.min(1, t * 2))},${Math.round(255 * Math.max(0, Math.min(1, 2 - t * 2)) * (t < 0.5 ? t * 2 : 1))},${Math.round(255 * Math.max(0, 1 - t * 2))})`; };
    const cols = () => (st.dw / st.bw) * 1 | 0;
    const cell = (i, n) => { const px = st.bw * 4, c = cols(), x = (i % c) * px, y = Math.floor(i / c) * (st.bh * 4); g.fillStyle = color(n); g.fillRect(x, y, px, st.bh * 4); g.strokeStyle = '#333'; g.strokeRect(x + 0.5, y + 0.5, px - 1, st.bh * 4 - 1); };
    const total = () => cols() * Math.floor(st.dh / st.bh);
    const draw = () => { const n = total(); for (let i = 0; i < n; i++) cell(i, counts.get(i) || 0); };
    const obs = (rw, a) => {
      const off = (a >>> 0) - (st.base >>> 0);
      if (off < 0) return;
      const i = Math.floor(off / (4 * st.words));
      if (i >= total()) return;
      const n = (counts.get(i) || 0) + 1; counts.set(i, n); cell(i, n);
    };
    const form = h('div', { class: 'toolrow', style: 'max-width:440px' },
      'Unit Width', sel([2, 4, 8, 16, 32], 8, (v) => { st.bw = +v; size(); }), 'Unit Height', sel([2, 4, 8, 16, 32], 8, (v) => { st.bh = +v; size(); }),
      'Words per Unit', sel([1, 2, 4, 8, 16], 1, (v) => { st.words = +v; counts.clear(); draw(); }),
      'Base address', sel(['.data', '$gp', 'heap', '.text'], '.data', (v) => { st.base = { '.data': mem.cfg.dataBase, '$gp': mem.cfg.gp, heap: mem.cfg.heapBase, '.text': mem.cfg.textBase }[v]; counts.clear(); draw(); }));
    size();
    tool('Memory Reference Visualization, Version 1.0', 'Memory Reference Visualization', h('div', { style: 'display:flex;flex-direction:column;gap:8px;align-items:center' }, form, cv), {
      attach() { addObs(obs); }, detach() { delObs(obs); }, onReset() { counts.clear(); draw(); },
    });
  }

  /* Data Cache Simulator ----------------------------------------------------------------------------------- */
  function cache() {
    const cfg = { policy: 'Direct Mapping', repl: 'LRU', blocks: 8, words: 4, sets: 1 };
    let table, acc = 0, hit = 0, miss = 0, tick = 0, last = 0;
    const build = () => {
      const assoc = cfg.policy === 'Direct Mapping' ? 1 : cfg.policy === 'Fully Associative' ? cfg.blocks : cfg.sets;
      const sets = cfg.blocks / assoc;
      table = { assoc, sets, s: Array.from({ length: sets }, () => []) };
      acc = hit = miss = 0;
    };
    const out = {};
    const num = (k, l) => { out[k] = h('input', { class: 'tf', readonly: true, style: 'width:90px;text-align:right', value: 0 }); return [l, out[k]]; };
    const bar = h('div', { class: 'bar', style: 'width:200px' }, h('i'), h('b', null, '0%'));
    const show = () => { out.a.value = acc; out.h.value = hit; out.m.value = miss; const p = acc ? (hit * 100) / acc : 0; out.r.value = p.toFixed(0) + '%'; bar.firstChild.style.width = p + '%'; bar.lastChild.textContent = p.toFixed(0) + '%'; };
    const obs = (rw, a) => {
      if (mem.isCode(a)) return;
      const blk = Math.floor((a >>> 0) / (cfg.words * 4)), si = blk % table.sets, set = table.s[si];
      acc++; tick++;
      const e = set.find((x) => x.tag === blk);
      if (e) { hit++; e.t = tick; } else {
        miss++;
        if (set.length < table.assoc) set.push({ tag: blk, t: tick, born: tick });
        else {
          let i = 0;
          if (cfg.repl === 'Random') i = Math.floor(Math.random() * set.length);
          else if (cfg.repl === 'FIFO') set.forEach((x, k) => { if (x.born < set[i].born) i = k; });
          else set.forEach((x, k) => { if (x.t < set[i].t) i = k; });
          set[i] = { tag: blk, t: tick, born: tick };
        }
      }
      const n = performance.now(); if (n - last > 100) { last = n; show(); }
    };
    const pow = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048];
    const form = h('div', { class: 'toolrow', style: 'max-width:440px' },
      'Placement Policy', sel(['Direct Mapping', 'Fully Associative', 'N-way Set Associative'], cfg.policy, (v) => { cfg.policy = v; build(); show(); }),
      'Block Replacement Policy', sel(['LRU', 'Random', 'FIFO'], 'LRU', (v) => { cfg.repl = v; }),
      'Set size (blocks)', sel(pow.slice(0, 8), 1, (v) => { cfg.sets = +v; build(); show(); }),
      'Number of blocks', sel(pow, 8, (v) => { cfg.blocks = +v; build(); show(); }),
      'Cache block size (words)', sel(pow, 4, (v) => { cfg.words = +v; build(); show(); }));
    const res = h('div', { class: 'toolrow', style: 'max-width:440px' }, num('a', 'Memory Access Count'), num('h', 'Cache Hit Count'), num('m', 'Cache Miss Count'), num('r', 'Cache Hit Rate'), h('span'), bar);
    build();
    const stop = () => show();
    tool('Data Cache Simulation Tool, Version 1.2', 'Simulate and illustrate data cache performance', h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('div', { class: 'tbord' }, h('span', { class: 'lg' }, 'Cache Organization'), form), h('div', { class: 'tbord' }, h('span', { class: 'lg' }, 'Cache Performance'), res)), {
      attach() { addObs(obs); sim.stopObservers.push(stop); }, detach() { delObs(obs); sim.stopObservers.splice(sim.stopObservers.indexOf(stop), 1); },
      onReset() { build(); show(); },
    });
  }

  const intro = () => U.message('Introduction to Tools',
    'MARS Tools are small applications that run alongside the simulator.\nClick "Connect to MIPS" in a tool, then run your program: the tool observes\nmemory and register activity as the program executes.', 'info');
  const MAP = { 'Bitmap Display': bitmap, 'Keyboard and Display MMIO Simulator': keyboard, 'Instruction Counter': counter, 'Instruction Statistics': stats,
    'Floating Point Representation': floatRep, 'Memory Reference Visualization': memRef, 'Data Cache Simulator': cache, 'Introduction to Tools': intro };
  Object.assign(T, { MAP, frame: tool, addObs, delObs, addInst, delInst, sel });
  T.open = (name) => {
    if (MAP[name]) MAP[name]();
    else U.message(name, name + ' is not available in this web version of MARS.', 'info');
  };
})();
