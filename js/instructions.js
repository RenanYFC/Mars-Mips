/* MARS web - instruction set. Metadata comes from the original InstructionSet.java /
   PseudoOps.txt (see data.js); the simulate functions are ported by hand, one per basic instruction. */
(function () {
  const M = globalThis.MARS, CPU = M.cpu, mem = M.mem, S = M.settings;
  const R = CPU.regs, F = CPU.fp;
  const { hex8, intBitsToFloat: i2f, floatToIntBits: f2i, setReg, setFp } = M;
  const HI = 33, LO = 34;

  /* exceptions -------------------------------------------------------- */
  class ProcEx { // mirrors ProcessingException
    constructor(errors, cause, addr) { this.errors = errors; this.cause = cause; this.addr = addr; }
  }
  M.ProcEx = ProcEx;
  M.setException = function (cause, addr) {
    if (addr !== undefined) M.setC0(8, addr);
    M.setC0(13, (CPU.cp0[13] & 0xfffffc83) | (cause << 2));
    M.setC0(14, (CPU.pc - 4) | 0);
    M.setC0(12, CPU.cp0[12] | 2);
  };
  function rt(st, msg, cause) { // ProcessingException(ps, m, cause)
    const list = new M.ErrorList();
    list.add(new M.ErrorMessage(false, st.file, st.sourceLine, 0, 'Runtime exception at ' + hex8((CPU.pc - 4) | 0) + ': ' + msg, st.macroHistory || ''));
    if (cause !== undefined) M.setException(cause);
    return new ProcEx(list, cause);
  }
  M.runtimeError = rt;
  function addrErr(st, e) {
    const list = new M.ErrorList();
    list.add(new M.ErrorMessage(false, st.file, st.sourceLine, 0, 'Runtime exception at ' + hex8((CPU.pc - 4) | 0) + ': ' + e.message, st.macroHistory || ''));
    M.setException(e.type, e.address);
    return new ProcEx(list, e.type);
  }
  M.addrErrToEx = addrErr;
  const guard = (fn) => (o, st) => {
    try { fn(o, st); } catch (e) { if (e instanceof M.AddressError) throw addrErr(st, e); throw e; }
  };

  /* branch/jump helpers ------------------------------------------------ */
  const DB = (M.delayed = { state: 0, target: 0 }); // 0 cleared, 1 registered, 2 triggered
  const branch = (disp) => {
    if (S.delayedBranching) { DB.state = 1; DB.target = (CPU.pc + (disp << 2)) | 0; }
    else CPU.pc = (CPU.pc + (disp << 2)) | 0;
  };
  const jump = (t) => { if (S.delayedBranching) { DB.state = 1; DB.target = t; } else CPU.pc = t; };
  const retAddr = (r) => setReg(r, (CPU.pc + (S.delayedBranching ? 4 : 0)) | 0);
  const evens = (st, ...r) => {
    for (const x of r) if (x & 1) {
      throw rt(st, r.length === 1 ? 'first register must be even-numbered' : r.length === 2 ? 'both registers must be even-numbered' : 'all registers must be even-numbered');
    }
  };
  const flag = (n) => (CPU.flags >> n) & 1;
  const D = (n) => M.getDoubleReg(n), setD = (n, v) => M.setDoubleReg(n, v);
  const I = (n) => i2f(F[n]);
  const INT_MAX = 2147483647, INT_MIN = -2147483648;
  const toIntSat = (v) => (v !== v ? 0 : v >= INT_MAX ? INT_MAX : v <= INT_MIN ? INT_MIN : Math.trunc(v)); // Java (int) cast
  const inv = (v) => v !== v || v === Infinity || v === -Infinity || v < INT_MIN || v > INT_MAX;
  function roundEven(v, sp) {
    if (inv(v)) return INT_MAX;
    let below, above;
    if (v < 0) { above = Math.trunc(v); below = above - 1; } else { below = Math.trunc(v); above = below + 1; }
    if (v - below === above - v) return above % 2 === 0 ? above : below;
    return toIntSat(Math.floor(v + 0.5));
  }
  const addHiLo = (delta) => {
    const cur = (BigInt(R[HI]) << 32n) | BigInt(R[LO] >>> 0), s = BigInt.asIntN(64, cur + delta);
    setReg(HI, Number(BigInt.asIntN(32, s >> 32n))); setReg(LO, Number(BigInt.asIntN(32, s)));
  };
  const setHiLo = (p) => { setReg(HI, Number(BigInt.asIntN(32, p >> 32n))); setReg(LO, Number(BigInt.asIntN(32, p))); };
  const c1 = (fn) => (o) => M.setFlag(0, fn(o[0], o[1]));
  const c2 = (fn) => (o) => M.setFlag(o[0], fn(o[1], o[2]));
  const trap = (st) => { throw rt(st, 'trap', 13); };
  const se16 = (v) => (v << 16) >> 16;

  const impl = {
    'nop': () => {},
    'add $t1,$t2,$t3': (o, st) => {
      const a = R[o[1]], b = R[o[2]], s = (a + b) | 0;
      if ((a >= 0 && b >= 0 && s < 0) || (a < 0 && b < 0 && s >= 0)) throw rt(st, 'arithmetic overflow', 12);
      setReg(o[0], s);
    },
    'sub $t1,$t2,$t3': (o, st) => {
      const a = R[o[1]], b = R[o[2]], s = (a - b) | 0;
      if ((a >= 0 && b < 0 && s < 0) || (a < 0 && b >= 0 && s >= 0)) throw rt(st, 'arithmetic overflow', 12);
      setReg(o[0], s);
    },
    'addi $t1,$t2,-100': (o, st) => {
      const a = R[o[1]], b = se16(o[2]), s = (a + b) | 0;
      if ((a >= 0 && b >= 0 && s < 0) || (a < 0 && b < 0 && s >= 0)) throw rt(st, 'arithmetic overflow', 12);
      setReg(o[0], s);
    },
    'addu $t1,$t2,$t3': (o) => setReg(o[0], (R[o[1]] + R[o[2]]) | 0),
    'subu $t1,$t2,$t3': (o) => setReg(o[0], (R[o[1]] - R[o[2]]) | 0),
    'addiu $t1,$t2,-100': (o) => setReg(o[0], (R[o[1]] + se16(o[2])) | 0),
    'mult $t1,$t2': (o) => setHiLo(BigInt(R[o[0]]) * BigInt(R[o[1]])),
    'multu $t1,$t2': (o) => setHiLo(BigInt(R[o[0]] >>> 0) * BigInt(R[o[1]] >>> 0)),
    'mul $t1,$t2,$t3': (o) => {
      const p = BigInt(R[o[1]]) * BigInt(R[o[2]]);
      setHiLo(p); setReg(o[0], Number(BigInt.asIntN(32, p)));
    },
    'madd $t1,$t2': (o) => addHiLo(BigInt(R[o[0]]) * BigInt(R[o[1]])),
    'maddu $t1,$t2': (o) => addHiLo(BigInt(R[o[0]] >>> 0) * BigInt(R[o[1]] >>> 0)),
    'msub $t1,$t2': (o) => addHiLo(-(BigInt(R[o[0]]) * BigInt(R[o[1]]))),
    'msubu $t1,$t2': (o) => addHiLo(-(BigInt(R[o[0]] >>> 0) * BigInt(R[o[1]] >>> 0))),
    'div $t1,$t2': (o) => {
      const a = R[o[0]], b = R[o[1]]; if (b === 0) return;
      setReg(HI, (a % b) | 0); setReg(LO, Math.trunc(a / b) | 0);
    },
    'divu $t1,$t2': (o) => {
      const a = R[o[0]] >>> 0, b = R[o[1]] >>> 0; if (b === 0) return;
      setReg(HI, (a % b) | 0); setReg(LO, Math.floor(a / b) | 0);
    },
    'mfhi $t1': (o) => setReg(o[0], R[HI]),
    'mflo $t1': (o) => setReg(o[0], R[LO]),
    'mthi $t1': (o) => setReg(HI, R[o[0]]),
    'mtlo $t1': (o) => setReg(LO, R[o[0]]),
    'and $t1,$t2,$t3': (o) => setReg(o[0], R[o[1]] & R[o[2]]),
    'or $t1,$t2,$t3': (o) => setReg(o[0], R[o[1]] | R[o[2]]),
    'andi $t1,$t2,100': (o) => setReg(o[0], R[o[1]] & (o[2] & 0xffff)),
    'ori $t1,$t2,100': (o) => setReg(o[0], R[o[1]] | (o[2] & 0xffff)),
    'nor $t1,$t2,$t3': (o) => setReg(o[0], ~(R[o[1]] | R[o[2]])),
    'xor $t1,$t2,$t3': (o) => setReg(o[0], R[o[1]] ^ R[o[2]]),
    'xori $t1,$t2,100': (o) => setReg(o[0], R[o[1]] ^ (o[2] & 0xffff)),
    'sll $t1,$t2,10': (o) => setReg(o[0], R[o[1]] << o[2]),
    'sllv $t1,$t2,$t3': (o) => setReg(o[0], R[o[1]] << (R[o[2]] & 31)),
    'srl $t1,$t2,10': (o) => setReg(o[0], (R[o[1]] >>> o[2]) | 0),
    'sra $t1,$t2,10': (o) => setReg(o[0], R[o[1]] >> o[2]),
    'srav $t1,$t2,$t3': (o) => setReg(o[0], R[o[1]] >> (R[o[2]] & 31)),
    'srlv $t1,$t2,$t3': (o) => setReg(o[0], (R[o[1]] >>> (R[o[2]] & 31)) | 0),
    'lw $t1,-100($t2)': guard((o) => setReg(o[0], mem.getWord((R[o[2]] + se16(o[1])) | 0))),
    'll $t1,-100($t2)': guard((o) => setReg(o[0], mem.getWord((R[o[2]] + se16(o[1])) | 0))),
    'lwl $t1,-100($t2)': guard((o) => {
      const a = (R[o[2]] + se16(o[1])) | 0; let r = R[o[0]];
      const n = ((a % 4) + 4) % 4;
      for (let i = 0; i <= n; i++) { const sh = (3 - i) * 8; r = (r & ~(0xff << sh)) | (mem.getByte((a - i) | 0) << sh); }
      setReg(o[0], r);
    }),
    'lwr $t1,-100($t2)': guard((o) => {
      const a = (R[o[2]] + se16(o[1])) | 0; let r = R[o[0]];
      const n = ((a % 4) + 4) % 4;
      for (let i = 0; i <= 3 - n; i++) { const sh = i * 8; r = (r & ~(0xff << sh)) | (mem.getByte((a + i) | 0) << sh); }
      setReg(o[0], r);
    }),
    'sw $t1,-100($t2)': guard((o) => mem.setWord((R[o[2]] + se16(o[1])) | 0, R[o[0]])),
    'sc $t1,-100($t2)': guard((o) => { mem.setWord((R[o[2]] + se16(o[1])) | 0, R[o[0]]); setReg(o[0], 1); }),
    'swl $t1,-100($t2)': guard((o) => {
      const a = (R[o[2]] + se16(o[1])) | 0, s = R[o[0]], n = ((a % 4) + 4) % 4;
      for (let i = 0; i <= n; i++) mem.setByte((a - i) | 0, (s >>> ((3 - i) * 8)) & 0xff);
    }),
    'swr $t1,-100($t2)': guard((o) => {
      const a = (R[o[2]] + se16(o[1])) | 0, s = R[o[0]], n = ((a % 4) + 4) % 4;
      for (let i = 0; i <= 3 - n; i++) mem.setByte((a + i) | 0, (s >>> (i * 8)) & 0xff);
    }),
    'lui $t1,100': (o) => setReg(o[0], o[1] << 16),
    'beq $t1,$t2,label': (o) => { if (R[o[0]] === R[o[1]]) branch(o[2]); },
    'bne $t1,$t2,label': (o) => { if (R[o[0]] !== R[o[1]]) branch(o[2]); },
    'bgez $t1,label': (o) => { if (R[o[0]] >= 0) branch(o[1]); },
    'bgezal $t1,label': (o) => { if (R[o[0]] >= 0) { retAddr(31); branch(o[1]); } },
    'bgtz $t1,label': (o) => { if (R[o[0]] > 0) branch(o[1]); },
    'blez $t1,label': (o) => { if (R[o[0]] <= 0) branch(o[1]); },
    'bltz $t1,label': (o) => { if (R[o[0]] < 0) branch(o[1]); },
    'bltzal $t1,label': (o) => { if (R[o[0]] < 0) { retAddr(31); branch(o[1]); } },
    'slt $t1,$t2,$t3': (o) => setReg(o[0], R[o[1]] < R[o[2]] ? 1 : 0),
    'sltu $t1,$t2,$t3': (o) => setReg(o[0], (R[o[1]] >>> 0) < (R[o[2]] >>> 0) ? 1 : 0),
    'slti $t1,$t2,-100': (o) => setReg(o[0], R[o[1]] < se16(o[2]) ? 1 : 0),
    'sltiu $t1,$t2,-100': (o) => setReg(o[0], (R[o[1]] >>> 0) < (se16(o[2]) >>> 0) ? 1 : 0),
    'movn $t1,$t2,$t3': (o) => { if (R[o[2]] !== 0) setReg(o[0], R[o[1]]); },
    'movz $t1,$t2,$t3': (o) => { if (R[o[2]] === 0) setReg(o[0], R[o[1]]); },
    'movf $t1,$t2': (o) => { if (flag(0) === 0) setReg(o[0], R[o[1]]); },
    'movf $t1,$t2,1': (o) => { if (flag(o[2]) === 0) setReg(o[0], R[o[1]]); },
    'movt $t1,$t2': (o) => { if (flag(0) === 1) setReg(o[0], R[o[1]]); },
    'movt $t1,$t2,1': (o) => { if (flag(o[2]) === 1) setReg(o[0], R[o[1]]); },
    'break 100': (o, st) => { throw rt(st, 'break instruction executed; code = ' + o[0] + '.', 9); },
    'break': (o, st) => { throw rt(st, 'break instruction executed; no code given.', 9); },
    'syscall': (o, st) => M.doSyscall(R[2], st),
    'j target': (o) => jump((CPU.pc & 0xf0000000) | (o[0] << 2)),
    'jr $t1': (o) => jump(R[o[0]]),
    'jal target': (o) => { retAddr(31); jump((CPU.pc & 0xf0000000) | (o[0] << 2)); },
    'jalr $t1,$t2': (o) => { retAddr(o[0]); jump(R[o[1]]); },
    'jalr $t1': (o) => { retAddr(31); jump(R[o[0]]); },
    'lb $t1,-100($t2)': guard((o) => setReg(o[0], (mem.getByte((R[o[2]] + se16(o[1])) | 0) << 24) >> 24)),
    'lh $t1,-100($t2)': guard((o) => setReg(o[0], (mem.getHalf((R[o[2]] + se16(o[1])) | 0) << 16) >> 16)),
    'lhu $t1,-100($t2)': guard((o) => setReg(o[0], mem.getHalf((R[o[2]] + se16(o[1])) | 0))),
    'lbu $t1,-100($t2)': guard((o) => setReg(o[0], mem.getByte((R[o[2]] + se16(o[1])) | 0))),
    'sb $t1,-100($t2)': guard((o) => mem.setByte((R[o[2]] + se16(o[1])) | 0, R[o[0]] & 0xff)),
    'sh $t1,-100($t2)': guard((o) => mem.setHalf((R[o[2]] + se16(o[1])) | 0, R[o[0]] & 0xffff)),
    'clo $t1,$t2': (o) => setReg(o[0], Math.clz32(~R[o[1]])),
    'clz $t1,$t2': (o) => setReg(o[0], Math.clz32(R[o[1]])),
    'mfc0 $t1,$8': (o) => setReg(o[0], CPU.cp0[o[1]] | 0),
    'mtc0 $t1,$8': (o) => M.setC0(o[1], R[o[0]]),
    'add.s $f0,$f1,$f3': (o) => setFp(o[0], f2i(Math.fround(I(o[1]) + I(o[2])))),
    'sub.s $f0,$f1,$f3': (o) => setFp(o[0], f2i(Math.fround(I(o[1]) - I(o[2])))),
    'mul.s $f0,$f1,$f3': (o) => setFp(o[0], f2i(Math.fround(I(o[1]) * I(o[2])))),
    'div.s $f0,$f1,$f3': (o) => setFp(o[0], f2i(Math.fround(I(o[1]) / I(o[2])))),
    'sqrt.s $f0,$f1': (o) => { const v = I(o[1]); setFp(o[0], v < 0 ? f2i(NaN) : f2i(Math.fround(Math.sqrt(v)))); },
    'floor.w.s $f0,$f1': (o) => { const v = I(o[1]); setFp(o[0], inv(v) ? INT_MAX : toIntSat(Math.floor(v))); },
    'ceil.w.s $f0,$f1': (o) => { const v = I(o[1]); setFp(o[0], inv(v) ? INT_MAX : toIntSat(Math.ceil(v))); },
    'round.w.s $f0,$f1': (o) => setFp(o[0], roundEven(I(o[1]))),
    'trunc.w.s $f0,$f1': (o) => { const v = I(o[1]); setFp(o[0], inv(v) ? INT_MAX : toIntSat(v)); },
    'add.d $f2,$f4,$f6': (o, st) => { evens(st, o[0], o[1], o[2]); setD(o[0], D(o[1]) + D(o[2])); },
    'sub.d $f2,$f4,$f6': (o, st) => { evens(st, o[0], o[1], o[2]); setD(o[0], D(o[1]) - D(o[2])); },
    'mul.d $f2,$f4,$f6': (o, st) => { evens(st, o[0], o[1], o[2]); setD(o[0], D(o[1]) * D(o[2])); },
    'div.d $f2,$f4,$f6': (o, st) => { evens(st, o[0], o[1], o[2]); setD(o[0], D(o[1]) / D(o[2])); },
    'sqrt.d $f2,$f4': (o, st) => { evens(st, o[0], o[1]); const v = D(o[1]); setD(o[0], v < 0 ? NaN : Math.sqrt(v)); },
    'floor.w.d $f1,$f2': (o, st) => { if (o[1] & 1) throw rt(st, 'second register must be even-numbered'); const v = D(o[1]); setFp(o[0], inv(v) ? INT_MAX : toIntSat(Math.floor(v))); },
    'ceil.w.d $f1,$f2': (o, st) => { if (o[1] & 1) throw rt(st, 'second register must be even-numbered'); const v = D(o[1]); setFp(o[0], inv(v) ? INT_MAX : toIntSat(Math.ceil(v))); },
    'round.w.d $f1,$f2': (o, st) => { if (o[1] & 1) throw rt(st, 'second register must be even-numbered'); setFp(o[0], roundEven(D(o[1]))); },
    'trunc.w.d $f1,$f2': (o, st) => { if (o[1] & 1) throw rt(st, 'second register must be even-numbered'); const v = D(o[1]); setFp(o[0], inv(v) ? INT_MAX : toIntSat(v)); },
    'bc1t label': (o) => { if (flag(0) === 1) branch(o[0]); },
    'bc1t 1,label': (o) => { if (flag(o[0]) === 1) branch(o[1]); },
    'bc1f label': (o) => { if (flag(0) === 0) branch(o[0]); },
    'bc1f 1,label': (o) => { if (flag(o[0]) === 0) branch(o[1]); },
    'c.eq.s $f0,$f1': c1((a, b) => I(a) === I(b)),
    'c.eq.s 1,$f0,$f1': c2((a, b) => I(a) === I(b)),
    'c.le.s $f0,$f1': c1((a, b) => I(a) <= I(b)),
    'c.le.s 1,$f0,$f1': c2((a, b) => I(a) <= I(b)),
    'c.lt.s $f0,$f1': c1((a, b) => I(a) < I(b)),
    'c.lt.s 1,$f0,$f1': c2((a, b) => I(a) < I(b)),
    'c.eq.d $f2,$f4': (o, st) => { evens(st, o[0], o[1]); M.setFlag(0, D(o[0]) === D(o[1])); },
    'c.eq.d 1,$f2,$f4': (o, st) => { evens(st, o[1], o[2]); M.setFlag(o[0], D(o[1]) === D(o[2])); },
    'c.le.d $f2,$f4': (o, st) => { evens(st, o[0], o[1]); M.setFlag(0, D(o[0]) <= D(o[1])); },
    'c.le.d 1,$f2,$f4': (o, st) => { evens(st, o[1], o[2]); M.setFlag(o[0], D(o[1]) <= D(o[2])); },
    'c.lt.d $f2,$f4': (o, st) => { evens(st, o[0], o[1]); M.setFlag(0, D(o[0]) < D(o[1])); },
    'c.lt.d 1,$f2,$f4': (o, st) => { evens(st, o[1], o[2]); M.setFlag(o[0], D(o[1]) < D(o[2])); },
    'abs.s $f0,$f1': (o) => setFp(o[0], F[o[1]] & INT_MAX),
    'abs.d $f2,$f4': (o, st) => { evens(st, o[0], o[1]); setFp(o[0] + 1, F[o[1] + 1] & INT_MAX); setFp(o[0], F[o[1]]); },
    'cvt.d.s $f2,$f1': (o, st) => { if (o[0] & 1) throw rt(st, 'first register must be even-numbered'); setD(o[0], I(o[1])); },
    'cvt.d.w $f2,$f1': (o, st) => { if (o[0] & 1) throw rt(st, 'first register must be even-numbered'); setD(o[0], F[o[1]]); },
    'cvt.s.d $f1,$f2': (o, st) => { if (o[1] & 1) throw rt(st, 'second register must be even-numbered'); setFp(o[0], f2i(Math.fround(D(o[1])))); },
    'cvt.s.w $f0,$f1': (o) => setFp(o[0], f2i(Math.fround(F[o[1]]))),
    'cvt.w.d $f1,$f2': (o, st) => { if (o[1] & 1) throw rt(st, 'second register must be even-numbered'); setFp(o[0], toIntSat(D(o[1]))); },
    'cvt.w.s $f0,$f1': (o) => setFp(o[0], toIntSat(I(o[1]))),
    'mov.d $f2,$f4': (o, st) => { evens(st, o[0], o[1]); setFp(o[0], F[o[1]]); setFp(o[0] + 1, F[o[1] + 1]); },
    'movf.d $f2,$f4': (o, st) => { evens(st, o[0], o[1]); if (flag(0) === 0) { setFp(o[0], F[o[1]]); setFp(o[0] + 1, F[o[1] + 1]); } },
    'movf.d $f2,$f4,1': (o, st) => { evens(st, o[0], o[1]); if (flag(o[2]) === 0) { setFp(o[0], F[o[1]]); setFp(o[0] + 1, F[o[1] + 1]); } },
    'movt.d $f2,$f4': (o, st) => { evens(st, o[0], o[1]); if (flag(0) === 1) { setFp(o[0], F[o[1]]); setFp(o[0] + 1, F[o[1] + 1]); } },
    'movt.d $f2,$f4,1': (o, st) => { evens(st, o[0], o[1]); if (flag(o[2]) === 1) { setFp(o[0], F[o[1]]); setFp(o[0] + 1, F[o[1] + 1]); } },
    'movn.d $f2,$f4,$t3': (o, st) => { evens(st, o[0], o[1]); if (R[o[2]] !== 0) { setFp(o[0], F[o[1]]); setFp(o[0] + 1, F[o[1] + 1]); } },
    'movz.d $f2,$f4,$t3': (o, st) => { evens(st, o[0], o[1]); if (R[o[2]] === 0) { setFp(o[0], F[o[1]]); setFp(o[0] + 1, F[o[1] + 1]); } },
    'mov.s $f0,$f1': (o) => setFp(o[0], F[o[1]]),
    'movf.s $f0,$f1': (o) => { if (flag(0) === 0) setFp(o[0], F[o[1]]); },
    'movf.s $f0,$f1,1': (o) => { if (flag(o[2]) === 0) setFp(o[0], F[o[1]]); },
    'movt.s $f0,$f1': (o) => { if (flag(0) === 1) setFp(o[0], F[o[1]]); },
    'movt.s $f0,$f1,1': (o) => { if (flag(o[2]) === 1) setFp(o[0], F[o[1]]); },
    'movn.s $f0,$f1,$t3': (o) => { if (R[o[2]] !== 0) setFp(o[0], F[o[1]]); },
    'movz.s $f0,$f1,$t3': (o) => { if (R[o[2]] === 0) setFp(o[0], F[o[1]]); },
    'mfc1 $t1,$f1': (o) => setReg(o[0], F[o[1]]),
    'mtc1 $t1,$f1': (o) => setFp(o[1], R[o[0]]),
    'neg.d $f2,$f4': (o, st) => { evens(st, o[0], o[1]); setFp(o[0] + 1, F[o[1] + 1] ^ INT_MIN); setFp(o[0], F[o[1]]); },
    'neg.s $f0,$f1': (o) => setFp(o[0], F[o[1]] ^ INT_MIN),
    'lwc1 $f1,-100($t2)': guard((o) => setFp(o[0], mem.getWord((R[o[2]] + se16(o[1])) | 0))),
    'ldc1 $f2,-100($t2)': (o, st) => {
      if (o[0] & 1) throw rt(st, 'first register must be even-numbered');
      const a = (R[o[2]] + se16(o[1])) | 0;
      if (a & 7) throw addrErr(st, new M.AddressError('address not aligned on doubleword boundary ', 4, a));
      try { setFp(o[0], mem.getWord(a)); setFp(o[0] + 1, mem.getWord((a + 4) | 0)); } catch (e) { if (e instanceof M.AddressError) throw addrErr(st, e); throw e; }
    },
    'swc1 $f1,-100($t2)': guard((o) => mem.setWord((R[o[2]] + se16(o[1])) | 0, F[o[0]])),
    'sdc1 $f2,-100($t2)': (o, st) => {
      if (o[0] & 1) throw rt(st, 'first register must be even-numbered');
      const a = (R[o[2]] + se16(o[1])) | 0;
      if (a & 7) throw addrErr(st, new M.AddressError('address not aligned on doubleword boundary ', 5, a));
      try { mem.setWord(a, F[o[0]]); mem.setWord((a + 4) | 0, F[o[0] + 1]); } catch (e) { if (e instanceof M.AddressError) throw addrErr(st, e); throw e; }
    },
    'teq $t1,$t2': (o, st) => { if (R[o[0]] === R[o[1]]) trap(st); },
    'teqi $t1,-100': (o, st) => { if (R[o[0]] === se16(o[1])) trap(st); },
    'tne $t1,$t2': (o, st) => { if (R[o[0]] !== R[o[1]]) trap(st); },
    'tnei $t1,-100': (o, st) => { if (R[o[0]] !== se16(o[1])) trap(st); },
    'tge $t1,$t2': (o, st) => { if (R[o[0]] >= R[o[1]]) trap(st); },
    'tgeu $t1,$t2': (o, st) => { if ((R[o[0]] >>> 0) >= (R[o[1]] >>> 0)) trap(st); },
    'tgei $t1,-100': (o, st) => { if (R[o[0]] >= se16(o[1])) trap(st); },
    'tgeiu $t1,-100': (o, st) => { if ((R[o[0]] >>> 0) >= (se16(o[1]) >>> 0)) trap(st); },
    'tlt $t1,$t2': (o, st) => { if (R[o[0]] < R[o[1]]) trap(st); },
    'tltu $t1,$t2': (o, st) => { if ((R[o[0]] >>> 0) < (R[o[1]] >>> 0)) trap(st); },
    'tlti $t1,-100': (o, st) => { if (R[o[0]] < se16(o[1])) trap(st); },
    'tltiu $t1,-100': (o, st) => { if ((R[o[0]] >>> 0) < (se16(o[1]) >>> 0)) trap(st); },
    'eret': () => { M.setC0(12, CPU.cp0[12] & ~2); CPU.pc = CPU.cp0[14]; },
  };

  /* build instruction list ---------------------------------------------- */
  const list = (M.instructions = []);
  for (const [example, desc, format, maskStr] of M.DATA.basic) {
    const mask = maskStr.replace(/ /g, '');
    let om = 0, match = 0;
    for (let i = 0; i < 32; i++) {
      const c = mask[i];
      if (c === '0' || c === '1') { om |= 1 << (31 - i); if (c === '1') match |= 1 << (31 - i); }
    }
    if (!impl[example]) throw new Error('missing impl ' + example);
    list.push({ basic: true, example, desc, format, mask, opMask: om, opMatch: match, name: example.split(' ')[0], sim: impl[example], len: 4 });
  }
  for (const line of M.DATA.pseudo) {
    const parts = line.split('\t').filter((t) => t.length);
    const example = parts[0];
    let desc = '', tmpl = [], first = null;
    for (let i = 1; i < parts.length; i++) {
      const t = parts[i];
      if (t[0] === '#') { desc = t.slice(1); break; }
      if (t.startsWith('COMPACT')) { first = tmpl; tmpl = []; continue; }
      tmpl.push(t);
    }
    const inst = { basic: false, example, desc, name: example.split(' ')[0],
      templates: first || tmpl, compact: first ? tmpl : null };
    Object.defineProperty(inst, 'len', { get() { return tlen(this.templates); } });
    Object.defineProperty(inst, 'compactLen', { get() { return tlen(this.compact); } });
    list.push(inst);
  }
  function tlen(t) { let n = 0; for (const x of t) { if (x.includes('DBNOP') && !S.delayedBranching) continue; n++; } return n * 4; }
  const byName = (M.instByName = new Map());
  for (const i of list) { const k = i.name.toLowerCase(); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(i); }
  M.matchOperator = (n) => byName.get(n.toLowerCase()) || null;
  M.prefixMatch = (p) => { const q = p.toLowerCase(); return list.filter((i) => i.name.toLowerCase().startsWith(q)); };

  /* binary decoder (self-modifying code, Text Segment edits) */
  const maskGroups = [...new Set(list.filter((i) => i.basic).map((i) => i.opMask))]
    .sort((a, b) => { const c = (x) => { let k = 0, n = x; while (n) { k++; n &= n - 1; } return k; }; return c(b) - c(a) || a - b; });
  const matchMap = new Map();
  for (const i of list) if (i.basic) matchMap.set(i.opMask + ':' + i.opMatch, i);
  M.findByBinary = function (b) {
    for (const m of maskGroups) { const r = matchMap.get(m + ':' + (b & m)); if (r) return r; }
    return null;
  };
  M.statementFromBinary = function (bin, addr) {
    const inst = M.findByBinary(bin);
    const st = { binary: bin, address: addr, source: '', sourceLine: 0, file: '', inst, ops: [0, 0, 0, 0], basicParts: [] };
    if (!inst) { st.inst = bin === 0 ? M.matchOperator('nop')[0] : null; st.basicParts = [{ t: 'x', v: 'undefined' }]; return st; }
    let n = 0;
    for (const code of 'fst') {
      const j = inst.mask.indexOf(code);
      if (j >= 0) {
        const k0 = 31 - inst.mask.lastIndexOf(code), k1 = 31 - j;
        let op = (bin >> k0) & (k1 - k0 + 1 === 32 ? -1 : (1 << (k1 - k0 + 1)) - 1);
        if (inst.format === 'I_BRANCH_FORMAT' && n === 2) op = se16(op);
        else if (inst.format === 'J_FORMAT' && n === 0) op |= (addr >> 2) & 0x3c000000;
        st.ops[n++] = op;
      }
    }
    const toks = M.tokenizeExample(inst);
    let k = 0, parts = [{ t: 'x', v: toks[0].value + ' ' }];
    for (let i = 1; i < toks.length; i++) {
      const tk = toks[i];
      if (tk.type === 'LEFT_PAREN' || tk.type === 'RIGHT_PAREN') parts.push({ t: 'x', v: tk.value });
      else {
        const v = st.ops[k++];
        if (tk.type === 'REGISTER_NAME' || tk.type === 'REGISTER_NUMBER') parts.push({ t: 'x', v: '$' + v });
        else if (tk.type === 'FP_REGISTER_NAME') parts.push({ t: 'x', v: '$f' + v });
        else if (tk.type === 'IDENTIFIER') parts.push(inst.format === 'J_FORMAT' ? { t: 'a', v: (v << 2) | 0 } : { t: 'v', v });
        else parts.push({ t: 'v', v });
      }
      if (i < toks.length - 1) {
        const nx = toks[i + 1].type;
        if (tk.type !== 'LEFT_PAREN' && tk.type !== 'RIGHT_PAREN' && nx !== 'LEFT_PAREN' && nx !== 'RIGHT_PAREN') parts.push({ t: 'x', v: ',' });
      }
    }
    st.basicParts = parts;
    return st;
  };
  M.formatBasic = function (st) {
    const addrHex = S.addrHex, valHex = S.valHex;
    let r = '';
    for (const p of st.basicParts) {
      if (p.t === 'x') r += p.v;
      else if (p.t === 'a') r += addrHex ? hex8(p.v) : String(p.v | 0);
      else r += valHex ? hex8(p.v) : String(p.v | 0);
    }
    return r;
  };
})();
