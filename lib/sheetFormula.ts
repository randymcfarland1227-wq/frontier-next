/**
 * Worksheet › Sheet view: the grid's data and a small formula evaluator (no eval). A cell holds what was typed;
 * text starting with "=" is a formula. Supports numbers (1,234.50 · $12 · 5%), cell refs (A1, $B$2), ranges (A1:B5),
 * + - * / ^ & and comparisons, parentheses, and SUM, AVERAGE/AVG, MIN, MAX, COUNT, PRODUCT, ROUND, ABS, IF.
 * Errors show as #ERR (bad formula), #REF (bad ref), #DIV/0, #VALUE (text in math), #NAME (unknown function), #CYCLE.
 */

export type SheetData = { cols: number; rows: number; cells: Record<string, string> };
export const SHEET_COLS = 10;
export const SHEET_ROWS = 20;
export const MAX_COLS = 52;
export const MAX_ROWS = 500;

export const blankSheet = (): SheetData => ({ cols: SHEET_COLS, rows: SHEET_ROWS, cells: {} });

/** Old worksheets have no sheet; bad data from another device falls back to a blank grid. */
export function sheetOf(s: unknown): SheetData {
  const d = s as Partial<SheetData> | undefined;
  if (!d || typeof d !== 'object' || !d.cells || typeof d.cells !== 'object') return blankSheet();
  const n = (v: unknown, def: number, max: number) => (typeof v === 'number' && v >= 1 ? Math.min(max, Math.floor(v)) : def);
  const cells: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.cells)) if (typeof v === 'string' && v !== '' && /^[A-Z]+\d+$/.test(k)) cells[k] = v;
  return { cols: n(d.cols, SHEET_COLS, MAX_COLS), rows: n(d.rows, SHEET_ROWS, MAX_ROWS), cells };
}

export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export const cellId = (r: number, c: number) => `${colName(c)}${r + 1}`;
export function parseRef(ref: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,5})$/.exec(ref);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  const r = Number(m[2]);
  return r >= 1 ? { r: r - 1, c: c - 1 } : null;
}

/** "1,234.50", "$12", "-$3", "5%" → number; anything else → null. */
export function toNumber(raw: string): number | null {
  const m = /^([-+]?)\$?([-+]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(%?)$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[3].replace(/,/g, '')) * ((m[1] === '-') !== (m[2] === '-') ? -1 : 1);
  return m[4] ? n / 100 : n;
}

export class SheetError {
  constructor(public code: string) {}
}
export type Val = number | string | boolean;
type Tok = { t: 'num' | 'str' | 'ref' | 'id' | 'op'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    let m: RegExpExecArray | null;
    const rest = src.slice(i);
    if ((m = /^(\d+\.?\d*|\.\d+)/.exec(rest))) out.push({ t: 'num', v: m[1] });
    else if ((m = /^"([^"]*)"/.exec(rest))) out.push({ t: 'str', v: m[1] });
    else if ((m = /^\$?[A-Za-z]{1,3}\$?\d{1,5}(?![A-Za-z0-9_(])/.exec(rest))) out.push({ t: 'ref', v: m[0] });
    else if ((m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest))) out.push({ t: 'id', v: m[0].toUpperCase() });
    else if ((m = /^(<=|>=|<>|[-+*/^&(),:%=<>])/.exec(rest))) out.push({ t: 'op', v: m[1] });
    else throw new SheetError('#ERR');
    i += m[0].length;
  }
  return out;
}

const num = (v: Val | Val[]): number => {
  if (Array.isArray(v)) throw new SheetError('#VALUE');
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v.trim() === '') return 0;
  const n = toNumber(v);
  if (n === null) throw new SheetError('#VALUE');
  return n;
};
const one = (v: Val | Val[]): Val => {
  if (Array.isArray(v)) throw new SheetError('#VALUE');
  return v;
};
const str = (v: Val | Val[]): string => {
  const x = one(v);
  return typeof x === 'number' ? fmtNumber(x) : typeof x === 'boolean' ? (x ? 'TRUE' : 'FALSE') : x;
};
/** Numbers in function args: ranges skip text and blanks (like Excel); a typed value must be a number. */
const nums = (args: (Val | Val[])[]): number[] =>
  args.flatMap((a) => (Array.isArray(a) ? a.flatMap((v) => (typeof v === 'number' ? [v] : typeof v === 'string' && toNumber(v) !== null ? [toNumber(v)!] : [])) : [num(a)]));

const FUNCS: Record<string, (args: (Val | Val[])[]) => Val> = {
  SUM: (a) => nums(a).reduce((s, n) => s + n, 0),
  PRODUCT: (a) => nums(a).reduce((s, n) => s * n, 1),
  AVERAGE: (a) => {
    const n = nums(a);
    if (!n.length) throw new SheetError('#DIV/0');
    return n.reduce((s, x) => s + x, 0) / n.length;
  },
  MIN: (a) => (nums(a).length ? Math.min(...nums(a)) : 0),
  MAX: (a) => (nums(a).length ? Math.max(...nums(a)) : 0),
  COUNT: (a) => nums(a).length,
  ROUND: (a) => {
    const p = a.length > 1 ? Math.trunc(num(a[1])) : 0;
    const f = 10 ** p;
    return Math.round((num(a[0]) + Number.EPSILON * Math.sign(num(a[0]))) * f) / f;
  },
  ABS: (a) => Math.abs(num(a[0])),
  IF: (a) => {
    const c = one(a[0]);
    const yes = typeof c === 'boolean' ? c : num(c) !== 0;
    return yes ? one(a[1] ?? true) : one(a[2] ?? false);
  },
};
FUNCS.AVG = FUNCS.AVERAGE;

