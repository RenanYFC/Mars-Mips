/* MARS web - simulator loop and syscalls. Port of mars.simulator.Simulator and
   mars.mips.instructions.syscalls.*. Runs cooperatively on the UI thread: anything that would
   block in Java (keyboard input, dialogs, sleep) rolls the syscall back and re-executes it
   once the answer has arrived. */
(function () {
  const M = globalThis.MARS, CPU = M.cpu, mem = M.mem, S = M.settings, BS = M.backstep, DB = M.delayed;
  const R = CPU.regs, F = CPU.fp;
  const { hex8, ProcEx, setReg } = M;

  const REASON = { BREAKPOINT: 1, EXCEPTION: 2, MAX_STEPS: 3, NORMAL: 4, CLIFF: 5, PAUSE_OR_STOP: 6 };
  const WAIT = { wait: true };
  const EXIT = new ProcEx(null);

  const sim = (M.sim = {
    REASON, running: false, stopFlag: 0, // 1 pause, 2 stop
    waiting: null, input: undefined, extInterrupt: 0,
    statement: null, opts: null, count: 0,
    instrObservers: [], preObservers: [],
    io: { print() {}, request() {}, dialog() {} }, // provided by the UI
    speed: () => 40,

    start(opts) { // {maxSteps, breakpoints:Set<int>, onUpdate, onDone(done,reason,pe)}
      this.opts = opts; this.running = true; this.stopFlag = 0; this.steps = 0;
      for (const f of this.startObservers) f();
      try { this.statement = mem.getStatement(CPU.pc); } catch (e) {
        if (!(e instanceof M.AddressError)) throw e;
        return this.finishBadPC(e);
      }
      this.loop();
    },
    startObservers: [], stopObservers: [],
    finishBadPC(e) {
      const el = new M.ErrorList();
      el.add(new M.ErrorMessage(false, '', 0, 0, 'invalid program counter value: ' + hex8(CPU.pc)));
      M.setException(e.type, e.address);
      M.setC0(14, CPU.pc);
      this.finish(true, REASON.EXCEPTION, new ProcEx(el));
    },
    finish(done, reason, pe) {
      this.running = false; this.waiting = null;
      if (done) M.resetFiles();
      this.io.flush && this.io.flush();
      for (const f of this.stopObservers) f();
      this.opts.onDone(done, reason, pe);
    },
    pause() { if (this.running) { this.stopFlag = 1; this.abortWait(); } },
    stop() { if (this.running) { this.stopFlag = 2; this.abortWait(); } },
    abortWait() {
      if (this.waiting) {
        if (this.waitTimer) { clearTimeout(this.waitTimer); this.waitTimer = null; }
        if (this.io.cancel) this.io.cancel();
        this.waiting = null;
        this.finish(this.stopFlag === 2, REASON.PAUSE_OR_STOP, null);
      } else if (this.timer) {
        clearTimeout(this.timer); this.timer = null;
        this.finish(this.stopFlag === 2, REASON.PAUSE_OR_STOP, null);
      }
    },
    provide(value) { this.input = value; this.waiting = null; if (this.running) this.loop(); },

    rollbackStep() { // undo the partially-run syscall (nothing but the marker has been pushed)
      const s = BS.stack;
      while (s.length) { const r = s.pop(); if (r[0] === 0) break; }
    },
    loop() {
      this.timer = null;
      const o = this.opts, maxSteps = o.maxSteps;
      const t0 = Date.now(); let n = 0;
      const obs = this.instrObservers, pre = this.preObservers;
      for (;;) {
        const st = this.statement;
        if (!st) {
          if (DB.state) DB.state = 0;
          return this.finish(true, REASON.CLIFF, null);
        }
        const pc = CPU.pc;
        for (let i = 0; i < pre.length; i++) pre[i](st, pc);
        CPU.pc = (pc + 4) | 0;
        if (BS.enabled) M.pushBS([0, pc, DB.state, DB.target]);
        try {
          if (this.extInterrupt !== 0) {
            const code = this.extInterrupt; this.extInterrupt = 0;
            throw M.runtimeError(st, 'External Interrupt', code);
          }
          const inst = st.inst;
          if (!inst) throw M.runtimeError(st, 'undefined instruction (' + hex8(st.binary) + ')', 10);
          inst.sim(st.ops, st);
          this.count++;
          for (let i = 0; i < obs.length; i++) obs[i](st, pc);
        } catch (e) {
          if (e === WAIT) { this.rollbackStep(); CPU.pc = pc; return; }
          if (e instanceof ProcEx) {
            if (e.errors === null) return this.finish(true, REASON.NORMAL, null);
            if (mem.text.get(mem.cfg.excHandler)) CPU.pc = mem.cfg.excHandler | 0;
            else return this.finish(true, REASON.EXCEPTION, e);
          } else throw e;
        }
        if (DB.state === 2) { CPU.pc = DB.target; DB.state = 0; }
        else if (DB.state === 1) DB.state = 2;
        if (this.stopFlag) return this.finish(this.stopFlag === 2, REASON.PAUSE_OR_STOP, null);
        if (o.breakpoints && o.breakpoints.has(CPU.pc)) return this.finish(false, REASON.BREAKPOINT, null);
        if (maxSteps > 0 && ++this.steps >= maxSteps) { this.fetchNext(); return this.finish(false, REASON.MAX_STEPS, null); }
        const speed = maxSteps === 1 ? 40 : this.speed();
        try { this.statement = mem.getStatement(CPU.pc); } catch (e) {
          if (!(e instanceof M.AddressError)) throw e;
          return this.finishBadPC(e);
        }
        if (speed < 40) {
          if (o.onUpdate) o.onUpdate();
          this.timer = setTimeout(() => this.loop(), Math.max(1, Math.floor(1000 / speed)));
          return;
        }
        if ((++n & 0x3fff) === 0 && Date.now() - t0 > 30) {
          this.io.flush && this.io.flush();
          this.timer = setTimeout(() => this.loop(), 0);
          return;
        }
      }
    },
    fetchNext() { try { this.statement = mem.getStatement(CPU.pc); } catch (e) { this.statement = null; } },
    backstep() {
      const s = BS.stack, was = BS.enabled;
      BS.enabled = false;
      while (s.length) {
        const r = s.pop();
        switch (r[0]) {
          case 0: CPU.pc = r[1]; DB.state = r[2]; DB.target = r[3]; BS.enabled = was; return true;
          case 1: R[r[1]] = r[2]; CPU.lastReg = r[1]; break;
          case 2: F[r[1]] = r[2]; CPU.lastFp = r[1]; break;
          case 3: CPU.cp0[r[1]] = r[2]; CPU.lastC0 = r[1]; break;
          case 4: CPU.flags = r[2]; break;
          case 5: mem.rawSetWord(r[1], r[2]); CPU.lastMem = r[1]; break;
          case 6: if (r[2]) mem.text.set(r[1] >>> 0, r[2]); else mem.text.delete(r[1] >>> 0); break;
          case 7: mem.heap = r[2]; break;
        }
      }
      BS.enabled = was;
      return false;
    },
    canBackstep() { return BS.canStep(); },
  });

  /* random streams: java.util.Random ----------------------------------- */
  const MUL = 0x5DEECE66Dn, ADD = 0xBn, MASK = (1n << 48n) - 1n;
  class JRandom {
    constructor(seed) { this.setSeed(seed === undefined ? BigInt(Date.now()) * 1000003n + BigInt(Math.floor(Math.random() * 1e9)) : BigInt(seed)); }
    setSeed(s) { this.seed = (BigInt(s) ^ MUL) & MASK; }
    next(bits) {
      this.seed = (this.seed * MUL + ADD) & MASK;
      return Number(BigInt.asIntN(32, this.seed >> (48n - BigInt(bits))));
    }
    nextInt() { return this.next(32); }
    nextBound(n) {
      if ((n & -n) === n) return Number((BigInt(n) * BigInt(this.next(31))) >> 31n);
      let bits, val;
      do { bits = this.next(31); val = bits % n; } while (bits - val + (n - 1) > 2147483647);
      return val;
    }
    nextFloat() { return Math.fround(this.next(24) / (1 << 24)); }
    nextDouble() { return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992; }
  }
  M.JRandom = JRandom;
  const streams = new Map();
  const stream = (i) => { let s = streams.get(i); if (!s) { s = new JRandom(); streams.set(i, s); } return s; };

  /* virtual file system for syscalls 13-16 --------------------------------- */
  const vfs = (M.vfs = new Map()); // name -> Uint8Array
  let fds = new Map(), fileErr = 'File operation OK';
  M.resetFiles = () => {
    for (const fd of [...fds.keys()]) closeFd(fd);
    fds = new Map();
  };
  function closeFd(fd) {
    const f = fds.get(fd);
    if (!f) return;
    if (f.write) { vfs.set(f.name, Uint8Array.from(f.data)); if (M.onVfsWrite) M.onVfsWrite(f.name); }
    fds.delete(fd);
  }
  function openFile(name, flags) {
    let fd = 3; while (fds.has(fd) && fd < 32) fd++;
    if (fd >= 32) { fileErr = 'File name not found or too many open files'; return -1; }
    if (flags === 0) {
      let data = vfs.get(name);
      if (!data && M.findOpenFile) { const t = M.findOpenFile(name); if (t !== null) data = new TextEncoder().encode(t); }
      if (!data) { fileErr = 'File ' + name + ' not found, open for input.'; return -1; }
      fds.set(fd, { name, data, pos: 0, write: false });
    } else if (flags === 1 || flags === 9) {
      const prev = flags === 9 && vfs.get(name) ? Array.from(vfs.get(name)) : [];
      fds.set(fd, { name, data: prev, pos: prev.length, write: true });
    } else { fileErr = 'Failed to open file ' + name + ': invalid flags'; return -1; }
    return fd;
  }

  /* syscalls --------------------------------------------------------------- */
  const io = () => sim.io;
  const out = (s) => io().print(s);
  function waitFor(kind, data) { sim.waiting = { kind, data }; io().request(kind, data, (v) => sim.provide(v)); throw WAIT; }
  function take() { const v = sim.input; sim.input = undefined; return v; }
  function needInput(kind, data) { return sim.input === undefined ? waitFor(kind, data) : take(); }
  function read(service, kind, data) { return needInput(kind, Object.assign({ service }, data)); }
  const guarded = (st, fn) => {
    try { return fn(); } catch (e) { if (e instanceof M.AddressError) throw M.addrErrToEx(st, e); throw e; }
  };
  const msg = (st) => guarded(st, () => mem.readString(R[4]));
  const parseIntStrict = (s) => { const t = s.trim(); if (!/^[+-]?\d+$/.test(t)) return null; const v = Number(t); return v < -2147483648 || v > 2147483647 ? null : v; };
  const dialogParse = (type) => (s) => {
    if (type === 'int') return parseIntStrict(s);
    try { const v = M.parseDouble(s.trim()); return type === 'float' ? Math.fround(v) : v; } catch (e) { return null; }
  };
  function inputDialog(st, type, cb) {
    const v = needInput('dialog', { type: 'input', message: msg(st) });
    if (v === null) return cb(null, -2);
    if (v.length === 0) return cb(null, -3);
    const p = dialogParse(type)(v);
    return p === null ? cb(null, -1) : cb(p, 0);
  }
  const msgDialog = (st, text, msgType) => {
    needInput('dialog', { type: 'message', message: text, msgType });
  };

  let audio = null;
  function tone(pitch, durMs, inst, vol) {
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      audio = audio || new AC();
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'triangle'; o.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
      g.gain.value = Math.max(0, Math.min(127, vol)) / 127 * 0.3;
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + durMs / 1000);
      o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + durMs / 1000);
    } catch (e) { /* no audio */ }
  }
  const midiArg = (n, lo, hi, d) => (n < lo || n > hi ? d : n);

  const services = {
    1: () => out(String(R[4])),
    2: () => out(M.javaFloat(M.intBitsToFloat(F[12]))),
    3: () => out(M.javaDouble(M.twoIntsToDouble(F[13], F[12]))),
    4: (st) => out(guarded(st, () => mem.readString(R[4]))),
    5: (st) => {
      const s = read(5, 'int', {});
      const v = parseIntStrict(s);
      if (v === null) throw M.runtimeError(st, 'invalid integer input (syscall 5)', 8);
      setReg(2, v);
    },
    6: (st) => {
      const s = read(6, 'float', {}); let v;
      try { v = M.parseDouble(s.trim()); } catch (e) { throw M.runtimeError(st, 'invalid float input (syscall 6)', 8); }
      M.setFp(0, M.floatToIntBits(Math.fround(v)));
    },
    7: (st) => {
      const s = read(7, 'double', {}); let v;
      try { v = M.parseDouble(s.trim()); } catch (e) { throw M.runtimeError(st, 'invalid double input (syscall 7)', 8); }
      M.setDoubleReg(0, v);
    },
    8: (st) => {
      let max = R[5] - 1, addNull = true;
      if (max < 0) { max = 0; addNull = false; }
      const s = read(8, 'string', { maxLength: max });
      const len0 = Math.min(max, s.length); let len = len0;
      guarded(st, () => {
        for (let i = 0; i < len0; i++) mem.setByte((R[4] + i) | 0, s.charCodeAt(i));
        if (len < max) { mem.setByte((R[4] + len) | 0, 10); len++; }
        if (addNull) mem.setByte((R[4] + len) | 0, 0);
      });
    },
    9: (st) => {
      let a;
      const old = mem.heap;
      try { a = mem.sbrk(R[4]); } catch (e) { if (e instanceof RangeError) throw M.runtimeError(st, e.message + ' (syscall 9)', 8); throw e; }
      if (BS.enabled) M.pushBS([7, 0, old]);
      setReg(2, a);
    },
    10: () => { throw EXIT; },
    11: () => out(String.fromCharCode(R[4] & 0xff)),
    12: (st) => {
      const s = read(12, 'char', { maxLength: 1 });
      if (s.length === 0) throw M.runtimeError(st, 'invalid char input (syscall 12)', 8);
      setReg(2, s.charCodeAt(0));
    },
    13: (st) => {
      const name = guarded(st, () => mem.readString(R[4]));
      setReg(2, openFile(name, R[5]));
    },
    14: (st) => {
      const fd = R[4], n = R[6];
      if (fd === 0) {
        const s = read(14, 'string', { maxLength: n });
        const l = Math.min(n, s.length);
        guarded(st, () => { for (let i = 0; i < l; i++) mem.setByte((R[5] + i) | 0, s.charCodeAt(i)); });
        setReg(2, l); return;
      }
      const f = fds.get(fd);
      if (!f || f.write) { fileErr = 'File descriptor ' + fd + ' is not open for reading'; setReg(2, -1); return; }
      const l = Math.min(n, f.data.length - f.pos);
      guarded(st, () => { for (let i = 0; i < l; i++) mem.setByte((R[5] + i) | 0, f.data[f.pos + i]); });
      f.pos += l; setReg(2, l);
    },
    15: (st) => {
      const fd = R[4], n = R[6]; let s = '';
      const bytes = [];
      guarded(st, () => { for (let i = 0; i < n; i++) { const b = mem.getByte((R[5] + i) | 0); bytes.push(b); s += String.fromCharCode(b); } });
      if (fd === 1 || fd === 2) { out(s); setReg(2, n); return; }
      const f = fds.get(fd);
      if (!f || !f.write) { fileErr = 'File descriptor ' + fd + ' is not open for writing'; setReg(2, -1); return; }
      f.data.push(...bytes); setReg(2, n);
    },
    16: () => closeFd(R[4]),
    17: () => { M.exitCode = R[4]; throw EXIT; },
    30: () => {
      const t = BigInt(Date.now());
      setReg(4, Number(BigInt.asIntN(32, t))); setReg(5, Number(BigInt.asIntN(32, t >> 32n)));
    },
    31: () => tone(midiArg(R[4], 0, 127, 60), R[5] < 0 ? 1000 : R[5], R[6], midiArg(R[7], 0, 127, 100)),
    32: () => { if (sim.input === undefined) { sim.waiting = { kind: 'sleep' }; sim.waitTimer = setTimeout(() => { sim.waitTimer = null; sim.provide(true); }, Math.max(0, R[4])); throw WAIT; } take(); },
    33: () => {
      if (sim.input === undefined) {
        const d = R[5] < 0 ? 1000 : R[5];
        tone(midiArg(R[4], 0, 127, 60), d, R[6], midiArg(R[7], 0, 127, 100));
        sim.waiting = { kind: 'sleep' }; sim.waitTimer = setTimeout(() => { sim.waitTimer = null; sim.provide(true); }, d); throw WAIT;
      }
      take();
    },
    34: () => out(hex8(R[4])),
    35: () => out((R[4] >>> 0).toString(2).padStart(32, '0')),
    36: () => out(String(R[4] >>> 0)),
    40: () => { const s = streams.get(R[4]); if (s) s.setSeed(R[5]); else streams.set(R[4], new JRandom(R[5])); },
    41: () => setReg(4, stream(R[4]).nextInt()),
    42: (st) => {
      if (R[5] <= 0) throw M.runtimeError(st, 'Upper bound of range cannot be negative (syscall 42)', 8);
      setReg(4, stream(R[4]).nextBound(R[5]));
    },
    43: () => M.setFp(0, M.floatToIntBits(stream(R[4]).nextFloat())),
    44: () => M.setDoubleReg(0, stream(R[4]).nextDouble()),
    50: (st) => { const v = needInput('dialog', { type: 'confirm', message: msg(st) }); setReg(4, v); },
    51: (st) => inputDialog(st, 'int', (v, f) => { setReg(4, v === null ? 0 : v); setReg(5, f); }),
    52: (st) => inputDialog(st, 'float', (v, f) => { M.setFp(0, M.floatToIntBits(v === null ? 0 : v)); setReg(5, f); }),
    53: (st) => inputDialog(st, 'double', (v, f) => { M.setDoubleReg(0, v === null ? 0 : v); setReg(5, f); }),
    54: (st) => {
      const s = needInput('dialog', { type: 'input', message: msg(st) });
      const addr = R[5], max = R[6];
      if (s === null) { setReg(5, -2); return; }
      if (s.length === 0) { setReg(5, -3); return; }
      guarded(st, () => {
        for (let i = 0; i < s.length && i < max - 1; i++) mem.setByte((addr + i) | 0, s.charCodeAt(i));
        if (s.length < max - 1) mem.setByte((addr + Math.min(s.length, max - 2)) | 0, 10);
        mem.setByte((addr + Math.min(s.length + 1, max - 1)) | 0, 0);
      });
      setReg(5, s.length > max - 1 ? -4 : 0);
    },
    55: (st) => { const t = R[5]; msgDialog(st, msg(st), t); },
    56: (st) => msgDialog(st, msg(st) + String(R[5]), 1),
    57: (st) => msgDialog(st, msg(st) + M.javaFloat(M.intBitsToFloat(F[12])), 1),
    58: (st) => msgDialog(st, msg(st) + M.javaDouble(M.twoIntsToDouble(F[13], F[12])), 1),
    59: (st) => {
      const text = msg(st) + guarded(st, () => mem.readString(R[5]));
      msgDialog(st, text, 1);
    },
  };
  M.doSyscall = function (n, st) {
    const f = services[n];
    if (!f) throw M.runtimeError(st, 'invalid or unimplemented syscall service: ' + n + ' ', 8);
    f(st);
  };

  /* program arguments ------------------------------------------------------- */
  M.storeProgramArguments = function (text) {
    const args = text.trim().split(/\s+/).filter(Boolean);
    if (!args.length) return;
    let high = mem.cfg.stackBase | 0;
    const start = [];
    for (const a of args) {
      mem.set(high, 0, 1); high--;
      for (let j = a.length - 1; j >= 0; j--) { mem.set(high, a.charCodeAt(j), 1); high--; }
      start.push(high + 1);
    }
    let sa = mem.cfg.sp | 0;
    if (high < sa) sa = high - (high % 4) - 4;
    mem.set(sa, 0, 4); sa -= 4;
    for (let i = args.length - 1; i >= 0; i--) { mem.set(sa, start[i], 4); sa -= 4; }
    mem.set(sa, args.length, 4); sa -= 4;
    R[29] = sa + 4; R[4] = args.length; R[5] = sa + 8;
  };
})();
