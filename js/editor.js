/* MARS web - source editor (Edit tab). Syntax colours follow SyntaxUtilities.getDefaultSyntaxStyles
   and MIPSTokenMarker from the original jEdit-based editor. */
(function () {
  const M = globalThis.MARS, U = M.ui, S = M.settings, h = U.h;
  const LH = 15;
  const REGS = new Set(M.cpu.NAMES);
  for (let i = 0; i < 32; i++) { REGS.add('$' + i); REGS.add('$f' + i); }
  const DIRS = new Set(M.directives.map((d) => d[0]));
  const lineCache = new Map();
  function colorLine(line) {
    let r = lineCache.get(line);
    if (r !== undefined) return r;
    r = ''; let i = 0, first = true;
    const re = /#.*|"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|[\p{L}\p{Nd}_.$%]+:?/gu;
    let m;
    while ((m = re.exec(line))) {
      const t = m[0];
      r += U.esc(line.slice(i, m.index)); i = m.index + t.length;
      let c = null;
      if (t[0] === '#') c = 'c';
      else if (t[0] === '"' || t[0] === "'") c = 's';
      else if (t.endsWith(':') && first) { c = 'l'; }
      else {
        const w = t.endsWith(':') ? t.slice(0, -1) : t;
        if (w[0] === '$') c = REGS.has(w) ? 'r' : null;
        else if (w[0] === '%' && w.length > 1) c = 'm';
        else if (w[0] === '.') c = DIRS.has(w.toLowerCase()) ? 'd' : M.instByName.has(w.toLowerCase()) ? 'o' : null;
        else if (M.instByName.has(w.toLowerCase())) c = 'o';
        first = false;
      }
      if (!(t.endsWith(':') && first)) first = false;
      r += c ? `<span class="tk-${c}">${U.esc(t)}</span>` : U.esc(t);
    }
    r += U.esc(line.slice(i));
    if (lineCache.size > 20000) lineCache.clear();
    lineCache.set(line, r);
    return r;
  }

  const ST = (M.FileStatus = { NO_FILE: 0, NEW_NOT_EDITED: 1, NEW_EDITED: 2, NOT_EDITED: 3, EDITED: 4, RUNNABLE: 5, RUNNING: 6, TERMINATED: 7 });

  const ed = (M.editor = {
    files: [], cur: null, counter: 0,
    tabsEl: null, bodyEl: null, onChange: () => {}, caretEl: null,
    init(host) {
      this.tabsEl = h('div', { class: 'tabs' });
      this.bodyEl = h('div', { id: 'editBody' });
      const lnCk = U.checkbox('Show Line Numbers', S.lineNumbers, (v) => { S.lineNumbers = v; M.saveSettings(); this.files.forEach((f) => this.gutter(f)); }, 'If checked, will display line number for each line of text.');
      this.lnCk = lnCk;
      this.caretEl = h('span', { id: 'caretPos' });
      this.info = h('div', { id: 'editInfo', style: 'visibility:hidden' }, this.caretEl, lnCk.el);
      this.host = h('div', { id: 'editTabs' }, this.tabsEl, this.bodyEl, this.info);
      host.append(this.host);
      this.restore();
    },
    restore() {
      try {
        const saved = JSON.parse(localStorage.getItem('mars.files') || '[]');
        for (const f of saved) this.add(f.name, f.text, f.saved ? ST.NOT_EDITED : (f.text.length ? ST.NEW_EDITED : ST.NEW_NOT_EDITED), f.dirty);
        const c = +localStorage.getItem('mars.counter'); if (c) this.counter = c;
        if (this.files.length) this.select(this.files[Math.min(+localStorage.getItem('mars.curfile') || 0, this.files.length - 1)]);
      } catch (e) { /* ignore */ }
    },
    persist() {
      clearTimeout(this.pt);
      this.pt = setTimeout(() => {
        try {
          localStorage.setItem('mars.files', JSON.stringify(this.files.map((f) => ({ name: f.name, text: f.ta.value, saved: !f.isNew, dirty: f.dirty }))));
          localStorage.setItem('mars.counter', this.counter);
          localStorage.setItem('mars.curfile', this.files.indexOf(this.cur));
        } catch (e) { /* quota */ }
      }, 300);
    },
    add(name, text, status, dirty) {
      const ta = h('textarea', { spellcheck: 'false', wrap: 'off', autocapitalize: 'off', autocomplete: 'off' });
      ta.value = text;
      const pre = h('pre'), cl = h('div', { class: 'curline' }), gut = h('div', { class: 'gutter' });
      const scroller = h('div', { class: 'scroller' }, cl, ta, pre);
      const root = h('div', { class: 'ed', style: 'display:none' }, gut, scroller);
      const tab = h('div', { class: 'tab' }, h('span'));
      const f = { name, ta, pre, cl, gut, root, tab, status, dirty: !!dirty, isNew: status === ST.NEW_NOT_EDITED || status === ST.NEW_EDITED, undo: [], redo: [], last: { v: text, s: 0 }, handle: null, assembled: false };
      tab.addEventListener('mousedown', () => this.select(f));
      this.tabsEl.append(tab); this.bodyEl.append(root); this.files.push(f);
      ta.addEventListener('input', () => this.edited(f));
      ta.addEventListener('scroll', () => this.sync(f));
      for (const ev of ['keyup', 'click', 'select', 'focus']) ta.addEventListener(ev, () => this.caret(f));
      ta.addEventListener('keydown', (e) => this.keydown(f, e));
      ta.addEventListener('blur', () => setTimeout(() => this.guideHide(), 150));
      this.render(f); this.title(f);
      return f;
    },
    title(f) { f.tab.firstChild.textContent = f.name.split(/[\\/]/).pop() + (f.dirty ? ' *' : ''); f.tab.dataset.tip = f.name; },
    gutter(f) {
      const n = f.ta.value.split('\n').length, on = S.lineNumbers;
      f.gut.classList.toggle('off', !on);
      if (!on) return;
      if (f.gn === n) return;
      f.gn = n; const d = String(n).length; let s = '';
      for (let i = 1; i <= n; i++) s += String(i).padStart(d, ' ') + ' \n';
      f.gut.textContent = s + '\n\n\n';
    },
    render(f) {
      f.pre.innerHTML = f.ta.value.split('\n').map(colorLine).join('\n') + '\n';
      f.pre.style.font = this.font();
      f.ta.style.font = this.font();
      f.ta.style.tabSize = S.tabSize; f.pre.style.tabSize = S.tabSize;
      this.gutter(f); this.sync(f);
    },
    font() {
      const fam = S.editorFontFamily === 'Monospaced' ? 'var(--mono)' : `"${S.editorFontFamily}"`;
      const st = S.editorFontStyle || 'Plain';
      return `${/Italic/.test(st) ? 'italic ' : ''}${/Bold/.test(st) ? 'bold ' : ''}${S.editorFontSize}px/${Math.round(S.editorFontSize * 1.25)}px ${fam}`;
    },
    refreshAll() { this.files.forEach((f) => { f.gut.style.font = this.font(); this.render(f); this.caret(f); }); },
    sync(f) {
      const x = f.ta.scrollLeft, y = f.ta.scrollTop;
      f.pre.style.transform = `translate(${-x}px,${-y}px)`;
      f.gut.scrollTop = y;
      this.line(f);
    },
    lineH() { return Math.round(S.editorFontSize * 1.25); },
    line(f) {
      const ln = f.ta.value.slice(0, f.ta.selectionStart).split('\n').length;
      f.cl.style.display = S.currentLine ? 'block' : 'none';
      f.cl.style.height = this.lineH() + 'px';
      f.cl.style.top = (ln - 1) * this.lineH() - f.ta.scrollTop + 'px';
    },
    caret(f) {
      if (f !== this.cur) return;
      const before = f.ta.value.slice(0, f.ta.selectionStart).split('\n');
      this.caretEl.textContent = 'Line: ' + before.length + ' Column: ' + (before[before.length - 1].length + 1);
      this.line(f);
      if (document.activeElement === f.ta) this.persist();
    },
    edited(f, noUndo) {
      if (!noUndo) this.pushUndo(f);
      if (!f.dirty) { f.dirty = true; this.title(f); }
      if (f.status === ST.NEW_NOT_EDITED) f.status = ST.NEW_EDITED;
      else if (f.status !== ST.NEW_EDITED) f.status = ST.EDITED;
      f.assembled = false;
      this.render(f); this.caret(f); this.persist();
      this.onChange(f);
      this.guide(f);
    },
    pushUndo(f) {
      const now = Date.now(), val = f.ta.value;
      if (!(f.lastT && now - f.lastT < 600 && f.undo.length)) f.undo.push(f.last);
      if (f.undo.length > 500) f.undo.shift();
      f.redo = []; f.lastT = now; f.last = { v: val, s: f.ta.selectionStart };
    },
    undo() {
      const f = this.cur; if (!f || !f.undo.length) return;
      f.redo.push({ v: f.ta.value, s: f.ta.selectionStart });
      const st = f.undo.pop(); this.setState(f, st);
    },
    redo() {
      const f = this.cur; if (!f || !f.redo.length) return;
      f.undo.push({ v: f.ta.value, s: f.ta.selectionStart });
      const st = f.redo.pop(); this.setState(f, st);
    },
    setState(f, st) { f.ta.value = st.v; f.ta.selectionStart = f.ta.selectionEnd = st.s; f.last = st; f.lastT = 0; this.edited(f, true); },
    canUndo() { return !!(this.cur && this.cur.undo.length); },
    canRedo() { return !!(this.cur && this.cur.redo.length); },
    insert(f, text) {
      const a = f.ta.selectionStart, b = f.ta.selectionEnd;
      f.ta.setRangeText(text, a, b, 'end');
      this.edited(f);
    },
    keydown(f, e) {
      const g = this.guideEl();
      if (g.style.display === 'block') {
        const items = [...g.children]; let i = items.findIndex((x) => x.classList.contains('on'));
        if (e.key === 'ArrowDown') { e.preventDefault(); i = Math.min(items.length - 1, i + 1); this.guideSel(items, i); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); i = Math.max(0, i - 1); this.guideSel(items, i); return; }
        if (e.key === 'Escape') { e.preventDefault(); this.guideHide(); return; }
        if ((e.key === 'Enter' || e.key === 'Tab') && i >= 0) { e.preventDefault(); this.guideAccept(f, items[i].dataset.ex); return; }
      }
      if (e.key === 'Tab') { e.preventDefault(); this.insert(f, '\t'); }
      else if (e.key === 'Enter' && S.autoIndent) {
        e.preventDefault();
        const v = f.ta.value, p = f.ta.selectionStart, ls = v.lastIndexOf('\n', p - 1) + 1;
        const ws = v.slice(ls, p).match(/^[ \t]*/)[0];
        this.insert(f, '\n' + ws);
        this.ensureVisible(f);
      }
    },
    ensureVisible(f) {
      const ln = f.ta.value.slice(0, f.ta.selectionStart).split('\n').length, y = (ln - 1) * this.lineH(), H = f.ta.clientHeight;
      if (y < f.ta.scrollTop) f.ta.scrollTop = y;
      else if (y + this.lineH() > f.ta.scrollTop + H) f.ta.scrollTop = y + this.lineH() - H;
    },
    /* instruction guide popup --------------------------------------------- */
    guideEl() { return document.getElementById('guide'); },
    guideHide() { this.guideEl().style.display = 'none'; },
    guideSel(items, i) { items.forEach((x, k) => x.classList.toggle('on', k === i)); if (items[i]) items[i].scrollIntoView({ block: 'nearest' }); },
    guideAccept(f, ex) {
      const v = f.ta.value, p = f.ta.selectionStart;
      const m = v.slice(0, p).match(/[\p{L}\p{Nd}_.]+$/u);
      const word = m ? m[0] : '', op = ex.split(' ')[0];
      f.ta.setRangeText(op + ' ', p - word.length, p, 'end');
      this.guideHide(); this.edited(f); this.guideHide();
    },
    guide(f) {
      if (!S.popupGuidance || document.activeElement !== f.ta) { this.guideHide(); return; }
      const v = f.ta.value, p = f.ta.selectionStart, ls = v.lastIndexOf('\n', p - 1) + 1;
      const line = v.slice(ls, p);
      const m = line.match(/^\s*(?:[\p{L}_][\p{L}\p{Nd}_.$]*:\s*)?([\p{L}.][\p{L}\p{Nd}_.]*)$/u);
      if (!m || m[1].length < S.popupPrefix || (p < v.length && !/\s/.test(v[p]))) { this.guideHide(); return; }
      const w = m[1].toLowerCase();
      let items;
      if (w[0] === '.') items = M.directives.filter((d) => d[0].startsWith(w)).map((d) => [d[0], d[1]]);
      else items = M.prefixMatch(w).map((i) => [i.example, (i.basic ? '' : '') + i.desc]);
      if (!items.length) { this.guideHide(); return; }
      const g = this.guideEl(); g.innerHTML = '';
      const pad = Math.max(...items.map((x) => x[0].length));
      for (const [ex, d] of items) {
        const it = h('div', { 'data-ex': ex, onmousedown: (e) => { e.preventDefault(); this.guideAccept(f, ex); } }, ex.padEnd(pad + 2) + d);
        g.append(it);
      }
      const ln = v.slice(0, p).split('\n').length, r = f.ta.getBoundingClientRect();
      g.style.display = 'block';
      const x = r.left + Math.min(line.length * 7.2 - f.ta.scrollLeft, r.width - 320);
      let y = r.top + ln * this.lineH() - f.ta.scrollTop + 2;
      if (y + g.offsetHeight > innerHeight - 4) y = r.top + (ln - 1) * this.lineH() - f.ta.scrollTop - g.offsetHeight - 2;
      g.style.left = Math.max(0, Math.min(x, innerWidth - g.offsetWidth - 4)) + 'px';
      g.style.top = y + 'px';
    },
    /* files ------------------------------------------------------------------ */
    select(f) {
      if (this.cur) { this.cur.root.style.display = 'none'; this.cur.tab.classList.remove('sel'); }
      this.cur = f;
      if (f) {
        f.root.style.display = 'flex'; f.tab.classList.add('sel');
        this.info.style.visibility = 'visible'; this.caret(f); this.sync(f);
        setTimeout(() => f.ta.focus(), 0);
      } else { this.info.style.visibility = 'hidden'; this.caretEl.textContent = ''; }
      this.persist();
      this.onSwitch(f);
    },
    onSwitch() {},
    newFile() {
      this.counter++;
      const f = this.add('mips' + this.counter + '.asm', '', ST.NEW_NOT_EDITED);
      this.select(f); return f;
    },
    openText(name, text, handle) {
      const ex = this.files.find((x) => x.name === name);
      if (ex) { this.select(ex); return ex; }
      if (this.cur && this.cur.status === ST.NEW_NOT_EDITED && this.files.length === 1) this.remove(this.cur);
      const f = this.add(name, text.replace(/\r\n?/g, '\n'), ST.NOT_EDITED); f.handle = handle || null;
      this.select(f); return f;
    },
    async open() {
      if (globalThis.showOpenFilePicker) {
        try {
          const [hd] = await showOpenFilePicker({ types: [{ description: 'Assembler Files (*.asm; *.s)', accept: { 'text/plain': ['.asm', '.s'] } }], excludeAcceptAllOption: false });
          const file = await hd.getFile();
          return this.openText(file.name, await file.text(), hd);
        } catch (e) { if (e.name === 'AbortError') return null; }
      }
      return new Promise((res) => {
        const i = h('input', { type: 'file', accept: '.asm,.s,.txt', onchange: async () => { const fl = i.files[0]; if (fl) res(this.openText(fl.name, await fl.text())); else res(null); } });
        i.click();
      });
    },
    async writeFile(f) {
      if (f.handle) {
        try { const w = await f.handle.createWritable(); await w.write(f.ta.value); await w.close(); return true; } catch (e) { if (e.name === 'AbortError') return false; }
      }
      const a = h('a', { href: URL.createObjectURL(new Blob([f.ta.value], { type: 'text/plain' })), download: f.name.split(/[\\/]/).pop() });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return true;
    },
    markSaved(f) {
      f.dirty = false; f.isNew = false; f.status = ST.NOT_EDITED; f.assembled = false;
      this.title(f); this.persist(); this.onChange(f);
    },
    async save(f) {
      f = f || this.cur; if (!f) return false;
      if (f.isNew || !f.handle) return this.saveAs(f);
      if (await this.writeFile(f)) { this.markSaved(f); return true; }
      return false;
    },
    async saveAs(f) {
      f = f || this.cur; if (!f) return false;
      if (globalThis.showSaveFilePicker) {
        try {
          const hd = await showSaveFilePicker({ suggestedName: f.name.split(/[\\/]/).pop(), types: [{ description: 'Assembler Files (*.asm; *.s)', accept: { 'text/plain': ['.asm', '.s'] } }] });
          f.handle = hd; f.name = hd.name;
          await this.writeFile(f); this.markSaved(f); return true;
        } catch (e) { if (e.name === 'AbortError') return false; }
      }
      const nm = await U.input('Save As', 'File name:');
      if (!nm) return false;
      f.name = nm; f.handle = null;
      await this.writeFile(f); this.markSaved(f); return true;
    },
    async saveAll() { for (const f of this.files) if (f.dirty) await this.save(f); },
    remove(f) {
      const i = this.files.indexOf(f);
      this.files.splice(i, 1); f.tab.remove(); f.root.remove();
      if (this.cur === f) { this.cur = null; this.select(this.files[Math.min(i, this.files.length - 1)] || null); }
      this.persist();
    },
    async close(f) {
      f = f || this.cur; if (!f) return true;
      if (f.dirty) {
        this.select(f);
        const r = await U.confirm('Save program changes?', 'Changes to ' + f.name + ' will be lost unless you save.  Do you wish to save all changes now?');
        if (r === 2 || r === -1) return false;
        if (r === 0 && !(await this.save(f))) return false;
      }
      this.remove(f);
      return true;
    },
    async closeAll() {
      for (const f of [...this.files]) if (!(await this.close(f))) return false;
      return true;
    },
    gotoLine(line, col, name) {
      let f = this.cur;
      if (name) { const g = this.files.find((x) => x.name === name); if (g) { if (g !== f) this.select(g); f = g; } }
      if (!f) return;
      const lines = f.ta.value.split('\n'); let p = 0;
      const n = Math.min(line, lines.length);
      for (let i = 0; i < n - 1; i++) p += lines[i].length + 1;
      p += Math.max(0, (col || 1) - 1);
      const e = p + (lines[n - 1] ? lines[n - 1].length - Math.max(0, (col || 1) - 1) : 0);
      f.ta.focus();
      f.ta.selectionStart = col ? p : p; f.ta.selectionEnd = col ? p : e;
      f.ta.scrollTop = Math.max(0, (n - 1) * this.lineH() - f.ta.clientHeight / 2);
      this.caret(f);
    },
    find(text, opts) {
      const f = this.cur; if (!f || !text) return false;
      const cs = opts.cs, v = cs ? f.ta.value : f.ta.value.toLowerCase(), q = cs ? text : text.toLowerCase();
      let i = v.indexOf(q, f.ta.selectionEnd);
      if (i < 0) i = v.indexOf(q);
      if (i < 0) return false;
      f.ta.focus(); f.ta.setSelectionRange(i, i + q.length);
      f.ta.scrollTop = Math.max(0, (v.slice(0, i).split('\n').length - 1) * this.lineH() - f.ta.clientHeight / 2);
      this.caret(f); return true;
    },
    replace(text, rep, opts) {
      const f = this.cur; if (!f) return false;
      const sel = f.ta.value.slice(f.ta.selectionStart, f.ta.selectionEnd);
      if (sel && (opts.cs ? sel === text : sel.toLowerCase() === text.toLowerCase())) this.insert(f, rep);
      return this.find(text, opts);
    },
    replaceAll(text, rep, opts) {
      const f = this.cur; if (!f || !text) return 0;
      const re = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.cs ? 'g' : 'gi');
      let n = 0; const out = f.ta.value.replace(re, () => { n++; return rep; });
      if (n) { f.ta.value = out; this.edited(f); }
      return n;
    },
  });
})();
