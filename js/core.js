/* MARS web - binary helpers, settings, registers, memory, back-stepper.
   Port of the original Java classes (mars.util.Binary, mars.mips.hardware.*). */
(function () {
  const M = (globalThis.MARS = globalThis.MARS || {});

  /* ---------- number helpers ---------- */
  const hex8 = (v) => '0x' + ((v >>> 0).toString(16).padStart(8, '0'));
  class NFE extends Error {}
  function stringToInt(s) {
    let t = s, neg = false, radix = 10;
    if (t.length === 0) throw new NFE();
    if (t[0] === '-') { neg = true; t = t.slice(1); } else if (t[0] === '+') t = t.slice(1);
    if (/^0[xX]/.test(t)) { radix = 16; t = t.slice(2); }
    else if (t[0] === '#') { radix = 16; t = t.slice(1); }
    else if (t.length > 1 && t[0] === '0') { radix = 8; t = t.slice(1); }
    const re = radix === 16 ? /^[0-9a-fA-F]+$/ : radix === 8 ? /^[0-7]+$/ : /^[0-9]+$/;
    if (!re.test(t)) throw new NFE();
    const v = BigInt((radix === 16 ? '0x' : radix === 8 ? '0o' : '') + t) * (neg ? -1n : 1n);
    if (v >= -2147483648n && v <= 2147483647n) return Number(v);
    if (radix === 16 && !neg && s.length === 10) return Number(v) | 0; // 0x80000000-0xFFFFFFFF
    throw new NFE();
  }
  function isInt(s) { try { stringToInt(s); return true; } catch (e) { return false; } }
  const DBL_RE = /^\s*[+-]?(NaN|Infinity|((\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[fFdD]?))\s*$/;
  function parseDouble(s) {
    if (!DBL_RE.test(s)) throw new NFE();
    const t = s.trim().replace(/[fFdD]$/, '');
    if (/NaN/.test(t)) return NaN;
    return Number(t);
  }
  const buf = new ArrayBuffer(8), f32 = new Float32Array(buf), f64 = new Float64Array(buf), i32 = new Int32Array(buf);
  const intBitsToFloat = (i) => { i32[0] = i; return f32[0]; };
  const floatToIntBits = (f) => { if (f !== f) return 0x7fc00000; f32[0] = f; return i32[0]; };
  const twoIntsToDouble = (hi, lo) => { i32[0] = lo; i32[1] = hi; return f64[0]; };
  const doubleToInts = (d) => { if (d !== d) return [0x7ff80000, 0]; f64[0] = d; return [i32[1], i32[0]]; };

  function fmtJava(neg, digits, exp10) { // digits "d1d2..", value = 0.d1d2.. * 10^(exp10+1)
    let r;
    if (exp10 >= -3 && exp10 < 7) {
      if (exp10 >= 0) {
        const ip = digits.slice(0, exp10 + 1).padEnd(exp10 + 1, '0');
        r = ip + '.' + (digits.slice(exp10 + 1) || '0');
      } else r = '0.' + '0'.repeat(-exp10 - 1) + digits;
    } else r = digits[0] + '.' + (digits.slice(1) || '0') + 'E' + exp10;
    return (neg ? '-' : '') + r;
  }
  function splitExp(s) { const m = s.match(/^(\d)(?:\.(\d+))?e([+-]\d+)$/); return [m[1] + (m[2] || ''), +m[3]]; }
  function javaFloat(x) {
    if (x !== x) return 'NaN';
    if (x === Infinity) return 'Infinity'; if (x === -Infinity) return '-Infinity';
    if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
    const a = Math.abs(x); let s = null;
    for (let p = 0; p < 9; p++) { s = a.toExponential(p); if (Math.fround(+s) === a) break; }
    const [d, e] = splitExp(s);
    return fmtJava(x < 0, d.replace(/0+$/, '') || '0', e);
  }
  function javaDouble(x) {
    if (x !== x) return 'NaN';
    if (x === Infinity) return 'Infinity'; if (x === -Infinity) return '-Infinity';
    if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
    const [d, e] = splitExp(Math.abs(x).toExponential());
    return fmtJava(x < 0, d, e);
  }
  Object.assign(M, { hex8, NFE, stringToInt, isInt, parseDouble, intBitsToFloat, floatToIntBits, twoIntsToDouble, doubleToInts, javaFloat, javaDouble });

  /* ---------- settings (persisted in localStorage) ---------- */
  const defaults = {
    labelWindow: false, programArgs: false, popupInput: false, addrHex: true, valHex: true,
    assembleOnOpen: false, assembleAll: false, warningsAreErrors: false, startAtMain: false,
    extended: true, delayedBranching: false, selfModifying: false,
    regHighlight: true, dataHighlight: true, popupGuidance: true, currentLine: true, autoIndent: true,
    lineNumbers: true, popupPrefix: 2, tabSize: 8, blinkRate: 500, editorFontSize: 12, editorFontFamily: 'Monospaced',
    editorFontStyle: 'Plain', memConfig: 'Default', exceptionHandlerOn: false, exceptionHandler: '',
    evenBg: '#e0e0e0', evenFg: '#000000', oddBg: '#ffffff', oddFg: '#000000',
    textHlBg: '#ffff99', textHlFg: '#000000', delayHlBg: '#33ff00', delayHlFg: '#000000',
    dataHlBg: '#99ccff', dataHlFg: '#000000', regHlBg: '#99cc55', regHlFg: '#000000',
  };
  const S = (M.settings = Object.assign({}, defaults));
  M.defaultSettings = defaults;
  try {
    if (globalThis.localStorage) Object.assign(S, JSON.parse(localStorage.getItem('mars.settings') || '{}'));
  } catch (e) { /* ignore */ }
  M.saveSettings = () => { try { localStorage.setItem('mars.settings', JSON.stringify(S)); } catch (e) { /* ignore */ } };

  /* ---------- memory configurations ---------- */
  const cfgRaw = M.DATA.memCfg;
  const cfgKeys = ['textBase', 'dataSegBase', 'externBase', 'gp', 'dataBase', 'heapBase', 'sp', 'stackBase', 'userHigh', 'kernelBase',
    'ktextBase', 'excHandler', 'kdataBase', 'mmioBase', 'kernelHigh', 'dataSegLimit', 'textLimit', 'kdataLimit', 'ktextLimit', 'stackLimit', 'memLimit'];
  const cfgNames = ['.text base address', 'data segment base address', '.extern base address', 'global pointer $gp', '.data base address',
    'heap base address', 'stack pointer $sp', 'stack base address', 'user space high address', 'kernel space base address', '.ktext base address',
    'exception handler address', '.kdata base address', 'MMIO base address', 'kernel space high address', 'data segment limit address',
    'text limit address', 'kernel data segment limit address', 'kernel text limit address', 'stack limit address', 'memory map limit address'];
  const mkCfg = (arr) => { const o = {}; cfgKeys.forEach((k, i) => { o[k] = Number(arr[i]) >>> 0; }); return o; };
  M.memConfigs = {
    Default: { label: 'Default', v: mkCfg(cfgRaw[0][1]) },
    CompactDataAtZero: { label: 'Compact, Data at Address 0', v: mkCfg(cfgRaw[1][1]) },
    CompactTextAtZero: { label: 'Compact, Text at Address 0', v: mkCfg(cfgRaw[2][1]) },
  };
  M.memCfgKeys = cfgKeys; M.memCfgNames = cfgNames;

  /* ---------- back-stepper ---------- */
  const BS_LIMIT = 2000;
  const BS = (M.backstep = {
    stack: [], enabled: true,
    clear() { this.stack.length = 0; },
    canStep() { return this.stack.length > 0; },
  });
  M.pushBS = function (rec) { const s = BS.stack; s.push(rec); if (s.length > BS_LIMIT * 2) s.splice(0, BS_LIMIT); };

  /* ---------- registers ---------- */
  const NAMES = ['$zero', '$at', '$v0', '$v1', '$a0', '$a1', '$a2', '$a3', '$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7',
    '$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7', '$t8', '$t9', '$k0', '$k1', '$gp', '$sp', '$fp', '$ra'];
  const nameIdx = new Map(NAMES.map((n, i) => [n, i]));
  const CPU = (M.cpu = {
    NAMES,
    regs: new Int32Array(35), // 0-31, 33 hi, 34 lo (32 unused)
    pc: 0,
    fp: new Int32Array(32), flags: 0,
    cp0: { 8: 0, 12: 0x0000ff11, 13: 0, 14: 0 },
    lastReg: -1, lastFp: -1, lastC0: -1, lastMem: null,
    observers: new Set(),
  });
  const CFG = () => M.mem.cfg;
  M.getUserRegister = function (name) { // returns number or -1
    if (name[0] === '$') {
      const rest = name.slice(1);
      try { const n = stringToInt(rest); if (n >= 0 && n < 32) return n; } catch (e) { /* mnemonic */ }
      const i = nameIdx.get(name); return i === undefined ? -1 : i;
    }
    return -1;
  };
  M.isRegName = (s) => nameIdx.has(s);
  M.getFpRegister = function (name) {
    if (/^\$f\d{1,2}$/.test(name)) { const n = +name.slice(2); if (n < 32) return n; }
    return -1;
  };
  M.isC0Register = (s) => s === '$8' || s === '$12' || s === '$13' || s === '$14';
  M.setReg = function (n, v) {
    if (n === 0) return;
    if (BS.enabled) M.pushBS([1, n, CPU.regs[n]]);
    CPU.regs[n] = v; CPU.lastReg = n;
  };
  M.setFp = function (n, v) {
    if (BS.enabled) M.pushBS([2, n, CPU.fp[n]]);
    CPU.fp[n] = v; CPU.lastFp = n;
  };
  M.setC0 = function (n, v) {
    if (BS.enabled) M.pushBS([3, n, CPU.cp0[n]]);
    CPU.cp0[n] = v; CPU.lastC0 = n;
  };
  M.setFlag = function (n, on) {
    if (BS.enabled) M.pushBS([4, 0, CPU.flags]);
    CPU.flags = on ? CPU.flags | (1 << n) : CPU.flags & ~(1 << n);
  };
  M.resetRegisters = function () {
    CPU.regs.fill(0); CPU.fp.fill(0); CPU.flags = 0;
    CPU.regs[28] = CFG().gp | 0; CPU.regs[29] = CFG().sp | 0;
    CPU.pc = CFG().textBase | 0;
    CPU.cp0 = { 8: 0, 12: 0x0000ff11, 13: 0, 14: 0 };
    CPU.lastReg = CPU.lastFp = CPU.lastC0 = -1; CPU.lastMem = null;
  };
  M.getDoubleReg = (n) => twoIntsToDouble(CPU.fp[n + 1], CPU.fp[n]);
  M.setDoubleReg = (n, d) => { const [h, l] = doubleToInts(d); M.setFp(n + 1, h); M.setFp(n, l); };

  /* ---------- memory ---------- */
  class AddressError extends Error {
    constructor(msg, type, addr) { super(msg + hex8(addr)); this.type = type; this.address = addr; }
  }
  M.AddressError = AddressError;
  const LOAD = 4, STORE = 5;
  const PAGE_BITS = 12, PAGE_MASK = 0xfff;
  const mem = (M.mem = {
    cfg: M.memConfigs[S.memConfig] ? M.memConfigs[S.memConfig].v : M.memConfigs.Default.v,
    pages: new Map(), lastKey: -1, lastPage: null,
    text: new Map(),   // address (unsigned) -> statement
    heap: 0, observers: [],
    mmioRead: null, mmioWrite: null,
    setConfig(name) { S.memConfig = name; this.cfg = M.memConfigs[name].v; this.heap = this.cfg.heapBase; },
    clear() {
      this.pages.clear(); this.text.clear(); this.lastKey = -1; this.lastPage = null;
      this.heap = this.cfg.heapBase; CPU.lastMem = null;
    },
    get compact() { return this.cfg.dataBase < 0x10000; },
    inText(a) { const u = a >>> 0; return u >= this.cfg.textBase && u < this.cfg.textLimit; },
    inKText(a) { const u = a >>> 0; return u >= this.cfg.ktextBase && u < this.cfg.ktextLimit; },
    inData(a) { const u = a >>> 0; return u >= this.cfg.dataSegBase && u < this.cfg.dataSegLimit; },
    inKData(a) { const u = a >>> 0; return u >= this.cfg.kdataBase && u < this.cfg.kdataLimit; },
    inMMIO(a) { const u = a >>> 0; return u >= this.cfg.mmioBase && u <= this.cfg.memLimit; },
    page(a, create) {
      const key = a >>> PAGE_BITS;
      if (key === this.lastKey) return this.lastPage;
      let p = this.pages.get(key);
      if (!p) { if (!create) return null; p = new Int32Array(1024); this.pages.set(key, p); }
      this.lastKey = key; this.lastPage = p; return p;
    },
    rawWord(a) { const p = this.page(a, false); return p ? p[(a & PAGE_MASK) >>> 2] : 0; },
    rawSetWord(a, v) { this.page(a, true)[(a & PAGE_MASK) >>> 2] = v; },
    rawByte(a) { const w = this.rawWord(a & ~3); return (w >>> ((a & 3) * 8)) & 0xff; },
    rawSetByte(a, v) {
      const p = this.page(a, true), i = (a & PAGE_MASK) >>> 2, sh = (a & 3) * 8;
      p[i] = (p[i] & ~(0xff << sh)) | ((v & 0xff) << sh);
    },
    checkRead(a) {
      if (this.inData(a) || this.inKData(a) || this.inMMIO(a)) return;
      if (this.inText(a) || this.inKText(a)) {
        if (!S.selfModifying) {
          if (this.inText(a)) throw new AddressError('Cannot read directly from text segment!', LOAD, a);
        }
        return;
      }
      throw new AddressError('address out of range ', LOAD, a);
    },
    checkWrite(a) {
      if (this.inData(a) || this.inKData(a) || this.inMMIO(a)) return;
      if (this.inText(a) || this.inKText(a)) {
        if (!S.selfModifying) {
          if (this.inText(a)) throw new AddressError('Cannot write directly to text segment!', STORE, a);
        }
        return;
      }
      throw new AddressError('store address out of range ', STORE, a);
    },
    isCode(a) { return this.inText(a) || this.inKText(a); },
    notify(rw, a, len, v) { for (const o of this.observers) o(rw, a, len, v); },
    getWord(a) {
      if (a & 3) throw new AddressError('fetch address not aligned on word boundary ', LOAD, a);
      this.checkRead(a);
      let v;
      if (this.isCode(a)) { const st = this.text.get(a >>> 0); v = st ? st.binary : 0; }
      else { if (this.mmioRead && this.inMMIO(a)) this.mmioRead(a); v = this.rawWord(a); }
      if (this.observers.length) this.notify('r', a, 4, v);
      return v;
    },
    getHalf(a) {
      if (a & 1) throw new AddressError('fetch address not aligned on halfword boundary ', LOAD, a);
      this.checkRead(a);
      const w = this.isCode(a) ? this.getWordNoNotify(a & ~3) : this.rawWord(a & ~3);
      const v = (w >>> ((a & 2) * 8)) & 0xffff;
      if (this.observers.length) this.notify('r', a, 2, v);
      return v;
    },
    getByte(a) {
      this.checkRead(a);
      const w = this.isCode(a) ? this.getWordNoNotify(a & ~3) : this.rawWord(a & ~3);
      const v = (w >>> ((a & 3) * 8)) & 0xff;
      if (this.mmioRead && this.inMMIO(a)) this.mmioRead(a);
      if (this.observers.length) this.notify('r', a, 1, v);
      return v;
    },
    getWordNoNotify(a) {
      if (this.isCode(a)) { const st = this.text.get(a >>> 0); return st ? st.binary : 0; }
      return this.rawWord(a);
    },
    afterWrite(a, len, v) {
      CPU.lastMem = a;
      if (this.mmioWrite && this.inMMIO(a)) this.mmioWrite(a, v);
      if (this.observers.length) this.notify('w', a, len, v);
    },
    setWordCode(a, v) {
      const st = this.text.get(a >>> 0);
      if (BS.enabled) M.pushBS([6, a, st || null]);
      this.text.set(a >>> 0, M.statementFromBinary(v, a));
    },
    setWord(a, v) {
      if (a & 3) throw new AddressError('store address not aligned on word boundary ', STORE, a);
      this.checkWrite(a);
      if (this.isCode(a)) { this.setWordCode(a, v); this.afterWrite(a, 4, v); return; }
      if (BS.enabled) M.pushBS([5, a, this.rawWord(a)]);
      this.rawSetWord(a, v);
      this.afterWrite(a, 4, v);
    },
    setHalf(a, v) {
      if (a & 1) throw new AddressError('store address not aligned on halfword boundary ', STORE, a);
      this.checkWrite(a);
      const wa = a & ~3, sh = (a & 2) * 8;
      if (this.isCode(a)) {
        const w = this.getWordNoNotify(wa);
        this.setWordCode(wa, (w & ~(0xffff << sh)) | ((v & 0xffff) << sh));
      } else {
        if (BS.enabled) M.pushBS([5, wa, this.rawWord(wa)]);
        const w = this.rawWord(wa);
        this.rawSetWord(wa, (w & ~(0xffff << sh)) | ((v & 0xffff) << sh));
      }
      this.afterWrite(a, 2, v);
    },
    setByte(a, v) {
      this.checkWrite(a);
      const wa = a & ~3, sh = (a & 3) * 8;
      if (this.isCode(a)) {
        const w = this.getWordNoNotify(wa);
        this.setWordCode(wa, (w & ~(0xff << sh)) | ((v & 0xff) << sh));
      } else {
        if (BS.enabled) M.pushBS([5, wa, this.rawWord(wa)]);
        this.rawSetByte(a, v);
      }
      this.afterWrite(a, 1, v);
    },
    /* assembler-time store: no back-step, little endian, arbitrary alignment */
    set(a, v, len) {
      const was = BS.enabled; BS.enabled = false;
      try {
        if (this.isCode(a) && !S.selfModifying && this.inText(a)) throw new AddressError('Cannot write directly to text segment!', STORE, a);
        if (!(this.inData(a) || this.inKData(a) || this.inMMIO(a) || this.isCode(a))) throw new AddressError('store address out of range ', STORE, a);
        for (let i = 0; i < len; i++) this.rawSetByte(a + i, (v >>> (8 * i)) & 0xff);
      } finally { BS.enabled = was; }
    },
    setDouble(a, d) { const [h, l] = doubleToInts(d); this.set(a, l, 4); this.set(a + 4, h, 4); },
    setStatement(a, st) {
      if ((a & 3) || !(this.inText(a) || this.inKText(a))) {
        throw new AddressError('store address to text segment out of range or not aligned to word boundary ', STORE, a);
      }
      this.text.set(a >>> 0, st);
    },
    getStatement(a) {
      if (a & 3) throw new AddressError('fetch address for text segment not aligned to word boundary ', LOAD, a);
      if (!S.selfModifying && !(this.inText(a) || this.inKText(a))) {
        throw new AddressError('fetch address for text segment out of range ', LOAD, a);
      }
      if (this.isCode(a)) return this.text.get(a >>> 0) || null;
      const w = this.rawWord(a);
      return w === 0 ? null : M.statementFromBinary(w, a);
    },
    sbrk(n) {
      const r = this.heap;
      if (n < 0) throw new RangeError('request (' + n + ') is negative heap amount');
      let nw = this.heap + n;
      if (nw % 4 !== 0) nw += 4 - (nw % 4);
      if (nw >= this.cfg.dataSegLimit) throw new RangeError('request (' + n + ') exceeds available heap storage');
      this.heap = nw;
      return r | 0;
    },
    readString(a) {
      let s = '', c;
      while ((c = this.getByte(a)) !== 0) { s += String.fromCharCode(c); a = (a + 1) | 0; }
      return s;
    },
  });
  mem.heap = mem.cfg.heapBase;
})();
