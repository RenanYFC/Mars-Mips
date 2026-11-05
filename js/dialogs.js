/* MARS web - modal dialogs: Find/Replace, Settings, Dump Memory, Print, Help, About. */
(function () {
  const M = globalThis.MARS, U = M.ui, S = M.settings, h = U.h, mem = M.mem, ed = M.editor;
  const D = (M.dialogs = {});

  D.about = () => U.message('About Mars',
    'MARS 4.5    Copyright 2003-2014\nPete Sanderson and Kenneth Vollmar\n\nMARS is the Mips Assembler and Runtime Simulator.\n\n' +
    'Mars image courtesy of NASA/JPL.\nToolbar and menu icons are from:\n  *  Tango Desktop Project (tango.freedesktop.org),\n  *  glyFX (www.glyfx.com) Common Toolbar Set,\n' +
    '  *  KDE-Look (www.kde-look.org) crystalline-blue-0.1,\n  *  Icon-King (www.icon-king.com) Nuvola 1.0.\nPrint feature adapted from HardcopyWriter class in David Flanagan\'s\nJava Examples in a Nutshell 3rd Edition, O\'Reilly, ISBN 0-596-00620-9.',
    'images/RedMars50.gif');

  /* Find / Replace ----------------------------------------------------------------- */
  let findText = '', caseS = true, findDlg = null;
  D.find = function () {
    if (findDlg) return;
    const f = h('input', { class: 'tf', style: 'width:260px', value: findText, tip: 'Find what:' });
    const r = h('input', { class: 'tf', style: 'width:260px' });
    const cs = U.checkbox('Case Sensitive', caseS, (v) => { caseS = v; });
    const out = h('span', { tip: 'Outcome of latest operation (button click)', style: 'display:block;min-height:16px' }, '');
    const opt = () => ({ cs: cs.checked });
    const body = h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
      h('div', { class: 'field', style: 'grid-template-columns:auto 1fr' }, 'Find what:', f, 'Replace with:', r),
      h('div', { style: 'display:flex;gap:16px;align-items:center' }, cs.el, h('div', { class: 'tbord', style: 'flex:1' }, h('span', { class: 'lg' }, 'Outcome'), out)));
    const doFind = () => { findText = f.value; if (!f.value) { out.textContent = 'No text to find'; return true; } out.textContent = ed.find(f.value, opt()) ? 'Text found' : 'Text not found'; return true; };
    const doRep = () => { if (!f.value) { out.textContent = 'No text to find'; return true; } out.textContent = ed.replace(f.value, r.value, opt()) ? 'Text replaced and found next' : 'Text replaced; last occurrence'; return true; };
    const doAll = () => { if (!f.value) { out.textContent = 'No text to find'; return true; } out.textContent = 'Replace all: Replaced ' + ed.replaceAll(f.value, r.value, opt()) + ' occurrences'; return true; };
    findDlg = U.dialog('Find and Replace', body, [{ label: 'Find', fn: doFind }, { label: 'Replace then Find', fn: doRep }, { label: 'Replace all', fn: doAll }, { label: 'Close' }], { modal: false, onClose: () => { findDlg = null; findText = f.value; } });
    setTimeout(() => f.focus(), 0);
  };

  /* Print ---------------------------------------------------------------------------- */
  D.print = function () {
    const f = ed.cur; if (!f) return;
    const a = h('div', { id: 'printArea' });
    a.textContent = f.ta.value.split('\n').map((l, i) => String(i + 1).padStart(4, ' ') + ' ' + l).join('\n');
    document.body.append(a); window.print(); a.remove();
  };

  /* Editor settings --------------------------------------------------------------------- */
  D.editorSettings = function () {
    const size = h('input', { class: 'tf', type: 'number', min: 6, max: 72, value: S.editorFontSize, style: 'width:60px' });
    const fam = h('select', { class: 'combo' }, ['Monospaced', 'Courier New', 'Consolas', 'Lucida Console'].map((x) => h('option', { value: x, selected: x === S.editorFontFamily }, x)));
    const sty = h('select', { class: 'combo' }, ['Plain', 'Bold', 'Italic', 'Bold + Italic'].map((x) => h('option', { value: x, selected: x === S.editorFontStyle }, x)));
    const tab = h('input', { class: 'tf', type: 'number', min: 1, max: 32, value: S.tabSize, style: 'width:60px' });
    const hl = U.checkbox('Highlight the line currently being edited', S.currentLine);
    const ai = U.checkbox('Auto-Indent', S.autoIndent);
    const ln = h('select', { class: 'combo' });
    [['No popup instruction or directive guide', 0], ['Display instruction guide after 1 letter typed', 1], ['Display instruction guide after 2 letters typed', 2]].forEach(([t, v]) =>
      ln.append(h('option', { value: v, selected: (S.popupGuidance ? S.popupPrefix : 0) === v }, t)));
    const apply = () => {
      S.editorFontSize = +size.value || 12; S.editorFontFamily = fam.value; S.editorFontStyle = sty.value; S.tabSize = +tab.value || 8;
      S.currentLine = hl.checked; S.autoIndent = ai.checked; S.popupGuidance = +ln.value > 0; if (+ln.value) S.popupPrefix = +ln.value;
      M.saveSettings(); ed.refreshAll();
    };
    const body = h('div', { style: 'display:flex;flex-direction:column;gap:10px;min-width:420px' },
      h('div', { class: 'tbord' }, h('span', { class: 'lg' }, 'Editor Font'), h('div', { style: 'display:flex;gap:8px;align-items:center' }, fam, sty, size)),
      h('div', { class: 'tbord', style: 'display:flex;flex-direction:column;gap:6px' }, h('span', { class: 'lg' }, 'Style'), hl.el, ai.el,
        h('div', { style: 'display:flex;gap:8px;align-items:center' }, 'Tab Size', tab)),
      h('div', { class: 'tbord' }, h('span', { class: 'lg' }, 'Popup Instruction Guide'), ln));
    U.dialog('Text Editor Settings', body, [{ label: 'Apply and Close', fn: apply }, { label: 'Apply', fn: () => { apply(); return true; } }, { label: 'Cancel' }]);
  };

  /* Highlighting ------------------------------------------------------------------------- */
  D.highlighting = function () {
    const rows = [['Text Segment highlighting', 'textHlBg', 'textHlFg'], ['Text Segment Delay Slot highlighting', 'delayHlBg', 'delayHlFg'],
      ['Data Segment highlighting *', 'dataHlBg', 'dataHlFg'], ['Register highlighting *', 'regHlBg', 'regHlFg'], ['Even row normal', 'evenBg', 'evenFg'], ['Odd row normal', 'oddBg', 'oddFg']];
    const dhl = U.checkbox('Data Segment highlighting enabled', S.dataHighlight), rhl = U.checkbox('Register highlighting enabled', S.regHighlight);
    const grid = h('div', { style: 'display:grid;grid-template-columns:auto auto auto auto;gap:5px 10px;align-items:center' });
    grid.append(h('span'), h('span', null, 'Background'), h('span', null, 'Text'), h('span', null, 'Sample'));
    const inputs = [];
    for (const [t, b, f] of rows) {
      const cb = h('input', { type: 'color', value: S[b], tip: 'Click, to select background color' }), cf = h('input', { type: 'color', value: S[f], tip: 'Click, to select text color' });
      const sm = h('span', { style: `font:12px var(--mono);padding:1px 4px;background:${S[b]};color:${S[f]}`, tip: 'Preview based on background and text color settings' }, '0x10010000');
      const upd = () => { sm.style.background = cb.value; sm.style.color = cf.value; };
      cb.addEventListener('input', upd); cf.addEventListener('input', upd);
      grid.append(h('span', { style: 'text-align:right' }, t), cb, cf, sm); inputs.push([b, f, cb, cf, upd]);
    }
    const apply = () => {
      for (const [b, f, cb, cf] of inputs) { S[b] = cb.value; S[f] = cf.value; }
      S.dataHighlight = dhl.checked; S.regHighlight = rhl.checked; M.saveSettings(); M.exec.syncRowColors(); M.exec.updateData();
    };
    const reset = () => { for (const [b, f, cb, cf, u] of inputs) { cb.value = M.defaultSettings[b]; cf.value = M.defaultSettings[f]; u(); } return true; };
    U.dialog('Runtime Table Highlighting Colors and Fonts', h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, grid, dhl.el, rhl.el, h('span', null, '* = disabled when run at maximum speed')),
      [{ label: 'Apply and Close', fn: apply }, { label: 'Apply', fn: () => { apply(); return true; } }, { label: 'Reset', fn: reset }, { label: 'Cancel' }]);
  };

  /* Exception handler --------------------------------------------------------------------- */
  D.exceptionHandler = function () {
    const c = U.checkbox('Include this exception handler file in all assemble operations', S.exceptionHandlerOn);
    const p = h('input', { class: 'tf', style: 'flex:1;min-width:280px', value: S.exceptionHandler, readonly: true });
    const pick = () => {
      const i = h('input', { type: 'file', accept: '.asm,.s', onchange: async () => { const fl = i.files[0]; if (fl) { M.exceptionHandlerText = await fl.text(); p.value = fl.name; } } });
      i.click();
    };
    M.exceptionHandlerText = M.exceptionHandlerText || localStorage.getItem('mars.exh') || '';
    U.dialog('Exception Handler', h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, c.el, h('div', { style: 'display:flex;gap:6px' }, h('button', { class: 'btn', onclick: pick }, 'Browse'), p)),
      [{ label: 'OK', fn: () => { S.exceptionHandlerOn = c.checked; S.exceptionHandler = p.value; M.saveSettings(); try { localStorage.setItem('mars.exh', M.exceptionHandlerText || ''); } catch (e) { /* quota */ } } }, { label: 'Cancel' }]);
  };

  /* Memory configuration ------------------------------------------------------------------- */
  D.memoryConfig = function () {
    let sel = S.memConfig;
    const vals = h('div', { style: 'display:grid;grid-template-columns:auto auto;gap:1px 10px' });
    const show = () => {
      vals.textContent = '';
      M.memCfgKeys.forEach((k, i) => vals.append(h('input', { class: 'tf', readonly: true, style: 'width:96px;font-family:var(--mono)', value: M.hex8(M.memConfigs[sel].v[k]) }), h('span', { style: 'font-weight:bold' }, M.memCfgNames[i])));
    };
    const radios = h('div', { style: 'display:flex;flex-direction:column;gap:4px' });
    const items = [];
    Object.keys(M.memConfigs).forEach((k) => {
      const c = U.checkbox(M.memConfigs[k].label, k === sel, () => { sel = k; items.forEach(([x, cb]) => { cb.checked = x === k; }); show(); });
      items.push([k, c]); radios.append(c.el);
    });
    show();
    const apply = () => {
      if (sel !== S.memConfig) {
        mem.setConfig(sel); M.saveSettings(); M.resetRegisters();
        M.exec.fillCombo(); M.exec.resetDataView(); M.regs.update(); M.app.invalidate(); M.exec.clearText();
        M.app.assembled = false;
      }
    };
    U.dialog('MIPS Memory Configuration', h('div', { style: 'display:flex;gap:14px' }, h('div', { class: 'tbord' }, h('span', { class: 'lg' }, 'Configuration'), radios), vals),
      [{ label: 'Apply and Close', fn: apply }, { label: 'Apply', fn: () => { apply(); return true; } }, { label: 'Cancel' }]);
  };

  /* Dump memory ------------------------------------------------------------------------------ */
  function segments() {
    const c = mem.cfg, out = [];
    const textA = [...mem.text.keys()].sort((a, b) => a - b);
    const range = (nm, base, keys) => { if (keys.length) out.push({ name: nm, lo: base, hi: keys[keys.length - 1] }); };
    range('.text', c.textBase, textA.filter((a) => a >= c.textBase && a < c.textLimit));
    range('.ktext', c.ktextBase, textA.filter((a) => a >= c.ktextBase && a < c.ktextLimit));
    const pageA = [];
    for (const [k, p] of mem.pages) for (let i = 0; i < 1024; i++) if (p[i] !== 0) pageA.push((k * 4096 + i * 4));
    pageA.sort((a, b) => a - b);
    range('.data', c.dataBase, pageA.filter((a) => a >= c.dataBase && a < c.dataSegLimit));
    range('.kdata', c.kdataBase, pageA.filter((a) => a >= c.kdataBase && a < c.kdataLimit));
    return out;
  }
  const word = (a) => (mem.isCode(a) ? mem.getWordNoNotify(a) : mem.rawWord(a));
  const ASC = (b) => (b === 0 ? '\\0' : b === 8 ? '\\b' : b === 9 ? '\\t' : b === 10 ? '\\n' : b === 11 ? '\\v' : b === 12 ? '\\f' : b === 13 ? '\\r' : b === 32 ? ' ' : b > 32 && b < 127 ? String.fromCharCode(b) : '.');
  const FORMATS = {
    'Binary': { ext: 'bin', bin(s) { const n = (s.hi - s.lo + 4) / 4, o = new Uint8Array(n * 4), v = new DataView(o.buffer); for (let i = 0; i < n; i++) v.setInt32(i * 4, word((s.lo + i * 4) | 0), true); return o; } },
    'Binary Text': { ext: 'txt', text(s) { let r = ''; for (let a = s.lo; a <= s.hi; a += 4) r += (word(a | 0) >>> 0).toString(2).padStart(32, '0') + '\n'; return r; } },
    'Hexadecimal Text': { ext: 'txt', text(s) { let r = ''; for (let a = s.lo; a <= s.hi; a += 4) r += (word(a | 0) >>> 0).toString(16).padStart(8, '0') + '\n'; return r; } },
    'ASCII Text': { ext: 'txt', text(s) { let r = ''; for (let a = s.lo; a <= s.hi; a += 4) { const w = word(a | 0); for (let i = 3; i >= 0; i--) r += ASC((w >>> (i * 8)) & 255).padStart(3, ' ') + ' '; r += '\n'; } return r; } },
    'Intel hex format': { ext: 'hex', text(s) {
      let r = ':02000004' + ((s.lo >>> 16).toString(16).padStart(4, '0')).toUpperCase() + '00\n';
      for (let a = s.lo; a <= s.hi; a += 4) {
        const w = (word(a | 0) >>> 0).toString(16).padStart(8, '0'), o = ((a - s.lo) & 0xffff).toString(16).padStart(4, '0');
        let t = '04' + o + '00' + w, c = 0;
        for (let i = 0; i < t.length; i += 2) c += parseInt(t.substr(i, 2), 16);
        r += ':' + (t + ((256 - (c & 255)) & 255).toString(16).padStart(2, '0')).toUpperCase() + '\n';
      }
      return r + ':00000001FF\n';
    } },
    'Text/Data Segment Window': { ext: 'txt', text(s) {
      let r = '';
      if (s.name.includes('text')) {
        r += 'Address     Code        Basic                     Source\n\n';
        for (let a = s.lo; a <= s.hi; a += 4) { const st = mem.text.get(a); if (st) r += M.hex8(a) + '  ' + M.hex8(st.binary) + '  ' + M.formatBasic(st).padEnd(24) + (st.source ? '  ' + st.sourceLine + ': ' + st.source : '') + '\n'; }
      } else for (let a = s.lo; a <= s.hi; a += 32) {
        r += M.hex8(a); for (let i = 0; i < 8; i++) r += '    ' + M.hex8(word((a + i * 4) | 0)); r += '\n';
      }
      return r;
    } },
  };
  D.dump = function () {
    const segs = segments();
    if (!segs.length) return U.dialog('Dump Memory To File', 'There is nothing to dump!', [{ label: 'OK' }]);
    const sel = h('select', { class: 'combo' }, segs.map((s, i) => h('option', { value: i }, s.name + ' (' + M.hex8(s.lo) + ' - ' + M.hex8(s.hi) + ')')));
    const fmt = h('select', { class: 'combo' }, Object.keys(FORMATS).map((k) => h('option', null, k)));
    const go = () => {
      const s = segs[+sel.value], F = FORMATS[fmt.value];
      const content = F.bin ? F.bin(s) : F.text(s);
      const a = h('a', { href: URL.createObjectURL(new Blob([content])), download: (ed.cur ? ed.cur.name.replace(/\.\w+$/, '') : 'mars') + '.' + s.name.slice(1) + '.' + F.ext });
      a.click();
    };
    U.dialog('Dump Memory To File', h('div', { style: 'display:flex;gap:16px' }, h('div', { style: 'display:flex;flex-direction:column;gap:4px' }, 'Memory Segment', sel), h('div', { style: 'display:flex;flex-direction:column;gap:4px' }, 'Dump Format', fmt)),
      [{ label: 'Dump To File...', fn: go }, { label: 'Cancel' }]);
  };

  /* Help --------------------------------------------------------------------------------------- */
  const grid = (rows) => { const g = h('div', { class: 'helpgrid' }); rows.forEach((r) => g.append(h('div', null, r))); return g; };
  function htmlPage(file) { return () => h('iframe', { class: 'help', src: 'help/' + file }); }
  function instPanel(basic) {
    return () => {
      const list = M.instructions.filter((i) => i.basic === basic).slice().sort((a, b) => (a.example < b.example ? -1 : 1));
      const w = Math.max(...list.map((i) => i.example.length));
      const box = h('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0;gap:4px' });
      if (basic) box.append(h('div', { class: 'helpnote', style: 'white-space:pre;font:12px var(--mono)' },
        'Operand Key for Example Instructions\n$t1, $t2, $t3   any integer register\n$f2, $f4, $f6   even-numbered floating point register\n$f0, $f1, $f3   any floating point register\n$8              any Coprocessor 0 register\n1               condition flag (0 to 7)\n10              unsigned 5-bit integer (0 to 31)\n-100            signed 16-bit integer (-32768 to 32767)\n100             unsigned 16-bit integer (0 to 65535)\n100000          signed 32-bit integer\nlabel, target   any textual label'));
      box.append(grid(list.map((i) => i.example.padEnd(w + 2) + i.desc)));
      return box;
    };
  }
  const subTabs = (defs) => {
    const host = h('div', { style: 'flex:1;min-height:0;display:flex' });
    const pages = defs.map(() => h('div', { class: 'page' }));
    const made = new Set();
    const api = U.tabbed(host, defs.map((d, i) => ({ title: d[0], page: pages[i] })), (i) => { if (!made.has(i)) { made.add(i); pages[i].append(defs[i][1]()); } });
    host.style.flexDirection = 'column';
    return host;
  };
  let helpDlg = null;
  D.help = function () {
    if (helpDlg) return;
    const mips = () => subTabs([['Basic Instructions', instPanel(true)], ['Extended (pseudo) Instructions', instPanel(false)],
      ['Directives', () => grid(M.directives.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)).map((d) => d[0].padEnd(16) + d[1]))],
      ['Syscalls', htmlPage('SyscallHelp.html')], ['Exceptions', htmlPage('ExceptionsHelp.html')], ['Macros', htmlPage('MacrosHelp.html')]]);
    const mars = () => subTabs([['Intro', htmlPage('MarsHelpIntro.html')], ['IDE', htmlPage('MarsHelpIDE.html')], ['Debugging', htmlPage('MarsHelpDebugging.html')], ['Settings', htmlPage('MarsHelpSettings.html')],
      ['Tools', htmlPage('MarsHelpTools.html')], ['Command', htmlPage('MarsHelpCommand.html')], ['Limits', htmlPage('MarsHelpLimits.html')], ['History', htmlPage('MarsHelpHistory.html')]]);
    const lic = () => { const g = h('div', { class: 'helpgrid', style: 'padding:6px' }); fetch('LICENSE-MARS.txt').then((r) => r.text()).then((t) => { g.textContent = t; }); return g; };
    const top = subTabs([['MIPS', mips], ['MARS', mars], ['License', lic], ['Bugs/Comments', htmlPage('BugReportingHelp.html')], ['Acknowledgements', htmlPage('Acknowledgements.html')], ['Instruction Set Song', htmlPage('MIPSInstructionSetSong.html')]]);
    const W = Math.min(innerWidth * 0.75, 1000), H = Math.min(innerHeight * 0.85, 720);
    helpDlg = U.dialog('MARS 4.5 Help', top, [{ label: 'Close' }], { modal: false, noEnter: true, style: `width:${W}px;height:${H}px`, bodyStyle: 'padding:4px;display:flex', onClose: () => { helpDlg = null; } });
  };
})();
