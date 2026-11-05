/* MARS web - small Swing-like widgets: DOM builder, tooltips, tabs, split panes, dialogs. */
(function () {
  const M = globalThis.MARS;
  const U = (M.ui = {});
  const h = (U.h = function (tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k === 'tip') e.dataset.tip = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined) e.append(c);
    return e;
  });
  U.esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* tooltips (Swing ToolTipManager: 750 ms) ---------------------------------------- */
  let tipT = null, tipEl = null;
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t === tipEl) return;
    tipEl = t; clearTimeout(tipT);
    const tip = document.getElementById('tip');
    tip.style.display = 'none';
    if (!t || !t.dataset.tip) return;
    const x = e.clientX, y = e.clientY;
    tipT = setTimeout(() => {
      tip.textContent = t.dataset.tip; tip.style.display = 'block';
      const w = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(innerWidth - w - 4, x + 2)) + 'px';
      tip.style.top = Math.min(innerHeight - 22, y + 20) + 'px';
    }, 750);
  });
  document.addEventListener('mousedown', () => { clearTimeout(tipT); document.getElementById('tip').style.display = 'none'; tipEl = null; });

  /* check box ------------------------------------------------------------------------ */
  U.checkbox = function (label, checked, onchange, tip) {
    const box = h('span', { class: 'b' });
    const el = h('label', { class: 'ck' + (checked ? ' c' : ''), tip }, box, label);
    const api = {
      el, get checked() { return el.classList.contains('c'); },
      set checked(v) { el.classList.toggle('c', !!v); },
      set disabled(v) { el.classList.toggle('dis', !!v); },
    };
    el.addEventListener('click', (e) => { e.preventDefault(); if (el.classList.contains('dis')) return; api.checked = !api.checked; if (onchange) onchange(api.checked); });
    return api;
  };

  /* tabbed pane ----------------------------------------------------------------------- */
  U.tabbed = function (host, items, onselect) {
    const tabs = h('div', { class: 'tabs' }), body = h('div', { class: 'tabbody frame' });
    host.classList.add('tabbed'); host.append(tabs, body);
    const api = { tabs: [], selected: 0, select(i) {
      api.selected = i;
      api.tabs.forEach((t, k) => { t.tab.classList.toggle('sel', k === i); t.page.classList.toggle('sel', k === i); });
      if (onselect) onselect(i);
    } };
    items.forEach((it, i) => {
      const tab = h('div', { class: 'tab', tip: it.tip, onmousedown: () => api.select(i) }, h('span', null, it.title));
      const page = it.page || h('div', { class: 'page' });
      tabs.append(tab); body.append(page);
      api.tabs.push({ tab, page });
    });
    api.select(0);
    return api;
  };

  /* split divider ---------------------------------------------------------------------- */
  U.divider = function (kind, get, set, onEnd) {
    const d = h('div', { class: kind === 'h' ? 'divH' : 'divV' });
    const a = h('div', { class: 'one a' }), b = h('div', { class: 'one b' });
    d.append(a, b);
    let prev = null;
    a.addEventListener('mousedown', (e) => { e.stopPropagation(); if (prev !== null) { set(prev); prev = null; } else { prev = get(); set(0); } onEnd && onEnd(); });
    b.addEventListener('mousedown', (e) => { e.stopPropagation(); if (prev !== null) { set(prev); prev = null; } else { prev = get(); set(1e6); } onEnd && onEnd(); });
    d.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const r = d.getBoundingClientRect();
      const shade = h('div', { class: 'drag-shade', style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px` });
      document.body.append(shade);
      const s0 = kind === 'h' ? e.clientY : e.clientX, v0 = get();
      let delta = 0;
      const mv = (ev) => {
        delta = (kind === 'h' ? ev.clientY : ev.clientX) - s0;
        if (kind === 'h') shade.style.top = r.top + delta + 'px'; else shade.style.left = r.left + delta + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
        shade.remove(); set(v0 + delta); prev = null; onEnd && onEnd();
      };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    return d;
  };

  /* dialogs ----------------------------------------------------------------------------- */
  let dlgCount = 0;
  U.dialog = function (title, content, buttons, opts) {
    opts = opts || {};
    const wrap = h('div', { class: 'dlgwrap' + (opts.modal === false ? ' nomodal' : '') });
    const closeFn = () => { wrap.remove(); document.removeEventListener('keydown', key, true); if (opts.onClose) opts.onClose(); };
    const head = h('div', { class: 'dt' }, h('img', { src: 'images/RedMars16.gif' }), h('span', null, title || ''), h('button', { onclick: () => { if (opts.onX) opts.onX(); closeFn(); } }, '✕'));
    const body = h('div', { class: 'db', style: opts.bodyStyle || '' }, content);
    const dlg = h('div', { class: 'dlg', style: opts.style || '' }, head, body);
    if (buttons && buttons.length) {
      const f = h('div', { class: 'df' });
      for (const b of buttons) {
        const el = h('button', { class: 'btn', onclick: () => { const keep = b.fn && b.fn(); if (keep !== true) closeFn(); } }, b.label);
        b.el = el; f.append(el);
      }
      dlg.append(f);
    }
    wrap.append(dlg); document.body.append(wrap);
    const off = (dlgCount++ % 6) * 16;
    const place = () => {
      dlg.style.left = Math.max(0, (innerWidth - dlg.offsetWidth) / 2 + off) + 'px';
      dlg.style.top = Math.max(0, (innerHeight - dlg.offsetHeight) / 2.6 + off) + 'px';
    };
    place();
    head.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      const x0 = e.clientX - dlg.offsetLeft, y0 = e.clientY - dlg.offsetTop;
      const mv = (ev) => { dlg.style.left = ev.clientX - x0 + 'px'; dlg.style.top = Math.max(0, ev.clientY - y0) + 'px'; };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    const key = (e) => {
      if (opts.modal === false && !dlg.contains(document.activeElement)) return;
      if (e.key === 'Escape') { e.stopPropagation(); if (opts.onX) opts.onX(); closeFn(); }
      if (e.key === 'Enter' && buttons && buttons[0] && !opts.noEnter && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); buttons[0].el.click(); }
    };
    document.addEventListener('keydown', key, true);
    return { close: closeFn, el: dlg, body, wrap, place };
  };
  const ICONS = { info: 'SyscallMessageDialogInformation.gif', warn: 'SyscallMessageDialogWarning.gif', error: 'SyscallMessageDialogError.gif', question: 'SyscallMessageDialogQuestion.gif' };
  const optBody = (icon, msg, extra) => h('div', null, h('div', { class: 'optrow' },
    icon ? h('img', { src: icon.startsWith('images') ? icon : 'help/' + ICONS[icon] }) : null,
    h('div', { style: 'flex:1' }, h('div', { class: 'optmsg' }, msg), extra || null)));
  U.message = (title, msg, icon) => new Promise((res) => U.dialog(title === null ? 'Message' : title, optBody(icon === undefined ? 'info' : icon, msg), [{ label: 'OK', fn: () => res() }], { onX: () => res() }));
  U.confirm = (title, msg, labels) => new Promise((res) => {
    const l = labels || ['Yes', 'No', 'Cancel'];
    let done = false; const r = (v) => { if (!done) { done = true; res(v); } };
    U.dialog(title || 'Select an Option', optBody('question', msg), l.map((t, i) => ({ label: t, fn: () => r(i) })), { onX: () => r(-1) });
  });
  U.input = (title, msg) => new Promise((res) => {
    const f = h('input', { class: 'tf', style: 'width:100%;margin-top:8px' });
    let done = false; const r = (v) => { if (!done) { done = true; res(v); } };
    U.dialog(title || 'Input', optBody('question', msg, f), [{ label: 'OK', fn: () => r(f.value) }, { label: 'Cancel', fn: () => r(null) }], { onX: () => r(null) });
    setTimeout(() => f.focus(), 0);
  });
})();
