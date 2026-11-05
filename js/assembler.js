/* MARS web - tokenizer, macro processor and two-pass assembler.
   Port of mars.assembler.* , mars.ProgramStatement and ExtendedInstruction template substitution. */
(function () {
  const M = globalThis.MARS, mem = M.mem, S = M.settings, CPU = M.cpu;
  const { stringToInt, isInt, parseDouble, NFE, ProcEx } = M;

  /* errors ----------------------------------------------------------- */
  class ErrorMessage {
    constructor(isWarning, file, line, pos, message, hist) {
      this.isWarning = isWarning; this.file = file || ''; this.line = line; this.pos = pos; this.message = message; this.hist = hist || '';
    }
    static of(isWarning, program, line, pos, message) {
      let file = '', ln = line, hist = '';
      if (program) {
        const sl = program.sourceLines && program.sourceLines[line - 1];
        if (sl) { file = sl.program.name; ln = sl.lineNumber; } else file = program.name;
        if (program.macros) { const h = program.macros.history(); if (h) hist = h + '->'; }
      }
      return new ErrorMessage(isWarning, file, ln, pos, message, hist);
    }
  }
  class ErrorList {
    constructor() { this.messages = []; this.errorCount = 0; this.warningCount = 0; }
    add(m) {
      if (this.errorCount > 200) return;
      if (this.errorCount === 200) { this.messages.push(new ErrorMessage(false, '', m.line, m.pos, 'Error Limit of 200 exceeded.')); this.errorCount++; return; }
      this.messages.push(m);
      if (m.isWarning) this.warningCount++; else this.errorCount++;
    }
    get limitExceeded() { return this.errorCount > 200; }
    get hasErrors() { return this.errorCount !== 0; }
    get hasWarnings() { return this.warningCount !== 0; }
    report(warn) {
      let r = '';
      for (const m of this.messages) {
        if (m.isWarning !== warn) continue;
        let l = (warn ? 'Warning' : 'Error') + ' in ';
        if (m.file.length) l += m.file;
        if (m.line > 0) l += ' line ' + m.hist + m.line;
        if (m.pos > 0) l += ' column ' + m.pos;
        r += l + ': ' + m.message + '\n';
      }
      return r;
    }
    errorReport() { return this.report(false); }
    warningReport() { return this.report(true); }
    fullReport() { return this.report(true) + this.report(false); }
  }
  M.ErrorMessage = ErrorMessage; M.ErrorList = ErrorList;

  /* tokens ------------------------------------------------------------ */
  const DIRECTIVES = new Map(M.DATA.directives.map((d) => [d[0], d[1]]));
  const matchDirective = (v) => { const l = v.toLowerCase(); return DIRECTIVES.has(l) ? l : null; };
  M.directives = M.DATA.directives;
  const isLetter = (c) => /\p{L}/u.test(c), isLetDig = (c) => /[\p{L}\p{Nd}]/u.test(c);
  function isValidIdentifier(v) {
    const c = v[0];
    if (!(isLetter(c) || c === '_' || c === '.' || c === '$')) return false;
    for (let i = 1; i < v.length; i++) { const d = v[i]; if (!(isLetDig(d) || d === '_' || d === '.' || d === '$')) return false; }
    return true;
  }
  function isMacroParam(v, spim) {
    if (spim && v.length > 0 && v[0] === '$' && M.getUserRegister(v) < 0 && !M.isC0Register(v) && M.getFpRegister(v) < 0) return true;
    return v.length > 1 && v[0] === '%';
  }
  function matchTokenType(v) {
    const c = v[0];
    if (c === "'") return 'ERROR';
    if (c === '#') return 'COMMENT';
    if (v.length === 1) {
      if (c === '(') return 'LEFT_PAREN'; if (c === ')') return 'RIGHT_PAREN'; if (c === ':') return 'COLON';
      if (c === '+') return 'PLUS'; if (c === '-') return 'MINUS';
    }
    if (isMacroParam(v, false)) return 'MACRO_PARAMETER';
    const r = M.getUserRegister(v);
    if (r >= 0) return M.isRegName(v) ? 'REGISTER_NAME' : 'REGISTER_NUMBER';
    if (M.getFpRegister(v) >= 0) return 'FP_REGISTER_NAME';
    if (isInt(v)) {
      const i = stringToInt(v);
      if (i >= 0 && i <= 31) return 'INTEGER_5';
      if (i >= 0 && i <= 65535) return 'INTEGER_16U';
      if (i >= -32768 && i <= 32767) return 'INTEGER_16';
      return 'INTEGER_32';
    }
    try { parseDouble(v); return 'REAL_NUMBER'; } catch (e) { /* no */ }
    if (M.matchOperator(v)) return 'OPERATOR';
    if (c === '.' && matchDirective(v)) return 'DIRECTIVE';
    if (c === '"') return 'QUOTED_STRING';
    if (isValidIdentifier(v)) return 'IDENTIFIER';
    return 'ERROR';
  }
  M.matchTokenType = matchTokenType;
  const isIntT = (t) => t === 'INTEGER_5' || t === 'INTEGER_16' || t === 'INTEGER_16U' || t === 'INTEGER_32';
  const isFltT = (t) => t === 'REAL_NUMBER';

  const ESC = "'\"\\ntbrf0", ESCV = ['39', '34', '92', '10', '9', '8', '13', '12', '0'];
  function charLiteral(v) {
    if (v.length < 3 || v[0] !== "'" || v[v.length - 1] !== "'") return v;
    const q = v.slice(1, -1);
    if (q[0] !== '\\') return q.length === 1 ? String(q.charCodeAt(0)) : v;
    if (q.length === 2) { const i = ESC.indexOf(q[1]); return i >= 0 ? ESCV[i] : v; }
    if (q.length === 4 && /^[0-7]{3}$/.test(q.slice(1))) { const n = parseInt(q.slice(1), 8); if (n <= 255) return String(n); }
    return v;
  }
  const isDigit = (c) => c >= '0' && c <= '9';

  class Tokenizer {
    constructor(program) { this.errors = new ErrorList(); this.program = program || null; this.eqv = null; }
    candidate(tok, program, line, theLine, start, result) {
      let value = tok;
      if (value.length > 0 && value[0] === "'") value = charLiteral(value);
      const type = matchTokenType(value);
      if (type === 'ERROR') this.errors.add(ErrorMessage.of(false, program, line, start, theLine + '\nInvalid language element: ' + value));
      result.push({ type, value, program, line, pos: start, toString() { return this.value; } });
    }
    tokenizeLine(lineNum, theLine, callerErrors, doEqv) {
      const save = this.errors;
      if (callerErrors) this.errors = callerErrors;
      const r = this.tok(this.program, lineNum, theLine, doEqv !== false);
      this.errors = save;
      return r;
    }
    tok(program, lineNum, theLine, doEqv) {
      const result = [];
      result.processedLine = '';
      if (theLine.length === 0) return result;
      const line = theLine; let linePos = 0, token = '', start = 1, inQ = false;
      const flush = () => { if (token.length > 0) { this.candidate(token, program, lineNum, theLine, start, result); token = ''; } };
      while (linePos < line.length) {
        let c = line[linePos];
        if (inQ) {
          token += c;
          if (c === '"' && token[token.length - 2] !== '\\') { this.candidate(token, program, lineNum, theLine, start, result); token = ''; inQ = false; }
        } else {
          switch (c) {
            case '#':
              flush(); start = linePos + 1; token = line.slice(linePos);
              this.candidate(token, program, lineNum, theLine, start, result); linePos = line.length; token = '';
              break;
            case ' ': case '\t': case ',':
              flush(); break;
            case '+': case '-':
              if (token.length > 0 && line.length >= linePos + 2 && isDigit(line[linePos + 1]) && (line[linePos - 1] === 'e' || line[linePos - 1] === 'E')) { token += c; break; }
              flush(); start = linePos + 1; token += c;
              if (!((result.length === 0 || result[result.length - 1].type !== 'IDENTIFIER') && line.length >= linePos + 2 && isDigit(line[linePos + 1]))) {
                this.candidate(token, program, lineNum, theLine, start, result); token = '';
              }
              break;
            case ':': case '(': case ')':
              flush(); start = linePos + 1; token += c;
              this.candidate(token, program, lineNum, theLine, start, result); token = '';
              break;
            case '"':
              flush(); start = linePos + 1; token += c; inQ = true; break;
            case "'": {
              flush(); start = linePos + 1; token += c;
              const look = line.length - linePos - 1;
              if (look < 2) break;
              c = line[++linePos]; token += c;
              if (c === "'") break;
              c = line[++linePos]; token += c;
              if ((c === "'" && token[1] !== '\\') || look === 2) { this.candidate(token, program, lineNum, theLine, start, result); token = ''; start = linePos + 1; break; }
              c = line[++linePos]; token += c;
              if (c === "'" || look === 3) { this.candidate(token, program, lineNum, theLine, start, result); token = ''; start = linePos + 1; break; }
              if (look >= 5) {
                c = line[++linePos]; token += c;
                if (c !== "'") { c = line[++linePos]; token += c; }
              }
              this.candidate(token, program, lineNum, theLine, start, result); token = ''; start = linePos + 1;
              break;
            }
            default:
              if (token.length === 0) start = linePos + 1;
              token += c;
          }
        }
        linePos++;
      }
      flush();
      return doEqv ? this.processEqv(program, lineNum, theLine, result) : result;
    }
    processEqv(program, lineNum, theLine, tokens) {
      const err = (pos, m) => this.errors.add(ErrorMessage.of(false, program, lineNum, pos, m));
      if (tokens.length > 2 && (tokens[0].type === 'DIRECTIVE' || tokens[2].type === 'DIRECTIVE')) {
        const dp = tokens[0].type === 'DIRECTIVE' ? 0 : 2;
        if (matchDirective(tokens[dp].value) === '.eqv') {
          const last = tokens.length - (tokens[tokens.length - 1].type === 'COMMENT' ? 2 : 1);
          if (last < dp + 2) { err(tokens[dp].pos, 'Too few operands for .eqv directive'); return tokens; }
          if (tokens[dp + 1].type !== 'IDENTIFIER') { err(tokens[dp].pos, 'Malformed .eqv directive'); return tokens; }
          const sym = tokens[dp + 1].value;
          for (let i = dp + 2; i < tokens.length; i++) {
            if (tokens[i].value === sym) { err(tokens[dp].pos, 'Cannot substitute ' + sym + ' for itself in .eqv directive'); return tokens; }
          }
          const s0 = tokens[dp + 2].pos, e0 = tokens[last].pos + tokens[last].value.length;
          const expr = theLine.substring(s0 - 1, e0 - 1);
          if (this.eqv.has(sym) && this.eqv.get(sym) !== expr) { err(tokens[dp + 1].pos, '"' + sym + '" is already defined'); return tokens; }
          this.eqv.set(sym, expr);
          return tokens;
        }
      }
      let sub = false;
      for (const t of tokens) {
        if (t.type === 'IDENTIFIER' && this.eqv && this.eqv.has(t.value)) {
          const s = this.eqv.get(t.value);
          theLine = theLine.substring(0, t.pos - 1) + s + theLine.substring(t.pos + t.value.length - 1);
          sub = true; break;
        }
      }
      tokens.processedLine = theLine;
      return sub ? this.tok(program, lineNum, theLine, true) : tokens;
    }
    tokenizeProgram(p, files) {
      this.program = p; this.eqv = new Map();
      const source = this.includes(p, new Map(), files);
      p.sourceLines = source;
      const list = [];
      for (let i = 0; i < source.length; i++) {
        const src = source[i].source;
        const cur = this.tok(p, i + 1, src, true);
        list.push(cur);
        if (src.length > 0 && src !== cur.processedLine) source[i] = { source: cur.processedLine, program: source[i].program, lineNumber: source[i].lineNumber };
      }
      if (this.errors.hasErrors) throw new ProcEx(this.errors);
      return list;
    }
    includes(program, seen, files) {
      const out = [], src = program.lines;
      for (let i = 0; i < src.length; i++) {
        const line = src[i];
        const tl = this.tok(program, i + 1, line, false);
        let has = false;
        for (let k = 0; k < tl.length; k++) {
          if (tl[k].value.toLowerCase() === '.include' && tl.length > k + 1 && tl[k + 1].type === 'QUOTED_STRING') {
            const fn = tl[k + 1].value.slice(1, -1);
            const t = tl[k + 1];
            if (seen.has(fn)) { this.errors.add(ErrorMessage.of(false, program, t.line, t.pos, 'Recursive include of file ' + fn)); throw new ProcEx(this.errors); }
            seen.set(fn, fn);
            const base = fn.split(/[\\/]/).pop();
            const f = (files || []).find((x) => x.name === fn || x.name.split(/[\\/]/).pop() === base);
            if (!f) { this.errors.add(ErrorMessage.of(false, program, t.line, t.pos, 'Error reading include file ' + fn)); throw new ProcEx(this.errors); }
            const incl = new Program(f.name, f.text);
            out.push(...this.includes(incl, seen, files));
            has = true; break;
          }
        }
        if (!has) out.push({ source: line, program, lineNumber: i + 1 });
      }
      return out;
    }
  }

  /* examples -------------------------------------------------------- */
  const exTok = new Tokenizer(null);
  M.tokenizeExample = function (inst) {
    if (!inst.tokens) inst.tokens = exTok.tok(null, 0, inst.example, false);
    return inst.tokens;
  };

  /* program & symbol tables ------------------------------------------ */
  class SymbolTable {
    constructor() { this.table = []; this.map = new Map(); }
    add(token, address, isData, errors) {
      if (this.map.has(token.value)) {
        errors.add(ErrorMessage.of(false, token.program, token.line, token.pos, 'label "' + token.value + '" already defined'));
      } else { const s = { name: token.value, address, isData }; this.table.push(s); this.map.set(s.name, s); }
    }
    get(n) { return this.map.get(n) || null; }
    addr(n) { const s = this.map.get(n); return s ? s.address : -1; }
    byAddr(a) { for (const s of this.table) if (s.address === a) return s; return null; }
    remove(n) { const s = this.map.get(n); if (s) { this.map.delete(n); this.table.splice(this.table.indexOf(s), 1); } }
    fix(oldA, newA) { for (const s of this.table) if (s.address === oldA && s.isData) s.address = newA; }
    clear() { this.table = []; this.map = new Map(); }
  }
  const globalSymbols = (M.globalSymbols = new SymbolTable());

  class MacroPool {
    constructor(program) { this.program = program; this.list = []; this.current = null; this.stack = []; this.orig = []; this.counter = 0; }
    begin(tok) {
      this.current = { name: tok.value, from: tok.line, origFrom: origLine(tok), to: 0, program: this.program, args: [], labels: [] };
    }
    commit(tok) { this.current.to = tok.line; this.current.labels.sort(); this.list.push(this.current); this.current = null; }
    match(tokens) {
      if (tokens.length < 1) return null;
      let ret = null;
      for (const m of this.list) if (m.name === tokens[0].value && m.args.length + 1 === tokens.length && (!ret || ret.from < m.from)) ret = m;
      return ret;
    }
    anyName(v) { return this.list.some((m) => m.name === v); }
    push(tok) {
      if (this.stack.includes(tok.line)) return true;
      this.stack.push(tok.line); this.orig.push(origLine(tok)); return false;
    }
    pop() { this.stack.pop(); this.orig.pop(); }
    history() { return this.orig.join('->'); }
  }
  const origLine = (tok) => { const sl = tok.program && tok.program.sourceLines && tok.program.sourceLines[tok.line - 1]; return sl ? sl.lineNumber : tok.line; };
  function macroSubstituted(m, line, args, counter, errors) {
    const tokens = m.program.tokenList[line - 1];
    let s = m.program.sourceLines[line - 1].source;
    const rep = (src, tk, sub) => { const p = src.indexOf(tk.value); return p < 0 ? src : src.slice(0, p) + sub + src.slice(p + tk.value.length); };
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (isMacroParam(t.value, true)) {
        const r = m.args.indexOf(t.value);
        let sub = t.value;
        if (r !== -1) sub = String(args[r + 1].value);
        else errors.add(ErrorMessage.of(false, m.program, t.line, t.pos, 'Unknown macro parameter'));
        s = rep(s, t, sub);
      } else if (m.labels.includes(t.value)) s = rep(s, t, t.value + '_M' + counter);
    }
    return s;
  }

  class Program {
    constructor(name, text) {
      this.name = name; this.lines = text.replace(/\r\n?/g, '\n').split('\n');
      if (this.lines.length && this.lines[this.lines.length - 1] === '' ) this.lines.pop();
      this.locals = new SymbolTable(); this.parsed = []; this.macros = null; this.tokenizer = null;
    }
  }

  /* operand checking -------------------------------------------------- */
  function msg(tok, m, errors) { errors.add(ErrorMessage.of(false, tok.program, tok.line, tok.pos, '"' + tok.value + '": ' + m)); }
  function operandMatch(cand, inst, errors) {
    const spec = M.tokenizeExample(inst);
    const num = cand.length - 1, req = spec.length - 1;
    if (num < req) { msg(cand[0], 'Too few or incorrectly formatted operands. Expected: ' + inst.example, errors); return false; }
    if (num > req) { msg(cand[0], 'Too many or incorrectly formatted operands. Expected: ' + inst.example, errors); return false; }
    for (let i = 1; i < spec.length; i++) {
      const c = cand[i], ct = c.type, st = spec[i].type;
      if (st === 'IDENTIFIER' && ct === 'OPERATOR') { cand[i] = Object.assign({}, c, { type: 'IDENTIFIER' }); continue; }
      if ((st === 'REGISTER_NAME' || st === 'REGISTER_NUMBER') && ct === 'REGISTER_NAME') continue;
      if (st === 'REGISTER_NAME' && ct === 'REGISTER_NUMBER') continue;
      if ((st === 'INTEGER_16' && ct === 'INTEGER_5') || (st === 'INTEGER_16U' && ct === 'INTEGER_5') || (st === 'INTEGER_32' && ct === 'INTEGER_5') ||
        (st === 'INTEGER_32' && ct === 'INTEGER_16U') || (st === 'INTEGER_32' && ct === 'INTEGER_16')) continue;
      if (ct === 'INTEGER_16U' || ct === 'INTEGER_16') {
        const v = stringToInt(c.value);
        if (st === 'INTEGER_16' && ct === 'INTEGER_16U' && v >= -32768 && v <= 32767) continue;
        if (st === 'INTEGER_16U' && ct === 'INTEGER_16' && v >= 0 && v <= 65535) continue;
      }
      if ((st === 'INTEGER_5' && (ct === 'INTEGER_16' || ct === 'INTEGER_16U' || ct === 'INTEGER_32')) || (st === 'INTEGER_16' && (ct === 'INTEGER_16U' || ct === 'INTEGER_32')) ||
        (st === 'INTEGER_16U' && (ct === 'INTEGER_16' || ct === 'INTEGER_32'))) { msg(c, 'operand is out of range', errors); return false; }
      if (ct !== st) { msg(c, 'operand is of incorrect type', errors); return false; }
    }
    return true;
  }
  function bestMatch(tokens, matches) {
    if (!matches) return null;
    if (matches.length === 1) return matches[0];
    for (const m of matches) if (operandMatch(tokens, m, new ErrorList())) return m;
    return matches[0];
  }

  /* template substitution ---------------------------------------------- */
  const subst = (o, f, r) => (o.indexOf(f) < 0 || f === r ? o : o.split(f).join(r));
  const substFirst = (o, f, r) => { const i = o.indexOf(f); return i < 0 || f === r ? o : o.slice(0, i) + r + o.slice(i + f.length); };
  const toI = (s) => { try { return stringToInt(s); } catch (e) { return 0; } };
  const bit15 = (v) => (v >> 15) & 1;
  const lo16s = (v) => (v << 16) >> 16;
  function template(program, t, toks) {
    let ins = t, idx;
    if (ins.indexOf('DBNOP') >= 0) return S.delayedBranching ? 'nop' : '';
    for (let op = 1; op < toks.length; op++) {
      const val = toks[op].value;
      ins = subst(ins, 'RG' + op, val); ins = subst(ins, 'OP' + op, val);
      if ((idx = ins.indexOf('LH' + op + 'P')) >= 0) {
        const add = ins.charCodeAt(idx + 4) - 48, a = (toI(val) + add) | 0;
        ins = subst(ins, 'LH' + op + 'P' + add, String((a >> 16) + bit15(a)));
      }
      if (ins.indexOf('LH' + op) >= 0) { const a = toI(val); ins = subst(ins, 'LH' + op, String((a >> 16) + bit15(a))); }
      if ((idx = ins.indexOf('LL' + op + 'P')) >= 0) {
        const add = ins.charCodeAt(idx + 4) - 48, a = (toI(val) + add) | 0;
        ins = subst(ins, 'LL' + op + 'P' + add, String(lo16s(a)));
      }
      if ((idx = ins.indexOf('LL' + op)) >= 0) {
        const a = toI(val);
        if (ins[idx + 3] === 'U') ins = subst(ins, 'LL' + op + 'U', String(a & 0xffff));
        else ins = subst(ins, 'LL' + op, String(lo16s(a)));
      }
      if ((idx = ins.indexOf('VHL' + op + 'P')) >= 0) {
        const add = ins.charCodeAt(idx + 5) - 48, v = (toI(val) + add) | 0;
        ins = subst(ins, 'VHL' + op + 'P' + add, String(v >> 16));
      }
      if ((idx = ins.indexOf('VH' + op + 'P')) >= 0) {
        const add = ins.charCodeAt(idx + 4) - 48, v = (toI(val) + add) | 0;
        ins = subst(ins, 'VH' + op + 'P' + add, String((v >> 16) + bit15(v)));
      }
      if (ins.indexOf('VH' + op) >= 0) { const v = toI(val); ins = subst(ins, 'VH' + op, String((v >> 16) + bit15(v))); }
      if ((idx = ins.indexOf('VL' + op + 'P')) >= 0) {
        const add = ins.charCodeAt(idx + 4) - 48, v = (toI(val) + add) | 0;
        if (ins[idx + 5] === 'U') ins = subst(ins, 'VL' + op + 'P' + add + 'U', String(v & 0xffff));
        else ins = subst(ins, 'VL' + op + 'P' + add, String(lo16s(v)));
      }
      if ((idx = ins.indexOf('VL' + op)) >= 0) {
        const v = toI(val);
        if (ins[idx + 3] === 'U') ins = subst(ins, 'VL' + op + 'U', String(v & 0xffff));
        else ins = subst(ins, 'VL' + op, String(lo16s(v)));
      }
      if (ins.indexOf('VHL' + op) >= 0) { ins = subst(ins, 'VHL' + op, String(toI(val) >> 16)); }
    }
    const t2 = () => toI(toks[2].value), t4 = () => toI(toks[4].value);
    if (ins.indexOf('LHL') >= 0) ins = subst(ins, 'LHL', String(t2() >> 16));
    if ((idx = ins.indexOf('LHPAP')) >= 0) {
      const add = ins.charCodeAt(idx + 5) - 48, a = (t2() + t4() + add) | 0;
      ins = subst(ins, 'LHPAP' + add, String((a >> 16) + bit15(a)));
    }
    if (ins.indexOf('LHPA') >= 0) { const a = (t2() + t4()) | 0; ins = subst(ins, 'LHPA', String((a >> 16) + bit15(a))); }
    if (ins.indexOf('LHPN') >= 0) { const a = (t2() + t4()) | 0; ins = subst(ins, 'LHPN', String(a >> 16)); }
    if ((idx = ins.indexOf('LLPP')) >= 0) {
      const add = ins.charCodeAt(idx + 4) - 48, a = (t2() + t4() + add) | 0;
      ins = subst(ins, 'LLPP' + add, String(lo16s(a)));
    }
    if ((idx = ins.indexOf('LLP')) >= 0) {
      const a = (t2() + t4()) | 0;
      if (ins[idx + 3] === 'U') ins = subst(ins, 'LLPU', String(a & 0xffff));
      else ins = subst(ins, 'LLP', String(lo16s(a)));
    }
    if ((idx = ins.indexOf('BROFF')) >= 0) {
      const d = ins[idx + 5], e = ins[idx + 6];
      ins = subst(ins, 'BROFF' + d + e, S.delayedBranching ? e : d);
    }
    if (ins.indexOf('NR') >= 0) {
      for (let op = 1; op < toks.length; op++) {
        const tv = toks[op].value, r = M.getUserRegister(tv);
        if (r >= 0) ins = subst(ins, 'NR' + op, '$' + (r + 1));
        else { const f = M.getFpRegister(tv); if (f >= 0) ins = subst(ins, 'NR' + op, '$f' + (f + 1)); }
      }
    }
    if (ins.indexOf('S32') >= 0) ins = subst(ins, 'S32', String(32 - toI(toks[toks.length - 1].value)));
    if (ins.indexOf('LAB') >= 0) {
      const a = toI(toks[toks.length - 1].value);
      const sym = program.locals.byAddr(a) || globalSymbols.byAddr(a);
      if (sym) ins = substFirst(ins, 'LAB', sym.name);
    }
    return ins;
  }

  /* statements --------------------------------------------------------- */
  function makeStatement(program, source, orig, stripped, inst, address, sourceLine) {
    return { program, file: program ? program.name : '', source, orig, tokens: stripped, inst, address, sourceLine, ops: [0, 0, 0, 0], numOps: 0, basicParts: [], basicText: null, binary: 0 };
  }
  function buildBasic(st, errors) {
    const toks = st.tokens; let first = toks[0].value + ' ';
    let basic = first; st.basicParts = [{ t: 'x', v: first }]; st.numOps = 0;
    const bp = st.basicParts, add = (t, v) => bp.push({ t, v });
    for (let i = 1; i < toks.length; i++) {
      const tk = toks[i], ty = tk.type, val = tk.value;
      if (ty === 'REGISTER_NUMBER') {
        basic += val; add('x', val);
        const n = M.getUserRegister(val);
        if (n < 0) { errors.add(ErrorMessage.of(false, st.program, tk.line, tk.pos, 'invalid register name')); return; }
        st.ops[st.numOps++] = n;
      } else if (ty === 'REGISTER_NAME') {
        const n = M.getUserRegister(val);
        basic += '$' + n; add('x', '$' + n); st.ops[st.numOps++] = n;
      } else if (ty === 'FP_REGISTER_NAME') {
        const n = M.getFpRegister(val);
        basic += '$f' + n; add('x', '$f' + n); st.ops[st.numOps++] = n;
      } else if (ty === 'IDENTIFIER') {
        let a = st.program.locals.addr(val);
        if (a === -1) a = globalSymbols.addr(val);
        if (a === -1) { errors.add(ErrorMessage.of(false, st.program, tk.line, tk.pos, 'Symbol "' + val + '" not found in symbol table.')); return; }
        let abs = true;
        if (st.inst.basic && st.inst.format === 'I_BRANCH_FORMAT') { a = (a - (st.address + 4)) >> 2; abs = false; }
        basic += a; add(abs ? 'a' : 'v', a); st.ops[st.numOps++] = a;
      } else if (isIntT(ty)) {
        const n = stringToInt(val);
        basic += n; add('v', n); st.ops[st.numOps++] = n;
      } else { basic += val; add('x', val); }
      if (i < toks.length - 1) {
        const nx = toks[i + 1].type;
        if (ty !== 'LEFT_PAREN' && ty !== 'RIGHT_PAREN' && nx !== 'LEFT_PAREN' && nx !== 'RIGHT_PAREN') { basic += ','; add('x', ','); }
      }
    }
    st.basicText = basic;
  }
  const OPMASK = ['f', 's', 't'];
  function insertBits(m, value, mask, st, errors) {
    const s = m.indexOf(mask), e = m.lastIndexOf(mask);
    if (s < 0) { errors.add(new ErrorMessage(false, st.file, st.sourceLine, 0, 'INTERNAL ERROR: mismatch in number of operands in statement vs mask')); return m; }
    const n = e - s + 1; let bits = '';
    for (let i = n - 1; i >= 0; i--) bits += (value >>> i) & 1;
    return m.slice(0, s) + bits + m.slice(e + 1);
  }
  function buildMachine(st, errors) {
    if (!st.inst.basic) { errors.add(new ErrorMessage(false, st.file, st.sourceLine, 0, 'INTERNAL ERROR: pseudo-instruction expansion contained a pseudo-instruction')); return; }
    let m = st.inst.mask;
    if (st.inst.format === 'J_FORMAT') {
      if ((st.address & 0xf0000000) !== (st.ops[0] & 0xf0000000)) { errors.add(new ErrorMessage(false, st.file, st.sourceLine, 0, 'Jump target word address beyond 26-bit range')); return; }
      st.ops[0] = st.ops[0] >>> 2;
      m = insertBits(m, st.ops[0], 'f', st, errors);
    } else for (let i = 0; i < st.numOps; i++) m = insertBits(m, st.ops[i], OPMASK[i], st, errors);
    let b = 0;
    for (let i = 0; i < 32; i++) b = (b << 1) | (m[i] === '1' ? 1 : 0);
    st.binary = b;
  }

  /* assembler ------------------------------------------------------------ */
  class Assembler {
    assemble(programs, extended, warnErrors) {
      const cfg = mem.cfg;
      const textA = (this.textA = { a: [cfg.textBase | 0, cfg.ktextBase | 0], cur: 0 });
      const dataA = (this.dataA = { a: [cfg.dataBase | 0, cfg.kdataBase | 0], cur: 0 });
      this.extern = cfg.externBase | 0;
      globalSymbols.clear(); mem.clear();
      this.machine = []; const errors = (this.errors = new ErrorList());
      this.curFwd = []; const accFwd = [];
      this.extended = extended;
      for (const p of programs) {
        if (errors.limitExceeded) break;
        this.prog = p; this.globals = []; this.inData = false; this.inMacro = false; this.autoAlign = true; this.dataDirective = '.word';
        p.locals.clear(); this.curFwd = []; p.parsed = []; p.macros = new MacroPool(p);
        for (let i = 0; i < p.tokenList.length; i++) {
          if (errors.limitExceeded) break;
          const src = p.sourceLines[i];
          const sts = this.parseLine(p.tokenList[i], src.source, src.lineNumber, extended, i + 1);
          if (sts) p.parsed.push(...sts);
        }
        if (this.inMacro) errors.add(ErrorMessage.of(false, p, p.macros.current.from, 0, 'Macro started but not ended (no .end_macro directive)'));
        this.transferGlobals();
        this.resolveFwd(this.curFwd, p.locals, p);
        accFwd.push(...this.curFwd.map((f) => Object.assign(f, { prog: p })));
        this.curFwd = [];
      }
      for (let i = accFwd.length - 1; i >= 0; i--) {
        const f = accFwd[i], a = globalSymbols.addr(f.token.value);
        if (a !== -1) { mem.set(f.addr, a, f.len); accFwd.splice(i, 1); }
      }
      for (const f of accFwd) errors.add(ErrorMessage.of(false, f.token.program, f.token.line, f.token.pos, 'Symbol "' + f.token.value + '" not found in symbol table.'));
      if (errors.hasErrors) throw new ProcEx(errors);

      for (const p of programs) {
        if (errors.limitExceeded) break;
        this.prog = p;
        for (const st of p.parsed) {
          buildBasic(st, errors);
          if (errors.hasErrors) throw new ProcEx(errors);
          if (st.inst.basic) { this.machine.push(st); continue; }
          const inst = st.inst;
          const tk = new Tokenizer(null);
          const list = tk.tokenizeLine(st.sourceLine, st.basicText, errors, false);
          const compact = mem.compact && inst.compact;
          const tmpl = compact ? inst.compact : inst.templates;
          let addr = st.address;
          for (let n = 0; n < tmpl.length; n++) {
            const code = template(p, tmpl[n], list);
            if (!code) continue;
            const nt = tk.tokenizeLine(st.sourceLine, code, errors, false);
            const matches = this.matchInstruction(nt[0]);
            const instr = bestMatch(nt, matches);
            const ps = makeStatement(p, n === 0 ? st.source : '', nt, nt, instr, addr, st.sourceLine);
            addr = (addr + 4) | 0;
            buildBasic(ps, errors);
            this.machine.push(ps);
          }
        }
      }
      for (const st of this.machine) {
        if (errors.limitExceeded) break;
        buildMachine(st, errors);
        try { mem.setStatement(st.address, st); } catch (e) {
          if (!(e instanceof M.AddressError)) throw e;
          const t = st.orig[0];
          errors.add(ErrorMessage.of(false, t.program, t.line, t.pos, 'Invalid address for text segment: ' + e.address));
        }
      }
      this.machine.sort((a, b) => (a.address >>> 0) - (b.address >>> 0));
      for (let i = 0; i < this.machine.length - 1; i++) {
        const a = this.machine[i], b = this.machine[i + 1];
        if (a.address === b.address) {
          errors.add(new ErrorMessage(false, b.file, b.sourceLine, 0, 'Duplicate text segment address: ' + (S.addrHex ? M.hex8(b.address) : b.address >>> 0) +
            ' already occupied by ' + a.file + ' line ' + a.sourceLine + ' (caused by use of ' + (mem.inText(b.address) ? '.text' : '.ktext') + ' operand)'));
        }
      }
      if (errors.hasErrors || (errors.hasWarnings && warnErrors)) throw new ProcEx(errors);
      return this.machine;
    }
    resolveFwd(list, table) {
      for (let i = list.length - 1; i >= 0; i--) {
        const f = list[i];
        let a = table.addr(f.token.value); if (a === -1) a = globalSymbols.addr(f.token.value);
        if (a !== -1) { mem.set(f.addr, a, f.len); list.splice(i, 1); }
      }
    }
    err(tok, m, warn) { this.errors.add(ErrorMessage.of(!!warn, tok.program, tok.line, tok.pos, m)); }
    parseLine(tokenList, source, srcLine, ext, listLine) {
      const ret = [];
      let tokens = tokenList.slice();
      if (tokens.length && tokens[tokens.length - 1].type === 'COMMENT') tokens.pop();
      const pool = this.prog.macros;
      const startsLabel = (t) => t.length >= 2 && (t[0].type === 'IDENTIFIER' || t[0].type === 'OPERATOR') && t[1].type === 'COLON';
      if (this.inMacro) { if (startsLabel(tokens)) pool.current.labels.push(tokens[0].value); }
      else if (startsLabel(tokens)) {
        const t = tokens[0];
        this.prog.locals.add(t, this.inData ? this.dataAddr : this.textAddr, this.inData, this.errors);
        tokens.splice(0, 2);
      }
      if (tokens.length === 0) return null;
      const token = tokens[0], tt = token.type;
      if (tt === 'DIRECTIVE') { this.directive(tokens); return null; }
      if (this.inMacro) return null;
      let parenFree = tokens;
      if (tokens.length > 2 && tokens[1].type === 'LEFT_PAREN' && tokens[tokens.length - 1].type === 'RIGHT_PAREN') {
        parenFree = tokens.slice(); parenFree.pop(); parenFree.splice(1, 1);
      }
      const macro = pool.match(parenFree);
      if (macro) {
        tokens = parenFree;
        const counter = pool.counter++;
        if (pool.push(token)) this.err({ program: token.program, line: tokens[0].line, pos: 0 }, 'Detected a macro expansion loop (recursive reference). ');
        else {
          for (let i = macro.from + 1; i < macro.to; i++) {
            let sub = macroSubstituted(macro, i, tokens, counter, this.errors);
            const tl2 = this.prog.tokenizer.tokenizeLine(i, sub, this.errors);
            if ((tl2.processedLine || '').length > 0) sub = tl2.processedLine;
            const orig = this.prog.sourceLines[macro.from - 1].lineNumber;
            const sts = this.parseLine(tl2, '<' + (i - macro.from + orig) + '> ' + sub.trim(), srcLine, ext, i);
            if (sts) ret.push(...sts);
          }
          pool.pop();
        }
        return ret;
      }
      if (tt === 'IDENTIFIER' && token.value[0] === '.') { this.err(token, 'MARS does not recognize the ' + token.value + ' directive.  Ignored.', true); return null; }
      if (this.inData && (tt === 'PLUS' || tt === 'MINUS' || tt === 'QUOTED_STRING' || tt === 'IDENTIFIER' || isIntT(tt) || isFltT(tt))) { this.continuation(tokens); return null; }
      if (!this.inData) {
        const matches = this.matchInstruction(token);
        if (!matches) return ret;
        const inst = bestMatch(tokens, matches);
        if (!inst.basic && !ext) this.err(token, 'Extended (pseudo) instruction or format not permitted.  See Settings.');
        if (operandMatch(tokens, inst, this.errors)) {
          const st = makeStatement(this.prog, source, tokenList, tokens, inst, this.textAddr, srcLine);
          let len = inst.len;
          if (mem.compact && !inst.basic && inst.compact) len = inst.compactLen;
          this.textAddr += len;
          ret.push(st);
          return ret;
        }
      }
      return null;
    }
    get textAddr() { return this.textA.a[this.textA.cur]; }
    set textAddr(v) { this.textA.a[this.textA.cur] = v; }
    get dataAddr() { return this.dataA.a[this.dataA.cur]; }
    set dataAddr(v) { this.dataA.a[this.dataA.cur] = v; }
    matchInstruction(token) {
      if (token.type !== 'OPERATOR') {
        if (token.program && token.program.macros && token.program.macros.anyName(token.value)) this.err(token, 'forward reference or invalid parameters for macro "' + token.value + '"');
        else this.err(token, '"' + token.value + '" is not a recognized operator');
        return null;
      }
      return M.matchOperator(token.value);
    }
    transferGlobals() {
      for (const lb of this.globals) {
        const e = this.prog.locals.get(lb.value);
        if (!e) this.err(lb, '"' + lb.value + '" declared global label but not defined.');
        else if (globalSymbols.addr(lb.value) !== -1) this.err(lb, '"' + lb.value + '" already defined as global in a different file.');
        else { this.prog.locals.remove(lb.value); globalSymbols.add(lb, e.address, e.isData, this.errors); }
      }
    }
    directive(tokens) {
      const token = tokens[0], d = matchDirective(token.value), v = token.value;
      if (!d) { this.err(token, '"' + v + '" directive is invalid or not implemented in MARS'); return; }
      if (d === '.eqv') return;
      if (d === '.macro') {
        if (tokens.length < 2) { this.err(token, '"' + v + '" directive requires at least one argument.'); return; }
        if (tokens[1].type !== 'IDENTIFIER') { this.err(tokens[1], 'Invalid Macro name "' + tokens[1].value + '"'); return; }
        if (this.inMacro) { this.err(token, 'Nested macros are not allowed'); return; }
        this.inMacro = true;
        const pool = this.prog.macros; pool.begin(tokens[1]);
        for (let i = 2; i < tokens.length; i++) {
          const a = tokens[i];
          if (a.type === 'RIGHT_PAREN' || a.type === 'LEFT_PAREN') continue;
          if (!isMacroParam(a.value, true)) { this.err(a, "Invalid macro argument '" + a.value + "'"); return; }
          pool.current.args.push(a.value);
        }
        return;
      }
      if (d === '.end_macro') {
        if (tokens.length > 1) { this.err(token, 'invalid text after .END_MACRO'); return; }
        if (!this.inMacro) { this.err(token, '.END_MACRO without .MACRO'); return; }
        this.inMacro = false; this.prog.macros.commit(token); return;
      }
      if (this.inMacro) return;
      if (d === '.data' || d === '.kdata') {
        this.inData = true; this.autoAlign = true; this.dataA.cur = d === '.data' ? 0 : 1;
        if (tokens.length > 1 && isIntT(tokens[1].type)) this.dataAddr = stringToInt(tokens[1].value);
      } else if (d === '.text' || d === '.ktext') {
        this.inData = false; this.textA.cur = d === '.text' ? 0 : 1;
        if (tokens.length > 1 && isIntT(tokens[1].type)) this.textAddr = stringToInt(tokens[1].value);
      } else if (['.word', '.half', '.byte', '.float', '.double'].includes(d)) {
        this.dataDirective = d;
        if (this.dataCheck(token) && tokens.length > 1) this.storeNumeric(tokens, d);
      } else if (d === '.ascii' || d === '.asciiz') {
        this.dataDirective = d;
        if (this.dataCheck(token)) this.storeStrings(tokens, d);
      } else if (d === '.align') {
        if (this.dataCheck(token)) {
          if (tokens.length !== 2) { this.err(token, '"' + v + '" requires one operand'); return; }
          if (!isIntT(tokens[1].type) || stringToInt(tokens[1].value) < 0) { this.err(token, '"' + v + '" requires a non-negative integer'); return; }
          const n = stringToInt(tokens[1].value);
          if (n === 0) this.autoAlign = false; else this.dataAddr = this.align(this.dataAddr, 2 ** n);
        }
      } else if (d === '.space') {
        if (this.dataCheck(token)) {
          if (tokens.length !== 2) { this.err(token, '"' + v + '" requires one operand'); return; }
          if (!isIntT(tokens[1].type) || stringToInt(tokens[1].value) < 0) { this.err(token, '"' + v + '" requires a non-negative integer'); return; }
          this.dataAddr += stringToInt(tokens[1].value);
        }
      } else if (d === '.extern') {
        if (tokens.length !== 3) { this.err(token, '"' + v + '" directive requires two operands (label and size).'); return; }
        if (!isIntT(tokens[2].type) || stringToInt(tokens[2].value) < 0) { this.err(token, '"' + v + '" requires a non-negative integer size'); return; }
        const size = stringToInt(tokens[2].value);
        if (globalSymbols.addr(tokens[1].value) === -1) { globalSymbols.add(tokens[1], this.extern, true, this.errors); this.extern += size; }
      } else if (d === '.set') this.err(token, 'MARS currently ignores the .set directive.', true);
      else if (d === '.globl') {
        if (tokens.length < 2) { this.err(token, '"' + v + '" directive requires at least one argument.'); return; }
        for (let i = 1; i < tokens.length; i++) {
          if (tokens[i].type !== 'IDENTIFIER') { this.err(token, '"' + v + '" directive argument must be label.'); return; }
          this.globals.push(tokens[i]);
        }
      } else this.err(token, '"' + v + '" directive recognized but not yet implemented.');
    }
    continuation(tokens) {
      const d = this.dataDirective;
      if (['.word', '.half', '.byte', '.float', '.double'].includes(d)) { if (tokens.length > 0) this.storeNumeric(tokens, d); }
      else if ((d === '.ascii' || d === '.asciiz') && this.dataCheck(tokens[0])) this.storeStrings(tokens, d);
    }
    dataCheck(token) {
      if (!this.inData) { this.err(token, '"' + token.value + '" directive cannot appear in text segment'); return false; }
      return true;
    }
    storeNumeric(tokens, d) {
      let token = tokens[0];
      if (!this.dataCheck(token)) return;
      const start = token.type === 'DIRECTIVE' ? 1 : 0;
      const isI = d === '.word' || d === '.half' || d === '.byte';
      const len = { '.word': 4, '.half': 2, '.byte': 1, '.float': 4, '.double': 8 }[d];
      if (tokens.length === 4 && tokens[2].type === 'COLON') {
        const val = tokens[1], rep = tokens[3];
        if (!((isI && isIntT(val.type)) || (!isI && (isIntT(val.type) || isFltT(val.type)))) || !isIntT(rep.type)) { this.err(val, 'malformed expression'); return; }
        const r = stringToInt(rep.value);
        if (r <= 0) { this.err(rep, 'repetition factor must be positive'); return; }
        if (this.inData) {
          if (this.autoAlign) this.dataAddr = this.align(this.dataAddr, len);
          for (let i = 0; i < r; i++) { if (isI) this.storeInt(val, d, len); else this.storeReal(val, d); }
        }
        return;
      }
      for (let i = start; i < tokens.length; i++) { if (isI) this.storeInt(tokens[i], d, len); else this.storeReal(tokens[i], d); }
    }
    storeInt(token, d, len) {
      if (isIntT(token.type)) {
        const full = stringToInt(token.value);
        let v = full;
        if (d === '.byte') v &= 0xff; else if (d === '.half') v &= 0xffff;
        const out = (d === '.byte' && (full < -128 || full > 255)) || (d === '.half' && (full < -32768 || full > 65535));
        if (out) this.err(token, '"' + token.value + '" is out-of-range for a signed value and possibly truncated', true);
        this.writeData(v, len, token);
      } else if (token.type === 'IDENTIFIER') {
        if (this.inData) {
          let v = this.prog.locals.addr(token.value);
          if (v === -1) v = globalSymbols.addr(token.value);
          if (v === -1) { const a = this.writeData(0, len, token); this.curFwd.push({ addr: a, len, token }); }
          else this.writeData(v, len, token);
        } else this.err(token, '"' + token.value + '" label as directive operand not permitted in text segment');
      } else this.err(token, '"' + token.value + '" is not a valid integer constant or label');
    }
    storeReal(token, d) {
      let v;
      if (isIntT(token.type) || isFltT(token.type)) {
        try { v = parseDouble(token.value); } catch (e) { this.err(token, '"' + token.value + '" is not a valid floating point constant'); return; }
        if (isFinite(v) && d === '.float' && Math.abs(v) > 3.4028234663852886e38) { this.err(token, '"' + token.value + '" is an out-of-range value'); return; }
      } else { this.err(token, '"' + token.value + '" is not a valid floating point constant'); return; }
      if (d === '.float') this.writeData(M.floatToIntBits(Math.fround(v)), 4, token);
      else {
        if (this.autoAlign) this.dataAddr = this.align(this.dataAddr, 8);
        try { mem.setDouble(this.dataAddr, v); } catch (e) { this.err(token, '"' + this.dataAddr + '" is not a valid data segment address'); return; }
        this.dataAddr += 8;
      }
    }
    storeStrings(tokens, d) {
      const start = tokens[0].type === 'DIRECTIVE' ? 1 : 0;
      for (let i = start; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type !== 'QUOTED_STRING') { this.err(t, '"' + t.value + '" is not a valid character string'); continue; }
        const q = t.value;
        for (let j = 1; j < q.length - 1; j++) {
          let c = q[j];
          if (c === '\\') {
            c = q[++j];
            const k = 'ntr\\\'"bf0'.indexOf(c);
            if (k >= 0) c = '\n\t\r\\\'"\b\f\0'[k];
          }
          this.putByte(c.charCodeAt(0), t);
        }
        if (d === '.asciiz') this.putByte(0, t);
      }
    }
    putByte(v, t) {
      try { mem.set(this.dataAddr, v, 1); } catch (e) { this.err(t, '"' + this.dataAddr + '" is not a valid data segment address'); }
      this.dataAddr += 1;
    }
    writeData(v, len, token) {
      if (this.autoAlign) this.dataAddr = this.align(this.dataAddr, len);
      try { mem.set(this.dataAddr, v, len); } catch (e) { this.err(token, '"' + this.dataAddr + '" is not a valid data segment address'); return this.dataAddr; }
      const a = this.dataAddr; this.dataAddr += len; return a;
    }
    align(a, b) {
      const r = ((a % b) + b) % b;
      if (r === 0) return a;
      const n = a + b - r;
      this.prog.locals.fix(a, n);
      return n;
    }
  }

  /* public API: assemble list of {name,text}; first is the "leader" */
  M.assembleFiles = function (files, opt) {
    opt = opt || {};
    const allFiles = opt.allFiles || files;
    const programs = files.map((f) => new Program(f.name, f.text));
    for (const p of programs) {
      p.tokenizer = new Tokenizer(p);
      p.tokenList = p.tokenizer.tokenizeProgram(p, allFiles);
    }
    const asm = new Assembler();
    const machine = asm.assemble(programs, opt.extended !== false, !!opt.warningsAreErrors);
    M.program = { programs, machine, errors: asm.errors, files };
    return M.program;
  };
  M.Program = Program;
})();