type Lookup = (id: string) => Val;

function parse(toks: Tok[], get: Lookup): Val {
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => toks[p]?.t === 'op' && toks[p].v === v;
  const take = (v: string) => {
    if (!isOp(v)) throw new SheetError('#ERR');
    p++;
  };
  const refVal = (ref: string): Val => {
    const at = parseRef(ref);
    if (!at) throw new SheetError('#REF');
    return get(cellId(at.r, at.c));
  };
  const range = (a: string, b: string): Val[] => {
    const x = parseRef(a);
    const y = parseRef(b);
    if (!x || !y) throw new SheetError('#REF');
    const [r0, r1] = [Math.min(x.r, y.r), Math.max(x.r, y.r)];
    const [c0, c1] = [Math.min(x.c, y.c), Math.max(x.c, y.c)];
    if ((r1 - r0 + 1) * (c1 - c0 + 1) > 20000) throw new SheetError('#REF');
    const out: Val[] = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(get(cellId(r, c)));
    return out;
  };

  const primary = (): Val | Val[] => {
    const k = peek();
    if (!k) throw new SheetError('#ERR');
    p++;
    if (k.t === 'num') return Number(k.v);
    if (k.t === 'str') return k.v;
    if (k.t === 'ref') {
      if (isOp(':')) {
        p++;
        const b = peek();
        if (b?.t !== 'ref') throw new SheetError('#REF');
        p++;
        return range(k.v, b.v);
      }
      return refVal(k.v);
    }
    if (k.t === 'id') {
      if (isOp('(')) {
        p++;
        const args: (Val | Val[])[] = [];
        if (!isOp(')')) {
          args.push(compare());
          while (isOp(',')) {
            p++;
            args.push(compare());
          }
        }
        take(')');
        const f = FUNCS[k.v];
        if (!f) throw new SheetError('#NAME');
        return f(args);
      }
      if (k.v === 'TRUE' || k.v === 'FALSE') return k.v === 'TRUE';
      throw new SheetError('#NAME');
    }
    if (k.v === '(') {
      const v = compare();
      take(')');
      return v;
    }
    throw new SheetError('#ERR');
  };
  const postfix = (): Val | Val[] => {
    let v = primary();
    while (isOp('%')) {
      p++;
      v = num(v) / 100;
    }
    return v;
  };
  const unary = (): Val | Val[] => {
    if (isOp('-')) return p++, -num(unary());
    if (isOp('+')) return p++, num(unary());
    return postfix();
  };
  const pow = (): Val | Val[] => {
    let v = unary();
    while (isOp('^')) {
      p++;
      v = num(v) ** num(unary());
    }
    return v;
  };
  const mul = (): Val | Val[] => {
    let v = pow();
    while (isOp('*') || isOp('/')) {
      const op = toks[p++].v;
      const r = num(pow());
      if (op === '/' && r === 0) throw new SheetError('#DIV/0');
      v = op === '*' ? num(v) * r : num(v) / r;
    }
    return v;
  };
  const add = (): Val | Val[] => {
    let v = mul();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      v = op === '+' ? num(v) + num(mul()) : num(v) - num(mul());
    }
    return v;
  };
  const concat = (): Val | Val[] => {
    let v = add();
    while (isOp('&')) {
      p++;
      v = str(v) + str(add());
    }
    return v;
  };
  function compare(): Val | Val[] {
    let v = concat();
    while (['=', '<>', '<', '>', '<=', '>='].some(isOp)) {
      const op = toks[p++].v;
      const a = one(v);
      const b = one(concat());
      const bothNum = typeof a !== 'string' && typeof b !== 'string';
      const x: number | string = bothNum ? num(a) : str(a).toLowerCase();
      const y: number | string = bothNum ? num(b) : str(b).toLowerCase();
      v = op === '=' ? x === y : op === '<>' ? x !== y : op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
    }
    return v;
  }

  const v = compare();
  if (p < toks.length) throw new SheetError('#ERR');
  return one(v);
}

/** Every filled cell's computed value (errors as SheetError). */
export function evaluateSheet(cells: Record<string, string>): Record<string, Val | SheetError> {
  const done: Record<string, Val | SheetError> = {};
  const busy = new Set<string>();
  const calc = (id: string): Val => {
    if (id in done) {
      const d = done[id];
      if (d instanceof SheetError) throw d;
      return d;
    }
    const raw = cells[id] ?? '';
    if (!raw.startsWith('=')) {
      const n = toNumber(raw);
      return (done[id] = n === null ? raw : n);
    }
    if (busy.has(id)) throw new SheetError('#CYCLE');
    busy.add(id);
    try {
      const v = raw.trim() === '=' ? '' : parse(lex(raw.slice(1)), calc);
      if (typeof v === 'number' && !Number.isFinite(v)) throw new SheetError('#NUM');
      return (done[id] = v);
    } catch (e) {
      const err = e instanceof SheetError ? e : new SheetError('#ERR');
      done[id] = err;
      throw err;
    } finally {
      busy.delete(id);
    }
  };
  for (const id of Object.keys(cells)) {
    try {
      calc(id);
    } catch {
      /* recorded in done */
    }
  }
  return done;
}

export function fmtNumber(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  if (Math.abs(n) < 0.01) return String(Number(n.toPrecision(6)));
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** What the cell shows: typed text as typed, formula results formatted. */
export function shown(raw: string, v: Val | SheetError | undefined): string {
  if (!raw.startsWith('=')) return raw;
  if (v instanceof SheetError) return v.code;
  if (v === undefined) return '';
  if (typeof v === 'number') return fmtNumber(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}
