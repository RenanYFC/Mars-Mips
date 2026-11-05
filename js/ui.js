/* MARS web - main window: menus, toolbar, run speed, messages pane and the Run/File actions.
   Port of mars.venus.VenusUI and the Run*Action / Settings*Action classes. */
(function () {
  const M = globalThis.MARS, U = M.ui, S = M.settings, h = U.h, ST = M.FileStatus, CPU = M.cpu, mem = M.mem;
  const ed = M.editor, X = M.exec, R = M.regs, sim = M.sim;
  const VERSION = '4.5';
  const app = (M.app = { state: ST.NO_FILE, reset: true, started: false, assembled: false, leader: null, files: null });

  /* ---- actions --------------------------------------------------------------------- */
  const A = {};
  const act = (id, label, icon, tip, mnem, accel, fn) => { A[id] = { id, label, icon, tip, mnem, accel, fn, enabled: true, els: [] }; };
  const setEn = (id, on) => { const a = A[id]; if (a.enabled === on) return; a.enabled = on; for (const e of a.els) e.classList.toggle('dis', !on); };

  act('new', 'New', 'New', 'Create a new file for editing', 'N', 'Ctrl-N', () => { ed.newFile(); updateState(); });
  act('open', 'Open ...', 'Open', 'Open a file for editing', 'O', 'Ctrl-O', async () => { const f = await ed.open(); if (f) { updateState(); if (S.assembleOnOpen) app.assemble(); } });
  act('close', 'Close', null, 'Close the current file', 'C', 'Ctrl-W', async () => { await ed.close(); afterClose(); });
  act('closeAll', 'Close All', null, 'Close all open files', 'L', null, async () => { await ed.closeAll(); afterClose(); });
  act('save', 'Save', 'Save', 'Save the current file', 'S', 'Ctrl-S', async () => { await ed.save(); updateState(); });
  act('saveAs', 'Save as ...', 'SaveAs', 'Save current file with different name', 'A', null, async () => { await ed.saveAs(); updateState(); });
  act('saveAll', 'Save All', null, 'Save all open files', 'V', null, async () => { await ed.saveAll(); updateState(); });
  act('dump', 'Dump Memory ...', 'Dump', 'Dump machine code or data in an available format', 'D', 'Ctrl-D', () => M.dialogs.dump());
  act('print', 'Print ...', 'Print', 'Print current file', 'P', null, () => M.dialogs.print());
  act('exit', 'Exit', null, 'Exit Mars', 'X', null, async () => { if (await ed.closeAll()) { afterClose(); window.close(); } });
  act('undo', 'Undo', 'Undo', 'Undo last edit', 'U', 'Ctrl-Z', () => { ed.undo(); updateState(); });
  act('redo', 'Redo', 'Redo', 'Redo last edit', 'R', 'Ctrl-Y', () => { ed.redo(); updateState(); });
  const ta = () => ed.cur && ed.cur.ta;
  act('cut', 'Cut', 'Cut', 'Cut', 'C', 'Ctrl-X', async () => { const t = ta(); if (!t) return; t.focus(); const s = t.value.slice(t.selectionStart, t.selectionEnd); if (s) { await navigator.clipboard.writeText(s).catch(() => {}); ed.insert(ed.cur, ''); } });
  act('copy', 'Copy', 'Copy', 'Copy', 'O', 'Ctrl-C', async () => { const t = ta(); if (!t) return; t.focus(); const s = t.value.slice(t.selectionStart, t.selectionEnd); if (s) await navigator.clipboard.writeText(s).catch(() => {}); });
  act('paste', 'Paste', 'Paste', 'Paste', 'P', 'Ctrl-V', async () => { const t = ta(); if (!t) return; t.focus(); try { const s = await navigator.clipboard.readText(); if (s) ed.insert(ed.cur, s); } catch (e) { /* denied */ } });
  act('find', 'Find/Replace', 'Find', 'Find/Replace', 'F', 'Ctrl-F', () => M.dialogs.find());
  act('selectAll', 'Select All', null, 'Select All', 'A', 'Ctrl-A', () => { const t = ta(); if (t) { t.focus(); t.select(); } });
  act('assemble', 'Assemble', 'Assemble', 'Assemble the current file and clear breakpoints', 'A', 'F3', () => app.assemble());
  act('go', 'Go', 'Play', 'Run the current program', 'G', 'F5', () => app.go());
  act('step', 'Step', 'StepForward', 'Run one step at a time', 'T', 'F7', () => app.step());
  act('backstep', 'Backstep', 'StepBack', 'Undo the last step', 'B', 'F8', () => app.backstep());
  act('pause', 'Pause', 'Pause', 'Pause the currently running program', 'P', 'F9', () => sim.pause());
  act('stop', 'Stop', 'Stop', 'Stop the currently running program', 'S', 'F11', () => sim.stop());
  act('reset', 'Reset', 'Reset', 'Reset MIPS memory and registers', 'R', 'F12', () => app.resetAction());
  act('clearBp', 'Clear all breakpoints', null, 'Clears all execution breakpoints set since the last assemble.', 'K', 'Ctrl-K', () => X.clearBreakpoints());
  act('toggleBp', 'Toggle all breakpoints', null, 'Disable/enable all breakpoints without clearing (can also click Bkpt column header)', 'T', 'Ctrl-T', () => app.toggleBreakpoints());
  act('help', 'Help', 'Help', 'Help', 'H', 'F1', () => M.dialogs.help());
  act('about', 'About ...', null, 'Information about Mars', null, null, () => M.dialogs.about());
  app.toggleBreakpoints = () => X.toggleBreakpoints();
  app.action = (id) => { if (A[id].enabled) A[id].fn(); };
  act('prints', 'Tirar prints', null, 'Gera prints do código-fonte e exporta em Word (.docx)', null, null, () => M.prints.run());

  /* settings check items -------------------------------------------------------------- */
  const ck = (key, label, tip, fn) => ({ check: true, key, label, tip, fn });
  const SETTINGS = [
    ck('labelWindow', 'Show Labels Window (symbol table)', 'Toggle visibility of Labels window (symbol table) in the Execute tab', () => X.layout()),
    ck('programArgs', 'Program arguments provided to MIPS program', 'If set, program arguments for MIPS program can be entered in border of Text Segment window.', (v) => X.setProgramArgsVisible(v)),
    ck('popupInput', 'Popup dialog for input syscalls (5,6,7,8,12)', 'If set, use popup dialog for input syscalls (5,6,7,8,12) instead of cursor in Run I/O window'),
    ck('addrHex', 'Addresses displayed in hexadecimal', 'Toggle between hexadecimal and decimal display of memory addresses', (v) => app.setAddrHex(v)),
    ck('valHex', 'Values displayed in hexadecimal', 'Toggle between hexadecimal and decimal display of memory/register values', (v) => app.setValHex(v)),
    null,
    ck('assembleOnOpen', 'Assemble file upon opening', 'If set, a file will be automatically assembled as soon as it is opened.  File Open dialog will show most recently opened file.'),
    ck('assembleAll', 'Assemble all files in directory', 'If set, all files in current directory will be assembled when Assemble operation is selected.'),
    ck('warningsAreErrors', 'Assembler warnings are considered errors', 'If set, assembler warnings will be interpreted as errors and prevent successful assembly.'),
    ck('startAtMain', "Initialize Program Counter to global 'main' if defined", "If set, assembler will initialize Program Counter to text address globally labeled 'main', if defined."),
    ck('extended', 'Permit extended (pseudo) instructions and formats', 'If set, MIPS extended (pseudo) instructions are formats are permitted.', () => app.invalidate()),
    ck('delayedBranching', 'Delayed branching', 'If set, delayed branching will occur during MIPS execution.', () => app.invalidate()),
    ck('selfModifying', 'Self-modifying code', 'If set, the MIPS program can write and branch to both text and data segments.'),
    null,
    { label: 'Editor...', tip: 'View and modify text editor settings.', fn: () => M.dialogs.editorSettings() },
    { label: 'Highlighting...', tip: 'View and modify Execute Tab highlighting colors', fn: () => M.dialogs.highlighting() },
    { label: 'Exception Handler...', tip: 'If set, the specified exception handler file will be included in all Assemble operations.', fn: () => M.dialogs.exceptionHandler() },
    { label: 'Memory Configuration...', tip: 'View and modify memory segment base addresses for simulated MIPS.', fn: () => M.dialogs.memoryConfig() },
  ];
  const TOOLS = ['BHT Simulator', 'Bitmap Display', 'Data Cache Simulator', 'Digital Lab Sim', 'Floating Point Representation', 'Instruction Counter', 'Instruction Statistics',
    'Introduction to Tools', 'Keyboard and Display MMIO Simulator', 'Mars Bot', 'Memory Reference Visualization', 'MIPS X-Ray', 'ScavengerHunt', 'Screen Magnifier'];

  const MENUS = [
    ['File', 'F', ['new', 'open', 'close', 'closeAll', null, 'save', 'saveAs', 'saveAll', 'dump', null, 'print', 'exit']],
    ['Edit', 'E', ['undo', 'redo', null, 'cut', 'copy', 'paste', null, 'find', 'selectAll']],
    ['Run', 'R', ['assemble', 'go', 'step', 'backstep', 'pause', 'stop', 'reset', null, 'clearBp', 'toggleBp']],
    ['Settings', 'S', SETTINGS],
    ['Tools', 'T', [...TOOLS.map((t) => ({ label: t, tool: t })), null, 'prints']],
    ['Help', 'H', ['help', null, 'about']],
  ];
  const BLANK_ICONED = new Set(['close', 'closeAll', 'saveAll', 'exit', 'selectAll', 'clearBp', 'toggleBp', 'about']);
  const iconFile = (n, size) => 'images/' + n + size + (n === 'Print' || n === 'Cut' ? '.gif' : '.png');
  let openMenu = null;
  function closeMenus() { if (openMenu) { openMenu.popup.remove(); openMenu.el.classList.remove('open'); openMenu = null; } }
  function buildPopup(items) {
    const p = h('div', { class: 'popup' });
    for (const it of items) {
      if (it === null) { p.append(h('div', { class: 'sep' })); continue; }
      let row;
      if (typeof it === 'string') {
        const a = A[it];
        const lb = h('span', { class: 'lb' });
        const idx = a.mnem ? a.label.indexOf(a.mnem) : -1;
        if (idx >= 0) lb.append(a.label.slice(0, idx), h('u', null, a.label[idx]), a.label.slice(idx + 1)); else lb.append(a.label);
        row = h('div', { class: 'mi' + (a.enabled ? '' : ' dis'), tip: a.tip }, h('span', { class: 'ic' }, a.icon ? h('img', { src: iconFile(a.icon, 16) }) : null), lb, h('span', { class: 'ak' }, a.accel || ''));
        row.addEventListener('mouseup', () => { if (a.enabled) { closeMenus(); a.fn(); } });
      } else if (it.check) {
        row = h('div', { class: 'mi chk', tip: it.tip }, h('span', { class: 'ic' }, h('span', { class: 'box' + (S[it.key] ? ' c' : '') })), h('span', { class: 'lb' }, it.label));
        row.addEventListener('mouseup', () => {
          S[it.key] = !S[it.key]; M.saveSettings(); closeMenus(); if (it.fn) it.fn(S[it.key]);
        });
      } else {
        row = h('div', { class: 'mi', tip: it.tip }, h('span', { class: 'ic' }), h('span', { class: 'lb' }, it.label));
        row.addEventListener('mouseup', () => { closeMenus(); if (it.tool) M.tools.open(it.tool); else it.fn(); });
      }
      row.addEventListener('mouseenter', () => { p.querySelectorAll('.on').forEach((e) => e.classList.remove('on')); row.classList.add('on'); });
      row.addEventListener('mouseleave', () => row.classList.remove('on'));
      p.append(row);
    }
    return p;
  }
  function showMenu(el, items) {
    closeMenus();
    const p = buildPopup(items), r = el.getBoundingClientRect();
    p.style.left = r.left + 'px'; p.style.top = r.bottom + 'px';
    document.body.append(p); el.classList.add('open');
    openMenu = { popup: p, el };
    if (p.getBoundingClientRect().right > innerWidth) p.style.left = innerWidth - p.offsetWidth - 2 + 'px';
  }
  document.addEventListener('mousedown', (e) => { if (openMenu && !e.target.closest('.popup') && !e.target.closest('.menu')) closeMenus(); });

  /* ---- speed slider ----------------------------------------------------------------- */
  const SPEEDS = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 40, 40, 40, 40, 40];
  let speedIdx = 40;
  sim.speed = () => SPEEDS[speedIdx];
  const speedLabel = (i) => 'Run speed ' + (i <= 35 ? (SPEEDS[i] < 1 ? SPEEDS[i] : SPEEDS[i].toFixed(1)) + ' inst/sec' : 'at max (no interaction)');
  const THUMB = '<svg class="thm" viewBox="0 0 15 16"><defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dde8f3"/><stop offset=".35" stop-color="#fff"/><stop offset="1" stop-color="#b8cfe5"/></linearGradient></defs><path d="M.5.5h14v9l-7 6-7-6z" fill="url(#tg)" stroke="#6382bf"/></svg>';
  function buildSpeed() {
    const lbl = h('div', { class: 'lbl' }, speedLabel(40));
    const sl = h('div', { class: 'sl' }, h('div', { class: 'trk' }));
    for (let i = 0; i <= 8; i++) sl.append(h('div', { class: 'tick', style: `left:calc(7px + (100% - 14px)*${i}/8)` }));
    const hold = h('span'); hold.innerHTML = THUMB; const th = hold.firstChild; sl.append(th);
    const set = (i) => { speedIdx = i; th.style.left = `calc(7px + (100% - 14px)*${i}/40)`; lbl.textContent = speedLabel(i); };
    const pick = (e) => { const r = sl.getBoundingClientRect(); set(Math.max(0, Math.min(40, Math.round(((e.clientX - r.left - 7) / (r.width - 14)) * 40)))); };
    sl.addEventListener('pointerdown', (e) => { sl.setPointerCapture(e.pointerId); pick(e); });
    sl.addEventListener('pointermove', (e) => { if (e.buttons) pick(e); });
    set(40);
    return h('div', { id: 'speed', tip: 'Simulation speed for "Go".  At 30 inst/sec or less, tables updated after each instruction.' }, lbl, sl);
  }

  /* ---- layout ------------------------------------------------------------------------ */
  function build() {
    const root = document.getElementById('app');
    const titleT = h('span', { class: 't' }, 'MARS ' + VERSION);
    app.titleEl = titleT;
    const svg = (p) => { const b = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); b.setAttribute('viewBox', '0 0 10 10'); b.innerHTML = p; return b; };
    const bMin = h('button', { class: 'win', disabled: true }, svg('<path d="M0 5h10"/>'));
    const bMax = h('button', { class: 'win', tip: 'Full screen', onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()) }, svg('<rect x=".5" y=".5" width="9" height="9"/>'));
    const bCl = h('button', { class: 'win close', onclick: () => A.exit.fn() }, svg('<path d="M0 0l10 10M10 0L0 10"/>'));
    root.append(h('div', { id: 'titlebar' }, h('img', { src: 'images/RedMars16.gif' }), titleT, bMin, bMax, bCl));

    const bar = h('div', { id: 'menubar' });
    for (const [name, mn, items] of MENUS) {
      const i = name.indexOf(mn);
      const m = h('div', { class: 'menu' }, name.slice(0, i), h('u', null, mn), name.slice(i + 1));
      m.addEventListener('mousedown', (e) => { e.preventDefault(); if (openMenu && openMenu.el === m) closeMenus(); else showMenu(m, items); });
      m.addEventListener('mouseenter', () => { if (openMenu && openMenu.el !== m) showMenu(m, items); });
      bar.append(m);
    }
    root.append(bar);

    const tb = h('div', { id: 'toolbar' }, h('div', { class: 'grip' }));
    const TB = ['new', 'open', 'save', 'saveAs', 'dump', 'print', 0, 'undo', 'redo', 'cut', 'copy', 'paste', 'find', 0, 'assemble', 'go', 'step', 'backstep', 'pause', 'stop', 'reset', 0, 'help', 0];
    for (const id of TB) {
      if (id === 0) { tb.append(h('div', { class: 'tsep' })); continue; }
      const a = A[id];
      const b = h('div', { class: 'tb', tip: a.tip }, h('img', { src: iconFile(a.icon, 22) }));
      b.addEventListener('click', () => { if (a.enabled) a.fn(); });
      a.els.push(b); tb.append(b);
    }
    root.append(h('div', { id: 'toolrow' }, tb, buildSpeed()));

    const center = h('div', { id: 'center' });
    const left = h('div', { id: 'left' });
    const mainP = h('div', { id: 'mainPane', style: 'flex:1;min-height:0' });
    const msgP = h('div', { id: 'msgPane', style: 'flex:none;height:25%' });
    const regP = h('div', { id: 'regPane', style: 'flex:none;width:26%' });
    app.mainTabs = U.tabbed(mainP, [{ title: 'Edit' }, { title: 'Execute' }], (i) => { if (i === 1) X.layout(); });
    ed.init(app.mainTabs.tabs[0].page);
    X.init(app.mainTabs.tabs[1].page);

    const asmTa = h('textarea', { readonly: true, spellcheck: 'false', wrap: 'off' });
    const runTa = h('textarea', { readonly: true, spellcheck: 'false', wrap: 'off' });
    app.asmTa = asmTa; app.runTa = runTa;
    const mkPage = (tx, tip) => h('div', { class: 'mpage' }, h('div', { class: 'side' }, h('button', { class: 'btn', style: 'padding:0 6px', tip, onclick: () => { tx.value = ''; } }, 'Clear')), tx);
    app.msgTabs = U.tabbed(msgP, [
      { title: 'Mars Messages', page: mkPage(asmTa, 'Clear the Mars Messages area') },
      { title: 'Run I/O', page: mkPage(runTa, 'Clear the Run I/O area') }]);
    asmTa.addEventListener('click', () => {
      const v = asmTa.value, p = asmTa.selectionStart, ls = v.lastIndexOf('\n', p - 1) + 1, le = v.indexOf('\n', p);
      const line = v.slice(ls, le < 0 ? v.length : le);
      const m = line.match(/^(?:Error|Warning) in (.*?) line (?:[\d>-]*?)(\d+)(?: column (\d+))?:/);
      if (m) { asmTa.setSelectionRange(ls, le); app.selectTab(0); ed.gotoLine(+m[2], m[3] ? +m[3] : 0, m[1]); }
    });
    app.regTabs = U.tabbed(regP, [
      { title: 'Registers', tip: 'CPU registers' },
      { title: 'Coproc 1', tip: 'Coprocessor 1 (floating point unit) registers' },
      { title: 'Coproc 0', tip: 'selected Coprocessor 0 (exceptions and interrupts) registers' }]);
    R.init(app.regTabs.tabs.map((t) => t.page));

    const dh2 = U.divider('h', () => left.clientHeight - 10 - msgP.offsetHeight, (v) => { const H = left.clientHeight - 10; msgP.style.height = Math.max(0, H - Math.max(0, Math.min(H, v))) + 'px'; });
    const dv = U.divider('v', () => center.clientWidth - 10 - regP.offsetWidth, (v) => { const W = center.clientWidth - 10; regP.style.width = Math.max(0, W - Math.max(0, Math.min(W, v))) + 'px'; });
    left.append(mainP, dh2, msgP);
    center.append(left, dv, regP);
    root.append(center);
  }

  /* ---- state ---------------------------------------------------------------------------- */
  const setTitle = () => {
    const f = ed.cur;
    const t = f ? f.name + (f.dirty ? ' *' : '') + ' - MARS ' + VERSION : 'MARS ' + VERSION;
    document.title = t; app.titleEl.textContent = t;
  };
  function menuState(st) {
    const on = (ids, v) => ids.forEach((i) => setEn(i, v));
    const fileIds = ['close', 'closeAll', 'save', 'saveAs', 'saveAll', 'print'];
    const editIds = ['cut', 'copy', 'paste', 'find', 'selectAll'];
    setEn('prints', st !== ST.NO_FILE && st !== ST.RUNNING && !(M.prints && M.prints.busy));
    const canBack = sim.canBackstep();
    setEn('new', true); setEn('open', true); setEn('exit', true); setEn('help', true);
    if (st === ST.NO_FILE) {
      on(fileIds, false); on(editIds, false); on(['dump', 'undo', 'redo', 'assemble', 'go', 'step', 'backstep', 'pause', 'stop', 'reset', 'clearBp', 'toggleBp'], false);
    } else if (st === ST.RUNNING) {
      on(fileIds, false); on(editIds, false);
      on(['new', 'open', 'dump', 'undo', 'redo', 'assemble', 'go', 'step', 'backstep', 'reset', 'toggleBp', 'clearBp'], false);
      on(['pause', 'stop'], true);
    } else {
      on(fileIds, true); on(editIds, true);
      setEn('undo', ed.canUndo()); setEn('redo', ed.canRedo());
      setEn('assemble', true); on(['pause', 'stop'], false);
      if (st === ST.RUNNABLE) { on(['go', 'step', 'reset', 'clearBp', 'toggleBp', 'dump'], true); setEn('backstep', canBack && !app.reset); }
      else if (st === ST.TERMINATED) { on(['go', 'step'], false); on(['reset', 'clearBp', 'toggleBp', 'dump'], true); setEn('backstep', canBack); }
      else on(['go', 'step', 'backstep', 'reset', 'clearBp', 'toggleBp', 'dump'], false);
    }
  }
  function updateState() {
    const f = ed.cur;
    app.state = f ? f.status : ST.NO_FILE;
    if (sim.running) app.state = ST.RUNNING;
    menuState(app.state); setTitle();
  }
  app.updateState = updateState;
  const setStatus = (s) => { if (ed.cur) ed.cur.status = s; updateState(); };
  function afterClose() { if (!ed.cur) { app.assembled = false; X.clearText(); } updateState(); }
  ed.onChange = () => updateState();
  ed.onSwitch = () => {
    if (!app.titleEl) return;
    if (!S.assembleAll) { if (app.leader !== ed.cur) clearExec(); }
    updateState();
  };
  function clearExec() {
    if (ed.cur && ed.cur.status >= ST.RUNNABLE) ed.cur.status = ST.NOT_EDITED;
    app.assembled = false; X.clearText(); X.labelState.body.textContent = '';
    M.resetRegisters(); R.update(); R.clearHighlight();
  }
  app.invalidate = () => { for (const f of ed.files) if (f.status === ST.RUNNABLE || f.status === ST.TERMINATED) f.status = ST.NOT_EDITED; updateState(); };
  app.selectTab = (i) => app.mainTabs.select(i);
  app.selectRegTab = (i) => app.regTabs.select(i);
  app.isRunning = () => sim.running;
  app.refreshRegs = () => R.update();

  /* ---- messages ---------------------------------------------------------------------------- */
  const LIMIT = 1000000;
  function post(ta, s) {
    ta.value += s;
    if (ta.value.length > LIMIT) ta.value = ta.value.slice(ta.value.length - LIMIT);
    ta.scrollTop = ta.scrollHeight;
  }
  const mars = (s) => post(app.asmTa, s);
  let outBuf = '';
  const flush = () => { if (outBuf) { post(app.runTa, outBuf); outBuf = ''; } };
  const run = (s) => { flush(); post(app.runTa, s); };
  const selMsg = (i) => app.msgTabs.select(i);

  /* syscall I/O through the Run I/O textarea ---------------------------------------------------- */
  let inputState = null;
  function endInput(value) {
    const st = inputState; if (!st) return;
    inputState = null;
    app.runTa.readOnly = true;
    app.runTa.removeEventListener('keydown', st.key); app.runTa.removeEventListener('input', st.inp); app.runTa.removeEventListener('beforeinput', st.guard);
    if (value !== null) st.cb(value);
  }
  function cursorInput(kind, data, cb) {
    flush(); selMsg(1);
    const ta = app.runTa, start = ta.value.length, max = data.maxLength === undefined ? Infinity : data.maxLength;
    ta.readOnly = false; ta.focus(); ta.setSelectionRange(start, start);
    const key = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = ta.value.slice(start);
        ta.value += '\n'; ta.scrollTop = ta.scrollHeight;
        endInput(v);
      }
    };
    const guard = (e) => {
      if (ta.selectionStart < start) { ta.setSelectionRange(ta.value.length, ta.value.length); }
      if ((e.inputType || '').startsWith('delete') && ta.selectionStart <= start && ta.selectionEnd <= start) e.preventDefault();
    };
    const inp = () => {
      const v = ta.value.slice(start);
      if (v.length >= max && max !== Infinity) {
        const s = v.slice(0, max);
        ta.value = ta.value.slice(0, start) + s;
        if (kind === 'string' || kind === 'char') { ta.value += '\n'; endInput(s); }
      }
      ta.scrollTop = ta.scrollHeight;
    };
    ta.addEventListener('keydown', key); ta.addEventListener('beforeinput', guard); ta.addEventListener('input', inp);
    inputState = { key, inp, guard, cb };
  }
  const POPUP_TEXT = { int: (d) => 'Enter an integer value (syscall ' + d.service + ')', float: (d) => 'Enter a float value (syscall ' + d.service + ')', double: (d) => 'Enter a double value (syscall ' + d.service + ')',
    string: (d) => 'Enter a string of maximum length ' + d.maxLength + ' (syscall ' + d.service + ')', char: (d) => 'Enter a character value (syscall ' + d.service + ')' };
  sim.io = {
    print: (s) => { outBuf += s; if (outBuf.length > 8192) flush(); },
    flush,
    request(kind, data, cb) {
      flush();
      if (kind === 'dialog') {
        if (data.type === 'input') U.input('Input', data.message).then(cb);
        else if (data.type === 'confirm') U.confirm('Select an Option', data.message).then((r) => cb(r === -1 ? 2 : r));
        else {
          const T = { 0: ['Error', 'error'], 1: ['Information', 'info'], 2: ['Warning', 'warn'], 3: ['Question', 'question'] }[data.msgType] || ['Message', null];
          U.message(T[0], data.message, T[1]).then(() => cb(true));
        }
        return;
      }
      if (S.popupInput) { U.input('Input', POPUP_TEXT[kind](data)).then((v) => cb(v === null ? '' : v)); return; }
      cursorInput(kind, data, cb);
    },
    cancel() { endInput(null); },
  };
  M.findOpenFile = (name) => { const b = name.split(/[\\/]/).pop(); const f = ed.files.find((x) => x.name === name || x.name.split(/[\\/]/).pop() === b); return f ? f.ta.value : null; };

  /* ---- assemble ------------------------------------------------------------------------------- */
  const shortName = () => (ed.cur ? ed.cur.name.split(/[\\/]/).pop() : '');
  function refreshAfterAssemble() {
    M.resetRegisters();
    if (S.startAtMain) {
      const a = M.globalSymbols.addr('main');
      if (a !== -1 && (mem.inText(a) || mem.inKText(a))) CPU.pc = a;
    }
    M.backstep.clear(); M.delayed.state = 0;
  }
  app.assemble = async function () {
    const f = ed.cur; if (!f) return;
    closeMenus();
    if (f.dirty) {
      if (f.handle) await ed.writeFile(f);
      f.dirty = false; ed.title(f); f.status = f.isNew ? ST.NEW_NOT_EDITED : ST.NOT_EDITED; ed.persist();
    }
    const name = 'Assemble';
    const list = S.assembleAll ? [f].concat(ed.files.filter((x) => x !== f)) : [f];
    const all = ed.files.map((x) => ({ name: x.name, text: x.ta.value }));
    const files = list.map((x) => ({ name: x.name, text: x.ta.value }));
    if (S.exceptionHandlerOn && S.exceptionHandler && M.exceptionHandlerText) files.push({ name: S.exceptionHandler, text: M.exceptionHandlerText });
    app.lastAssemble = { files, all };
    try {
      let announced = false;
      const announce = () => { if (!announced) { announced = true; mars(name + ': assembling ' + files.map((x) => x.name).join(', ') + '\n\n'); } };
      announce();
      const p = M.assembleFiles(files, { allFiles: all, extended: S.extended, warningsAreErrors: S.warningsAreErrors });
      if (p.errors.hasWarnings) mars(p.errors.warningReport());
      mars(name + ': operation completed successfully.\n\n');
      app.assembled = true; app.leader = f; f.assembled = true; f.status = ST.RUNNABLE;
      refreshAfterAssemble();
      app.reset = true; app.started = false;
      X.setupText(p.machine); X.resetDataView(); X.setupLabels();
      X.highlightPC();
      R.clearHighlight(); R.update();
      app.mainTabs.select(1);
      selMsg(0);
      M.resetFiles();
      if (M.tools) M.tools.notify('reset');
    } catch (e) {
      if (!e.errors) throw e;
      mars(e.errors.fullReport());
      mars(name + ': operation completed with errors.\n\n');
      selMsg(0);
      app.assembled = false; f.status = ST.NOT_EDITED;
      const first = e.errors.messages.find((m) => !(m.line === 0 && m.pos === 0) && (!m.isWarning || S.warningsAreErrors));
      if (first) {
        app.mainTabs.select(0); ed.gotoLine(first.line, first.pos, first.file);
      }
    }
    updateState();
  };

  /* ---- run -------------------------------------------------------------------------------------- */
  const lastClear = () => { CPU.lastReg = CPU.lastFp = CPU.lastC0 = -1; CPU.lastMem = null; };
  function showChanges() {
    R.update();
    if (CPU.lastReg >= 0 || CPU.lastFp >= 0 || CPU.lastC0 >= 0) R.highlight();
    if (CPU.lastMem !== null) X.showAddress(CPU.lastMem, true); else X.updateData();
    if (S.selfModifying) X.refreshSelfMod();
  }
  function fullUpdate() { flush(); R.update(); X.updateData(); if (S.selfModifying) X.refreshSelfMod(); }
  function programArgs() {
    if (!app.started && S.programArgs && X.argIn.value.trim()) { M.storeProgramArguments(X.argIn.value); }
  }
  const mustAssemble = () => U.message('Error', 'The program must be assembled before it can be run.', 'error');
  app.go = function () {
    if (!app.assembled) return mustAssemble();
    programArgs();
    if (!(app.reset || app.started)) return;
    app.started = true;
    mars('Go: running ' + shortName() + '\n\n');
    selMsg(1);
    X.unhighlight();
    lastClear();
    app.reset = false;
    sim.start({
      maxSteps: -1, breakpoints: X.sortedBreakpoints(),
      onUpdate: () => { if (sim.speed() < 40) { flush(); showChanges(); lastClear(); X.highlightPC(); } },
      onDone: (done, reason, pe) => { goDone(done, reason, pe); },
    });
    updateState();
  };
  function goDone(done, reason, pe) {
    const E = sim.REASON, name = 'Go';
    flush();
    if (!done) {
      if (reason === E.BREAKPOINT) mars(name + ': execution paused at breakpoint: ' + shortName() + '\n\n');
      else mars(name + ': execution paused by user: ' + shortName() + '\n\n');
      selMsg(0);
      X.highlightPC(); fullUpdate();
      app.reset = false; setStatus(ST.RUNNABLE);
      return;
    }
    fullUpdate();
    if (pe) { app.regTabs.select(2); X.unhighlight(); X.highlightAt((CPU.pc - 4) | 0); }
    switch (reason) {
      case E.NORMAL: mars('\n' + name + ': execution completed successfully.\n\n'); run('\n-- program is finished running --\n\n'); selMsg(1); break;
      case E.CLIFF: mars('\n' + name + ': execution terminated by null instruction.\n\n'); run('\n-- program is finished running (dropped off bottom) --\n\n'); selMsg(1); break;
      case E.EXCEPTION: mars(pe.errors.errorReport()); mars('\n' + name + ': execution terminated with errors.\n\n'); selMsg(0); break;
      case E.PAUSE_OR_STOP: mars('\n' + name + ': execution terminated by user.\n\n'); selMsg(0); break;
    }
    app.reset = false; setStatus(ST.TERMINATED);
  }
  app.step = function () {
    if (!app.assembled) return mustAssemble();
    programArgs();
    app.started = true; app.reset = false;
    selMsg(1);
    lastClear();
    sim.start({ maxSteps: 1, breakpoints: null, onDone: stepDone });
    updateState();
  };
  function stepDone(done, reason, pe) {
    const E = sim.REASON, name = 'Step';
    flush();
    showChanges();
    if (!done) { X.highlightPC(); setStatus(ST.RUNNABLE); }
    else {
      X.unhighlight(); setStatus(ST.TERMINATED);
      if (!pe) {
        const cliff = reason === E.CLIFF;
        mars('\n' + name + ': execution ' + (cliff ? 'terminated due to null instruction.' : 'completed successfully.') + '\n\n');
        run('\n-- program is finished running ' + (cliff ? '(dropped off bottom)' : '') + ' --\n\n');
        selMsg(1);
      } else {
        mars(pe.errors.errorReport()); mars('\n' + name + ': execution terminated with errors.\n\n');
        selMsg(0); app.regTabs.select(2); X.highlightAt((CPU.pc - 4) | 0);
      }
    }
    app.reset = false; lastClear(); updateState();
  }
  app.backstep = function () {
    lastClear();
    if (sim.backstep()) {
      showChanges(); X.refreshSelfMod(); X.highlightPC();
      setStatus(ST.RUNNABLE); lastClear();
    }
  };
  app.resetAction = function () {
    const la = app.lastAssemble;
    try { M.assembleFiles(la.files, { allFiles: la.all, extended: S.extended, warningsAreErrors: S.warningsAreErrors }); } catch (e) {
      mars('Unable to reset.  Please close file then re-open and re-assemble.\n'); return;
    }
    refreshAfterAssemble();
    R.clearHighlight(); R.update();
    X.clearDataHighlight(); X.setupTextKeep(); X.highlightPC();
    app.regTabs.select(0);
    app.reset = true; app.started = false;
    M.resetFiles();
    if (M.tools) M.tools.notify('reset');
    run('\nReset: reset completed.\n\n');
    setStatus(ST.RUNNABLE);
  };
  X.setupTextKeep = function () { // keeps breakpoints, restores code possibly self-modified
    for (const r of X.rows) { const st = mem.text.get(r.st.address >>> 0); if (st) { r.st = st; r.cC.textContent = M.hex8(st.binary); r.cB.textContent = M.formatBasic(st); } }
  };
  app.setAddrHex = function (v) {
    S.addrHex = v; M.saveSettings(); X.dataState.ckAddr.checked = v;
    X.refreshText(); X.updateData(); X.updateDataHeads(); X.fillCombo(); X.setupLabels(); R.update();
  };
  app.setValHex = function (v) {
    S.valHex = v; M.saveSettings(); X.dataState.ckVal.checked = v;
    X.refreshText(); X.updateData(); R.update();
  };

  /* ---- keyboard ------------------------------------------------------------------------------------ */
  const KEYS = { F1: 'help', F3: 'assemble', F5: 'go', F7: 'step', F8: 'backstep', F9: 'pause', F11: 'stop', F12: 'reset' };
  const CTRL = { n: 'new', o: 'open', w: 'close', s: 'save', d: 'dump', z: 'undo', y: 'redo', f: 'find', k: 'clearBp', t: 'toggleBp' };
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.dlgwrap:not(.nomodal)')) return;
    let id = null;
    if (!e.ctrlKey && !e.altKey && !e.shiftKey && KEYS[e.key]) id = KEYS[e.key];
    else if (e.ctrlKey && !e.shiftKey && !e.altKey && CTRL[e.key.toLowerCase()]) id = CTRL[e.key.toLowerCase()];
    if (id) { e.preventDefault(); if (A[id].enabled) A[id].fn(); }
    else if (e.altKey && !e.ctrlKey) {
      const m = MENUS.find((x) => x[1].toLowerCase() === e.key.toLowerCase());
      if (m) { e.preventDefault(); const el = [...document.querySelectorAll('.menu')][MENUS.indexOf(m)]; showMenu(el, m[2]); }
    } else if (e.key === 'Escape') closeMenus();
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    for (const fl of e.dataTransfer.files) ed.openText(fl.name, await fl.text());
    updateState();
  });
  window.addEventListener('beforeunload', (e) => { if (ed.files.some((f) => f.dirty && f.handle)) e.preventDefault(); });

  build();
  // files restored before the window was built keep their status
  for (const f of ed.files) { if (f.status > ST.EDITED) f.status = ST.NOT_EDITED; }
  M.resetRegisters(); R.update(); X.updateData();
  updateState();
})();
