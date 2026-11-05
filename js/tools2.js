/* MARS web - BHT Simulator, Digital Lab Sim, Mars Bot, ScavengerHunt, Screen Magnifier.
   Ports of the corresponding classes in mars.tools. */
(function () {
  const M = globalThis.MARS, U = M.ui, h = U.h, mem = M.mem, sim = M.sim, CPU = M.cpu, T = M.tools;
  const { frame, addObs, delObs, addInst, delInst, sel } = T;
  const hex = (a) => (a >>> 0).toString(16);
  const delPre = (f) => { const i = sim.preObservers.indexOf(f); if (i >= 0) sim.preObservers.splice(i, 1); };

  /* BHT Simulator ------------------------------------------------------------------------- */
  class BHTEntry {
    constructor(size, init) { this.pred = init; this.hist = new Array(size).fill(init); this.ok = 0; this.bad = 0; }
    update(taken) {
      this.hist.shift(); this.hist.push(taken);
      if (taken === this.pred) this.ok++;
      else { this.bad++; if (this.hist.every((x) => x === taken)) this.pred = !this.pred; }
    }
    get precision() { const s = this.ok + this.bad; return s === 0 ? 0 : (this.ok * 100) / s; }
  }
  /* Branch decoding follows the MIPS encoding (rt field selects bltz/bgez/...). */
  function branchInfo(b) {
    const op = b >>> 26, rtf = (b >>> 16) & 31;
    if (op === 1) return rtf === 0 || rtf === 1 || rtf === 0x10 || rtf === 0x11;
    return op >= 4 && op <= 7;
  }
  function willBranch(b) {
    const op = b >>> 26, rs = (b >>> 21) & 31, rt = (b >>> 16) & 31, A = CPU.regs[rs], B = CPU.regs[rt];
    if (op === 1) return rt === 0 || rt === 0x10 ? A < 0 : A >= 0;
    if (op === 4) return A === B;
    if (op === 5) return A !== B;
    if (op === 6) return A <= 0;
    return A > 0;
  }
  function bht() {
    let entries = [], pending = null, lastTaken = false, selRow = -1, selColor = '', log = '', raf = 0;
    const cSize = sel([8, 16, 32], 16, reset), cHist = sel([1, 2], 1, reset), cInit = sel(['NOT TAKE', 'TAKE'], 'NOT TAKE', reset);
    const ti = (w) => h('input', { class: 'tf', readonly: true, style: `width:${w}px;text-align:center` });
    const fI = ti(110), fA = ti(110), fX = ti(110);
    const tb = h('tbody');
    const table = h('table', { class: 'jt', style: 'font:12px var(--dialog)' }, h('thead', null, h('tr', null, ['Index', 'History', 'Prediction', 'Correct', 'Incorrect', 'Precision'].map((n) => h('th', null, n)))), tb);
    const logT = h('textarea', { class: 'ta', rows: 6, readonly: true, style: 'width:100%' });
    function reset() {
      const n = +cSize.value, hs = +cHist.value, init = cInit.value === 'TAKE';
      entries = Array.from({ length: n }, () => new BHTEntry(hs, init));
      pending = null; lastTaken = false; selRow = -1; log = '';
      fI.value = fA.value = fX.value = '';
      draw();
    }
    function draw() {
      raf = 0; tb.textContent = '';
      entries.forEach((e, i) => {
        const tr = h('tr', { class: i % 2 ? 'odd' : 'even' }, [i, e.hist.map((x) => (x ? 'T' : 'NT')).join(', '), e.pred ? 'TAKE' : 'NOT TAKE', e.ok, e.bad, e.precision.toFixed(2)].map((v) => h('td', { class: 'c' }, String(v))));
        if (i === selRow) tr.querySelectorAll('td').forEach((c) => { c.style.background = selColor; });
        tb.append(tr);
      });
      if (log.length > 200000) log = log.slice(-200000);
      logT.value = log; logT.scrollTop = logT.scrollHeight;
    }
    const later = () => { if (!raf) raf = requestAnimationFrame(draw); };
    const idxOf = (a) => (a >>> 2) % entries.length;
    const onFetch = (st, pc) => {
      const bin = st.binary;
      let clear = true;
      if (pending !== null) {
        const i = idxOf(pending), e = entries[i], good = e.pred === lastTaken;
        selRow = i; selColor = good ? '#00ff00' : '#ff0000';
        log += 'branch ' + (lastTaken ? 'taken' : 'not taken') + ', prediction was ' + (good ? 'correct' : 'incorrect') + '\n\n';
        e.update(lastTaken);
        clear = false; pending = null;
      }
      if (branchInfo(bin)) {
        const i = idxOf(pc), txt = st.basicText || M.formatBasic(st), off = (bin << 16) >> 16;
        fI.value = txt; fA.value = '0x' + hex(pc); fX.value = i;
        selRow = i; selColor = '#ffff00';
        log += 'instruction ' + txt + ' at address 0x' + hex(pc) + ', maps to index ' + i + '\n';
        log += 'branches to address 0x' + hex((pc + (off << 2) + 4) | 0) + '\n';
        log += 'prediction is: ' + (entries[i].pred ? 'take' : 'do not take') + '...\n';
        lastTaken = willBranch(bin); pending = pc; clear = false;
      }
      if (clear) { fI.value = fA.value = fX.value = ''; selRow = -1; }
      later();
    };
    const stop = () => draw();
    const body = h('div', { style: 'display:flex;flex-direction:column;gap:8px;width:640px' },
      h('div', { style: 'display:flex;gap:8px;align-items:center;justify-content:center' }, '# of BHT entries', cSize, 'BHT history size', cHist, 'Initial value', cInit),
      h('div', { style: 'display:flex;gap:10px' },
        h('div', { style: 'display:flex;flex-direction:column;gap:4px;text-align:center' }, 'Instruction', fI, '@ Address', fA, '-> Index', fX),
        h('div', { class: 'tscroll', style: 'flex:1;height:230px' }, table)),
      h('div', null, 'Log'), logT);
    reset();
    frame('BHT Simulator, Version 1.0 (Ingo Kofler)', 'Branch History Table Simulator', body, {
      attach() { sim.preObservers.push(onFetch); sim.stopObservers.push(stop); },
      detach() { delPre(onFetch); sim.stopObservers.splice(sim.stopObservers.indexOf(stop), 1); },
      onReset: reset,
    });
  }

  /* Digital Lab Sim ------------------------------------------------------------------------- */
  function digital() {
    const base = mem.cfg.mmioBase | 0, D1 = base + 0x10, D2 = base + 0x11, KB = base + 0x12, CNT = base + 0x13, OUT = base + 0x14;
    const seg = [h('canvas', { width: 60, height: 80, style: 'width:60px;height:80px' }), h('canvas', { width: 60, height: 80, style: 'width:60px;height:80px' })];
    const val = [0, 0];
    const poly = (g, p) => { g.beginPath(); p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
    const SEG = {
      a: (g) => { poly(g, [[12, 5], [9, 8], [12, 11]]); poly(g, [[36, 5], [39, 8], [36, 11]]); g.fillRect(12, 5, 24, 6); },
      b: (g) => { poly(g, [[37, 12], [40, 9], [43, 12]]); poly(g, [[37, 36], [40, 39], [43, 36]]); g.fillRect(37, 12, 6, 24); },
      c: (g) => { poly(g, [[37, 44], [40, 41], [43, 44]]); poly(g, [[37, 68], [40, 71], [43, 68]]); g.fillRect(37, 44, 6, 24); },
      d: (g) => { poly(g, [[12, 69], [9, 72], [12, 75]]); poly(g, [[36, 69], [39, 72], [36, 75]]); g.fillRect(12, 69, 24, 6); },
      e: (g) => { poly(g, [[5, 44], [8, 41], [11, 44]]); poly(g, [[5, 68], [8, 71], [11, 68]]); g.fillRect(5, 44, 6, 24); },
      f: (g) => { poly(g, [[5, 12], [8, 9], [11, 12]]); poly(g, [[5, 36], [8, 39], [11, 36]]); g.fillRect(5, 12, 6, 24); },
      g: (g) => { poly(g, [[12, 37], [9, 40], [12, 43]]); poly(g, [[36, 37], [39, 40], [36, 43]]); g.fillRect(12, 37, 24, 6); },
      h: (g) => { g.beginPath(); g.arc(53, 72, 4, 0, 7); g.fill(); },
    };
    const paint = (n) => {
      const g = seg[n].getContext('2d'); g.clearRect(0, 0, 60, 80);
      'abcdefgh'.split('').forEach((c, i) => { g.fillStyle = (val[n] >> i) & 1 ? '#ff0000' : '#c0c0c0'; SEG[c](g); });
    };
    const setSeg = (n, v) => { val[n] = v & 0xff; paint(n); };
    let key = -1, kbInt = false, cntOn = false, cnt = 30;
    const buttons = [];
    const canInt = () => (CPU.cp0[12] & 2) === 0;
    const keys = h('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:0' });
    for (let i = 0; i < 16; i++) {
      const b = h('button', { class: 'btn', style: 'background:#fff;padding:0;height:40px;width:44px' }, i.toString(16));
      b.addEventListener('click', () => {
        if (key !== -1) { key = -1; mem.rawSetByte(OUT, 0); buttons.forEach((x) => { x.style.background = '#fff'; }); }
        else { key = i; b.style.background = '#00ff00'; if (kbInt && canInt()) sim.extInterrupt = 0x200; }
        if (!sim.running) M.exec.updateData();
      });
      buttons.push(b); keys.append(b);
    }
    const obs = (rw, a, len, v) => {
      if (rw !== 'w') return;
      if (a === D1) setSeg(1, v); else if (a === D2) setSeg(0, v);
      else if (a === KB) {
        const row = v & 0xff;
        mem.rawSetByte(OUT, key !== -1 && (1 << (key >> 2)) === (row & 15) ? (1 << (key >> 2)) | (1 << (4 + (key & 3))) : 0);
        kbInt = (row & 0xf0) !== 0;
      } else if (a === CNT) { if (v & 0xffff) { cntOn = true; cnt = 30; } else cntOn = false; }
    };
    const inst = () => {
      if (cntOn) { if (cnt > 0) cnt--; else { cnt = 30; if (canInt()) sim.extInterrupt = 0x100; } }
    };
    const reset = () => { setSeg(0, 0); setSeg(1, 0); key = -1; buttons.forEach((x) => { x.style.background = '#fff'; }); cntOn = false; cnt = 30; };
    reset();
    frame('Digital Lab Sim,  Version 1.0 (Didier Teifreto)', 'Digital Lab Sim', h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;align-items:center;justify-items:center;gap:12px' },
      h('div', { style: 'display:flex;gap:6px' }, seg), keys), {
      attach() { addObs(obs); addInst(inst); }, detach() { delObs(obs); delInst(inst); }, onReset: reset,
      help: 'This tool is composed of 3 parts : two seven-segment displays, an hexadecimal keyboard and counter\n\nSeven segment display\n Byte value at address 0xFFFF0010 : command right seven segment display\n Byte value at address 0xFFFF0011 : command left seven segment display\n Each bit of these two bytes are connected to segments (bit 0 for a segment, 1 for b segment and 7 for point)\n\nHexadecimal keyboard\n Byte value at address 0xFFFF0012 : command row number of hexadecimal keyboard (bit 0 to 3) and enable keyboard interrupt (bit 7)\n Byte value at address 0xFFFF0014 : receive row and column of the key pressed, 0 if not key pressed\n The MIPS program has to scan, one by one, each row (send 1,2,4,8...) and then observe if a key is pressed.\n This byte value is composed of row number (4 left bits) and column number (4 right bits).\n If keyboard interruption is enable, an exception is started, with cause register bit number 11 set.\n\nCounter\n Byte value at address 0xFFFF0013 : If one bit of this byte is set, the counter interruption is enable.\n If counter interruption is enable, every 30 instructions, an exception is started with cause register bit number 10.\n   (contributed by Didier Teifreto, dteifreto@lifc.univ-fcomte.fr)',
    });
  }

  /* Mars Bot --------------------------------------------------------------------------------- */
  function bot() {
    const W = 512, HEADING = 0xffff8010 | 0, TRACK = 0xffff8020 | 0, X = 0xffff8030 | 0, Y = 0xffff8040 | 0, MOVE = 0xffff8050 | 0;
    const cv = h('canvas', { width: W, height: W, style: 'display:block' }), g = cv.getContext('2d');
    const s = { heading: 0, leave: false, x: 0, y: 0, moving: false, track: [], idx: 0 };
    const draw = () => {
      g.fillStyle = '#c0c0c0'; g.fillRect(0, 0, W, W);
      g.strokeStyle = '#0000ff'; g.beginPath();
      for (let i = 1; i <= s.idx; i += 2) {
        const a = s.track[i - 1], b = s.track[i];
        if (a && b) { g.moveTo(a[0] + 0.5, a[1] + 0.5); g.lineTo(b[0] + 0.5, b[1] + 0.5); }
      }
      g.stroke();
      g.fillStyle = '#000'; g.fillRect(Math.trunc(s.x), Math.trunc(s.y), 20, 20);
    };
    const pt = () => [Math.trunc(s.x), Math.trunc(s.y)];
    const obs = (rw, a, len, v) => {
      if (rw !== 'w') return;
      if (a === HEADING) s.heading = v;
      else if (a === TRACK) {
        if (!s.leave && v === 1) { s.leave = true; s.track[s.idx] = pt(); s.idx++; }
        else if (s.leave && v === 0) { s.leave = false; s.track[s.idx] = pt(); s.idx++; }
      } else if (a === MOVE) s.moving = v !== 0;
    };
    const tick = () => {
      if (s.moving) {
        const ang = (((360 - s.heading) + 90) % 360) * Math.PI / 180;
        s.x += Math.cos(ang); s.y += -Math.sin(ang);
        mem.rawSetWord(X, Math.trunc(s.x)); mem.rawSetWord(Y, Math.trunc(s.y));
        s.track[s.idx] = pt();
      }
      draw();
    };
    const timer = setInterval(tick, 40);
    addObs(obs); draw();
    const dlg = U.dialog(' This is the MarsBot', h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, cv), [
      { label: 'Clear', fn: () => { Object.assign(s, { leave: false, x: 0, y: 0, moving: false, track: [], idx: 0 }); draw(); return true; } },
      { label: 'Close' }], { modal: false, noEnter: true, onClose: () => { clearInterval(timer); delObs(obs); } });
    return dlg;
  }

  /* ScavengerHunt ------------------------------------------------------------------------------- */
  function hunt() {
    const W = 712, H = 652, NP = 22, NL = 7, TASK = 20, ENERGY = 20, START = 255, ADMIN = 999;
    const AUTH = 0xffffe000 | 0, PID = 0xffffe004 | 0, GAME = 0xffffe008 | 0, TURNS = 0xffffe00c | 0, BASE = 0xffff8000 | 0, PER = 0x400;
    const O = { X: 0, Y: 4, TOX: 8, TOY: 12, READY: 0x10, EN: 0x14, COLOR: 0x1c, LOC: 0x24, DONE: 0x124, TASKS: 0x128 };
    const cv = h('canvas', { width: W, height: H, style: 'display:block' }), g = cv.getContext('2d');
    let on = false, auth = 0, player = ADMIN, pd = [], loc = [], rnd = null, start = 0, warned = false;
    const rd = (p, o) => mem.rawWord(BASE + p * PER + o), wr = (p, o, v) => mem.rawSetWord(BASE + p * PER + o, v);
    const color = (c) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');
    function init() {
      auth = 0; player = ADMIN; start = Date.now(); rnd = new M.JRandom(42);
      loc = [];
      for (let j = 0; j < NL - 1; j++) { const x = Math.trunc(rnd.nextDouble() * W), y = Math.trunc(rnd.nextDouble() * (H - 50)); loc.push({ X: x, Y: y }); }
      loc.push({ X: START, Y: START });
      pd = [];
      for (let i = 0; i < NP; i++) {
        pd.push({ x: START, y: START, energy: 20, color: 0, finish: 0, visited: new Array(NL).fill(false), done: false });
        for (let j = 0; j < NL; j++) { wr(i, O.LOC + j * 8, loc[j].X); wr(i, O.LOC + j * 8 + 4, loc[j].Y); }
        for (let j = 0; j < TASK; j++) wr(i, O.TASKS + j * 4, Math.trunc(rnd.nextDouble() * 2147483647));
      }
    }
    function draw() {
      g.font = '12px Arial'; g.fillStyle = '#c0c0c0'; g.fillRect(0, 0, W, H);
      if (!on) { g.fillStyle = '#000'; g.fillText(' ScavengerHunt not yet initialized by MIPS administrator program.', 100, 200); return; }
      for (let i = 0; i < NL; i++) { g.fillStyle = '#0000ff'; g.fillRect(loc[i].X, loc[i].Y, 20, 20); g.fillStyle = '#fff'; g.fillText(' ' + i, loc[i].X + 4, loc[i].Y + 15); }
      g.fillStyle = '#000'; g.fillText('Player', W - 160, 30); g.fillText('Locations', W - 110, 30); g.fillText('Energy', W - 50, 30);
      g.strokeStyle = '#000'; g.beginPath();
      g.moveTo(W - 160, 35.5); g.lineTo(W - 10, 35.5);
      g.moveTo(W - 119.5, 35); g.lineTo(W - 119.5, 35 + NP * 15); g.moveTo(W - 49.5, 35); g.lineTo(W - 49.5, 35 + NP * 15); g.stroke();
      for (let i = 0; i < NP; i++) {
        const p = pd[i], c = color(p.color);
        g.strokeStyle = c; g.fillStyle = c;
        g.beginPath(); g.arc(p.x + 10, p.y + 10, 10, 0, 7); g.stroke();
        g.fillText(' ' + i, p.x + 4, p.y + 15);
        g.fillStyle = '#000';
        g.fillText(' ' + i, W - 150, 50 + i * 15); g.fillText(' ' + p.energy, W - 40, 50 + i * 15);
        if (p.done) g.fillText(Math.floor(p.finish / 60000) + ':' + Math.floor((p.finish % 60000) / 1000) + ':' + (p.finish % 1000), W - 115, 50 + i * 15);
        else if (p.visited.every(Boolean)) { p.done = true; p.finish = Date.now() - start; }
        else for (let j = 0; j < NL; j++) if (p.visited[j]) g.fillRect((W - 120) + j * 10, 42 + i * 15, 10, 8);
      }
    }
    const obs = (rw, a, len, data) => {
      if (rw !== 'w') return;
      if (a >>> 0 < 0xffff8000) return;
      const pb = BASE + player * PER;
      if (player === ADMIN && a === GAME) { on = true; init(); }
      else if (a === AUTH || a === TURNS) { /* nothing */ }
      else if (a === PID) {
        auth += 1;
        if (mem.rawWord(AUTH) === auth) player = mem.rawWord(PID);
      } else if (player === ADMIN) { /* administrator may write anywhere */ }
      else if (a === pb + O.READY && data !== 0) {
        if (rd(player, O.EN) <= 0) return;
        const tx = rd(player, O.TOX), ty = rd(player, O.TOY);
        if (tx < 0 || tx > W || ty < 0 || ty > H) return;
        if (Math.hypot(rd(player, O.X) - tx, rd(player, O.Y) - ty) <= 2.5) {
          wr(player, O.X, tx); wr(player, O.Y, ty); pd[player].x = tx; pd[player].y = ty;
          wr(player, O.EN, rd(player, O.EN) - 1); pd[player].energy = rd(player, O.EN);
          for (let i = 0; i < NL; i++) if (tx === loc[i].X && ty === loc[i].Y) pd[player].visited[i] = true;
          wr(player, O.READY, 0);
        }
      } else if (a === pb + O.DONE && data !== 0) {
        let prev = rd(player, O.TASKS);
        for (let i = 1; i < TASK; i++) { const c = rd(player, O.TASKS + i * 4); if (prev > c) return; prev = c; }
        wr(player, O.EN, ENERGY); wr(player, O.DONE, 0);
        for (let j = 0; j < TASK; j++) wr(player, O.TASKS + j * 4, Math.trunc(rnd.nextDouble() * 2147483647));
        pd[player].energy = ENERGY;
      } else if (a === pb + O.COLOR) pd[player].color = rd(player, O.COLOR);
      else if (!(a >= pb && a < pb + PER) && !warned) {
        warned = true;
        U.message('ScavengerHunt', 'ScavengerHunt.update(): Player ' + player + ' writing outside assigned mem. loc. at address ' + M.hex8(a) + ' -- not implemented!').then(() => { warned = false; });
      }
    };
    addObs(obs);
    const timer = setInterval(draw, 100);
    draw();
    U.dialog(' This is the ScavengerHunt', cv, [{ label: 'Reset', fn: () => { if (on) init(); draw(); return true; } }], { modal: false, noEnter: true, onClose: () => { clearInterval(timer); delObs(obs); } });
  }

  /* Screen Magnifier ---------------------------------------------------------------------------- */
  function magnifier() {
    /* Java's Robot has no browser equivalent. The pixels come from M.prints.snapshot(),
       the same renderer used by "Tirar prints", which draws the MARS window to a canvas. */
    const st = { scale: 2, resize: false, move: false, rescale: true, centered: true, width: 2, color: '#ff0000' };
    const cv = h('canvas', { width: 480, height: 300, style: 'display:block;cursor:crosshair;background:#fff' });
    const area = h('div', { style: 'width:520px;height:340px;overflow:auto;background:#eee;border:1px solid var(--s1);resize:both;display:flex' }, cv);
    let shot = null;
    const show = () => {
      if (!shot) return;
      const w = Math.round(shot.width * st.scale), ht = Math.round(shot.height * st.scale);
      cv.width = w; cv.height = ht;
      const g = cv.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(shot, 0, 0, w, ht);
      cv.style.margin = st.centered ? 'auto' : '0';
    };
    let busy = false;
    const capture = async () => {
      if (busy) return; busy = true;
      const dl = area.closest('.dlgwrap'), r = area.getBoundingClientRect();
      dl.style.visibility = 'hidden';
      try {
        const k = 2, full = await M.prints.snapshot(k);
        const c = document.createElement('canvas'); c.width = r.width * k; c.height = r.height * k;
        c.getContext('2d').drawImage(full, -r.left * k, -r.top * k);
        const s = document.createElement('canvas'); s.width = r.width; s.height = r.height;
        s.getContext('2d').drawImage(c, 0, 0, r.width, r.height);
        shot = s; show();
      } finally { dl.style.visibility = ''; busy = false; }
    };
    let last = null;
    cv.addEventListener('mousedown', (e) => { last = [e.offsetX, e.offsetY]; e.preventDefault(); });
    cv.addEventListener('mousemove', (e) => {
      if (!last || !e.buttons) { last = null; return; }
      const g = cv.getContext('2d'); g.strokeStyle = st.color; g.lineWidth = st.width; g.lineCap = 'round';
      g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(e.offsetX, e.offsetY); g.stroke();
      last = [e.offsetX, e.offsetY];
    });
    const scale = h('input', { class: 'tf', type: 'number', min: 1, max: 4, step: 0.5, value: 2, style: 'width:56px', tip: 'Magnification scale for captured image.' });
    scale.addEventListener('change', () => { st.scale = Math.max(1, Math.min(4, +scale.value || 2)); if (st.rescale) show(); });
    const settings = () => {
      const r = U.checkbox('Capture upon resize', st.resize), m = U.checkbox('Capture upon move', st.move), s = U.checkbox('Capture upon rescale', st.rescale);
      const c = U.checkbox('Capture area behind magnifier and display centered', st.centered), l = U.checkbox('Capture area behind magnifier and display upper-left', !st.centered);
      c.el.addEventListener('click', () => { l.checked = !c.checked; }); l.el.addEventListener('click', () => { c.checked = !l.checked; });
      const w = h('input', { class: 'tf', type: 'number', min: 1, max: 12, value: st.width, style: 'width:56px' }), col = h('input', { type: 'color', value: st.color });
      U.dialog('Magnifier Tool Settings', h('div', { style: 'display:flex;flex-direction:column;gap:12px' },
        h('div', { class: 'tbord', style: 'display:flex;flex-direction:column;gap:4px' }, h('span', { class: 'lg' }, 'Automatic Capture'), r.el, m.el, s.el),
        h('div', { class: 'tbord', style: 'display:flex;flex-direction:column;gap:4px' }, h('span', { class: 'lg' }, 'Capture and Display'), c.el, l.el),
        h('div', { class: 'tbord', style: 'display:flex;gap:10px;align-items:center' }, h('span', { class: 'lg' }, 'Scribbler'), 'Line width', w, 'Line color', col)),
      [{ label: 'Apply and Close', fn: () => { Object.assign(st, { resize: r.checked, move: m.checked, rescale: s.checked, centered: c.checked, width: +w.value || 2, color: col.value }); show(); } }, { label: 'Cancel' }]);
    };
    const help = 'Use this utility tool to display a magnified image of a\nsegment of the MARS window.\n\nTo capture an image, size and position the Screen Magnifier\nover the screen segment to be magnified and click "Capture".\nThe pixels beneath the magnifier will be captured, scaled,\nand displayed.\n\nTo highlight things in the image, just drag the mouse over\nthe image to make a scribble line.\n\nThe magnification scale can be adjusted using the spinner.\nOther settings can be adjusted through the Settings dialog.\n\nIn this web version the Magnifier sees the MARS window only,\nnot other programs. Setting changes are not saved when the tool is closed.';
    const row = h('div', { style: 'display:flex;gap:10px;align-items:center;justify-content:space-between' },
      h('button', { class: 'btn', tip: 'Capture, scale, and display pixels that lay beneath the Magnifier.', onclick: capture }, 'Capture'),
      h('button', { class: 'btn', tip: 'Show dialog for changing tool settings.', onclick: settings }, 'Settings...'),
      h('span', null, 'Scale: ', scale),
      h('button', { class: 'btn', onclick: () => U.message('Simulating the Screen Magnifier', help, 'info') }, 'Help'),
      h('button', { class: 'btn', tip: 'Exit the Screen Magnifier.  Changed settings are NOT retained.', onclick: () => dlg.close() }, 'Close'));
    const dlg = U.dialog('Screen Magnifier 1.0', h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, row, area), null, {
      modal: false, noEnter: true,
      onClose: () => { ro.disconnect(); document.removeEventListener('mouseup', mv); },
    });
    let pos = dlg.el.getBoundingClientRect(), first = true;
    const ro = new ResizeObserver(() => { if (first) { first = false; return; } if (st.resize) capture(); });
    ro.observe(area);
    const mv = () => { const r = dlg.el.getBoundingClientRect(); if (r.left !== pos.left || r.top !== pos.top) { pos = r; if (st.move) capture(); } };
    document.addEventListener('mouseup', mv);
  }

  Object.assign(T.MAP, { 'BHT Simulator': bht, 'Digital Lab Sim': digital, 'Mars Bot': bot, ScavengerHunt: hunt, 'Screen Magnifier': magnifier });
})();
