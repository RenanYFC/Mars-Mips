/* MARS web - MIPS X-Ray: animation of the MIPS datapath. Port of MipsXray.java / UnitAnimation.java.
   Vertices come from the original XML files (see xray-data.js). One simulation tick is 1 pixel;
   Java ran a tick every 5 ms (8 ms in the unit views), so several ticks run per animation frame. */
(function () {
  const M = globalThis.MARS, U = M.ui, h = U.h, sim = M.sim, T = M.tools, XR = M.XRAY;
  const bin32 = (v) => (v >>> 0).toString(2).padStart(32, '0');
  const kind = (op) => {
    if (op === '000000') return 'R';
    if (/^00001[01]$/.test(op)) return 'J';
    if (/^100[01]{3}$/.test(op)) return 'LOAD';
    if (/^101[01]{3}$/.test(op)) return 'STORE';
    if (/^0001[01]{2}$/.test(op)) return 'BRANCH';
    return 'I';
  };
  const TAG = { R: 'color_Rtype', J: 'color_Jtype', LOAD: 'color_LOADtype', STORE: 'color_STOREtype', BRANCH: 'color_BRANCHtype', I: 'color_Itype' };
  const rgb = (s) => { const [r, g, b] = s.split('#'); return `rgb(${r},${g},${b})`; };

  function buildGraph(list, code, aluUnit) {
    const k = kind(code.slice(0, 6));
    let tag = TAG[k];
    if (aluUnit && k === 'R') {
      const f = code.slice(28, 32);
      tag = { '0000': 'ALU_out010', '0010': 'ALU_out110', '0100': 'ALU_out000', '0101': 'ALU_out001' }[f] || 'ALU_out111';
    }
    const v = list.map((d) => ({ d, cur: d.init, active: false, first: true, color: rgb(d.colors[tag] || d.colors.color_Itype || '0#153#0') }));
    v[0].active = true;
    return { v, done: [v[0]], seen: new Set([0]) };
  }
  function tick(G) {
    for (let i = 0; i < G.done.length; i++) {
      const s = G.done[i], d = s.d;
      if (s.active) {
        s.first = false;
        if (d.text) {
          if (s.cur === d.end) s.active = false;
          s.cur -= 1;
        } else {
          const up = d.init < d.end, last = d.init === d.end ? d.init : up ? d.end - 1 : d.end + 1;
          if (s.cur === last) s.active = false;
          s.cur += up ? 1 : -1;
        }
      }
      if (!s.active) {
        for (const t of d.targets) {
          if (t >= 0 && t < G.v.length && !G.seen.has(t)) { G.seen.add(t); G.v[t].active = true; G.done.push(G.v[t]); }
        }
      }
    }
  }
  function paintTracks(g, G, textFn) {
    for (const s of G.done) {
      const d = s.d;
      if (d.text) { if (s.active && textFn) textFn(s); continue; }
      if (s.first) continue;
      const lo = Math.min(d.init, d.end), hi = Math.max(d.init, d.end), up = d.init < d.end;
      let a = lo, b = hi;
      if (s.active) { if (up) b = Math.min(hi, s.cur + 1); else a = Math.max(lo, s.cur); }
      g.fillStyle = s.color;
      if (d.x) g.fillRect(a, d.axis, Math.max(0, b - a) + 2, 3); else g.fillRect(d.axis, a, 3, Math.max(0, b - a) + 2);
    }
  }

  /* the text below the datapath (setUpInstructionInfo) */
  const parseBin = (s) => String(parseInt(s, 2));
  function info(g, c) {
    const op = c.slice(0, 6), k = kind(op), F = '15px Arial', TT = '10px Verdana';
    const t = (s, x, y, col, font) => { g.font = font || F; g.fillStyle = col; g.fillText(s === undefined ? '' : s, x, y); };
    const orange1 = 'rgb(255,102,0)', sub = (a, b) => c.slice(a, b), R = (s) => XR.reg[s], OP = XR.opcode[op], FN = XR.funct[sub(26, 32)];
    const titleF = 'bold 25px Verdana';
    const field = (lbl, x, s, col) => { t(lbl, x, 530, 'red', TT); t(s, x, 550, col); };
    field('opcode', 25, op, 'magenta');
    t('Instruction', 25, 480, 'red', TT);
    if (k === 'R') {
      t('REGISTER TYPE INSTRUCTION', 280, 30, 'black', 'bold 25px Arial');
      field('rs', 90, sub(6, 11), '#00ff00'); field('rt', 150, sub(11, 16), 'blue'); field('rd', 210, sub(16, 21), 'cyan');
      field('shamt', 270, sub(21, 26), 'black'); field('function', 330, sub(26, 32), orange1);
      t(FN, 25, 500, 'black'); t(R(sub(6, 11)), 65, 500, 'black'); t(R(sub(16, 21)), 105, 500, 'black'); t(R(sub(11, 16)), 145, 500, 'black');
    } else if (k === 'J') {
      t('JUMP TYPE INSTRUCTION', 280, 30, 'black', titleF);
      field('address', 95, sub(6, 32), 'orange');
      t(OP, 65, 500, 'cyan'); t('LABEL', 105, 500, 'cyan');
    } else if (k === 'LOAD' || k === 'STORE') {
      t(k + ' TYPE INSTRUCTION', 280, 30, 'black', titleF);
      field('rs', 90, sub(6, 11), '#00ff00'); field('rt', 145, sub(11, 16), 'blue'); field('Immediate', 200, sub(16, 32), orange1);
      t(OP, 25, 500, 'black'); t(R(sub(11, 16)), 65, 500, 'black');
      t('M[ ' + R(sub(6, 11)) + ' + ' + ((parseInt(sub(16, 32), 2) << 16) >> 16) + ' ]', 105, 500, 'black');
    } else {
      t((k === 'BRANCH' ? 'BRANCH' : 'IMMEDIATE') + ' TYPE INSTRUCTION', 250, 30, 'black', titleF);
      field('rs', 90, sub(6, 11), '#00ff00'); field('rt', 145, sub(11, 16), 'blue'); field('Immediate', 200, sub(16, 32), 'cyan');
      t(OP, 25, 500, 'black'); t(R(sub(6, 11)), 105, 500, 'black'); t(R(sub(11, 16)), 65, 500, 'black'); t(parseBin(sub(16, 32)), 155, 500, 'black');
    }
    t('Control Signals', 25, 440, 'red', TT); t('Active', 25, 455, 'red'); t('Inactive', 75, 455, 'gray');
    t('To see details of control units and register bank click inside the functional block', 400, 550, 'black');
  }
  function movingText(g, s, c) {
    const op = c.slice(0, 6), d = s.d;
    let txt = d.name;
    if (/^101/.test(op)) txt = ' ';
    if (d.name === 'ALUVALUE') txt = op === '000000' ? XR.funct[c.slice(26, 32)] : XR.opcode[op];
    if (/^0001[01]{2}$/.test(op) && d.name === 'CP+4') txt = 'PC+OFFSET';
    if (d.name === 'WRITING' && !/^100/.test(op)) txt = ' ';
    g.font = 'bold 13px Verdana'; g.fillStyle = 'red'; g.fillText(txt || '', d.axis, s.cur);
  }

  const img = {};
  const load = (n) => { if (!img[n]) { img[n] = new Image(); img[n].src = 'images/' + n + '.png'; } return img[n]; };
  const UNITS = { register: ['register', XR.register, false], control: ['control', XR.control, false], alu: ['ALUcontrol', XR.alu, true] };

  function unitWindow(unit, code) {
    const [image, list, alu] = UNITS[unit];
    const cv = h('canvas', { width: 830, height: 540, style: 'display:block;background:#fff' }), g = cv.getContext('2d');
    const G = buildGraph(list, code, alu), im = load(image);
    let raf = 0;
    const frameFn = () => {
      for (let i = 0; i < 2; i++) tick(G);
      g.fillStyle = '#fff'; g.fillRect(0, 0, 830, 540);
      if (im.complete) g.drawImage(im, 0, 0);
      paintTracks(g, G);
      raf = requestAnimationFrame(frameFn);
    };
    frameFn();
    U.dialog('MIPS X-Ray', cv, null, { modal: false, noEnter: true, onClose: () => cancelAnimationFrame(raf) });
  }

  function xray() {
    const cv = h('canvas', { width: 1000, height: 574, style: 'display:block;background:#fff' }), g = cv.getContext('2d');
    const im = load('datapath');
    let G = null, code = null, raf = 0, next = null;
    const paintIdle = () => { g.fillStyle = '#fff'; g.fillRect(0, 0, 1000, 574); if (im.complete) g.drawImage(im, 0, 0); };
    if (im.complete) paintIdle(); else im.addEventListener('load', paintIdle);
    const frameFn = () => {
      raf = 0;
      if (next !== null) { code = next; next = null; G = buildGraph(XR.main, code, false); }
      if (!G) return;
      for (let i = 0; i < 3; i++) tick(G);
      paintIdle(); info(g, code);
      paintTracks(g, G, (s) => movingText(g, s, code));
      raf = requestAnimationFrame(frameFn);
    };
    let last = -1;
    const onInst = (st, pc) => {
      if (pc === last && sim.running && sim.speed() >= 40) return;
      last = pc; next = bin32(st.binary);
      if (!raf) raf = requestAnimationFrame(frameFn);
    };
    cv.addEventListener('click', (e) => {
      if (!code) return;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (x > 425 && x < 520 && y > 300 && y < 425) unitWindow('register', code);
      if (x > 355 && x < 415 && y > 180 && y < 280) unitWindow('control', code);
      if (x > 560 && x < 620 && y > 450 && y < 520) unitWindow('alu', code);
    });
    const bar = h('div', { style: 'display:flex;gap:0' },
      h('div', { class: 'tb', tip: 'Assemble the current file and clear breakpoints', onclick: () => M.app.action('assemble') }, h('img', { src: 'images/Assemble22.png' })),
      h('div', { class: 'tb', tip: 'Run one step at a time', onclick: () => M.app.action('step') }, h('img', { src: 'images/StepForward22.png' })));
    T.frame('MIPS X-Ray - Animation of MIPS Datapath,  Version 2.0', 'MIPS X-Ray - Animation of MIPS Datapath', h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, bar, cv), {
      attach() { T.addInst(onInst); }, detach() { T.delInst(onInst); cancelAnimationFrame(raf); raf = 0; },
      onReset() { G = null; code = null; next = null; last = -1; paintIdle(); },
      help: 'This plugin is used to visualizate the behavior of mips processor using the default datapath.\nIt reads the source code instruction and generates an animation representing the inputs and\noutputs of functional blocks and the interconnection between them.  The basic signals\nrepresented are, control signals, opcode bits and data of functional blocks.\n\nBesides the datapath representation, information for each instruction is displayed below\nthe datapath. That display includes opcode value, with the correspondent colors used to\nrepresent the signals in datapath, mnemonic of the instruction processed at the moment, registers\nused in the instruction and a label that indicates the color code used to represent control signals\n\nTo see the datapath of register bank and control units click inside the functional unit.\n\nVersion 2.0\nDeveloped by Márcio Roberto, Guilherme Sales, Fabrício Vivas, Flávio Cardeal and Fábio Lúcio\nContact Marcio Roberto at marcio.rdaraujo@gmail.com with questions or comments.\n',
    });
  }
  T.MAP['MIPS X-Ray'] = xray;
  M.xrayInternals = { buildGraph, tick, bin32 };
})();
