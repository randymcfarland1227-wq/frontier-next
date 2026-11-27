"use client";

/**
 * Worksheet › Sheet view: a small spreadsheet grid beside the notes (same worksheet, toggled with the Sheet button).
 * Click or arrow to a cell, type to replace it, Enter/F2 or a second click to edit, "=" for a formula
 * (lib/sheetFormula.ts). Tab/Enter move on, Esc cancels, Delete clears, ⌘Z undoes, paste takes rows from a spreadsheet.
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent as ReactChangeEvent, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { COL_W, MAX_COLS, MAX_COL_W, MAX_ROWS, MIN_COL_W, cellId, cleanFmt, type CellFmt, colName, evaluateSheet, shown, toNumber, type SheetData } from "../../lib/sheetFormula";

type At = { r: number; c: number };

const TEXT = ["#1f2328", "#d1242f", "#e16f24", "#bf8700", "#1a7f37", "#0969da", "#8250df", "#bf3989", "#6e7781", "#f6f8fa"];
const FILL = ["#fff3a3", "#ffd6a5", "#c9f2c7", "#bde0fe", "#ffc8dd", "#e5d4ff", "#ffcdc2", "#d9dde3"];
const closePal = (e: ReactMouseEvent) => {
  const d = (e.currentTarget as HTMLElement).closest("details");
  if (d) d.open = false;
};

export function SheetGrid({ data, onChange, tools }: { data: SheetData; onChange: (d: SheetData) => void; tools?: ReactNode }) {
  const [sheet, setSheetState] = useState<SheetData>(data);
  // the latest grid, so a commit followed by a move in the same event doesn't work from a stale copy
  const cur = useRef<SheetData>(data);
  const setSheet = (d: SheetData) => {
    cur.current = d;
    setSheetState(d);
  };
  const [sel, setSelState] = useState<At>({ r: 0, c: 0 });
  // Selection: the active cell plus an anchor; Shift+arrows, Shift+click or dragging stretch it into a range.
  const [anchor, setAnchor] = useState<At>({ r: 0, c: 0 });
  const setSel = (at: At, extend = false) => {
    setSelState(at);
    if (!extend) setAnchor(at);
  };
  const dragging = useRef(false);
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  const [edit, setEditState] = useState<string | null>(null);
  const editRef = useRef<string | null>(null);
  const setEdit = (v: string | null) => {
    editRef.current = v;
    setEditState(v);
  };
  const undo = useRef<SheetData[]>([]);
  const redo = useRef<SheetData[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  // Keys land in a hidden input while a cell is selected, so typing (keyboard, phone, IME or dictation) starts an edit.
  const catcher = useRef<HTMLInputElement>(null);
  const values = useMemo(() => evaluateSheet(sheet.cells), [sheet.cells]);
  const id = cellId(sel.r, sel.c);
  const raw = sheet.cells[id] ?? "";
  const box = { r0: Math.min(sel.r, anchor.r), r1: Math.max(sel.r, anchor.r), c0: Math.min(sel.c, anchor.c), c1: Math.max(sel.c, anchor.c) };
  const multi = box.r0 !== box.r1 || box.c0 !== box.c1;
  const inBox = (r: number, c: number) => r >= box.r0 && r <= box.r1 && c >= box.c0 && c <= box.c1;
  const boxIds = () => {
    const out: string[] = [];
    for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) out.push(cellId(r, c));
    return out;
  };
  const fmtHere: CellFmt = sheet.fmt?.[id] ?? {};
  /** Sets (or with undefined, clears) format keys on every selected cell. */
  const setFmt = (patch: Partial<Record<keyof CellFmt, CellFmt[keyof CellFmt] | undefined>>) => {
    const s = cur.current;
    const fmt = { ...(s.fmt || {}) };
    for (const k of boxIds()) {
      const f = cleanFmt({ ...fmt[k], ...patch } as CellFmt);
      if (f) fmt[k] = f;
      else delete fmt[k];
    }
    apply({ ...s, fmt });
  };
  const toggle = (key: "b" | "i" | "s") => setFmt({ [key]: fmtHere[key] ? undefined : true });

  const apply = (next: SheetData) => {
    undo.current = [...undo.current.slice(-49), cur.current];
    redo.current = [];
    setSheet(next);
    onChange(next);
  };
  const setCells = (patch: Record<string, string>, grow?: Partial<SheetData>) => {
    const sheet = cur.current;
    const cells = { ...sheet.cells };
    let changed = false;
    for (const [k, v] of Object.entries(patch)) {
      if ((cells[k] ?? "") === v) continue;
      changed = true;
      if (v === "") delete cells[k];
      else cells[k] = v;
    }
    const rows = Math.max(sheet.rows, grow?.rows ?? 0);
    const cols = Math.max(sheet.cols, grow?.cols ?? 0);
    if (changed || rows !== sheet.rows || cols !== sheet.cols) apply({ ...sheet, rows, cols, cells });
  };
  // Column widths: drag the edge of a column letter (live while dragging, saved on release), double-click to fit.
  const [drag, setDrag] = useState<{ c: number; w: number } | null>(null);
  const widthOf = (c: number) => (drag?.c === c ? drag.w : (sheet.widths?.[c] ?? COL_W));
  const clampW = (w: number) => Math.min(MAX_COL_W, Math.max(MIN_COL_W, Math.round(w)));
  const setWidth = (c: number, w: number) => {
    const s = cur.current;
    const widths = { ...(s.widths || {}) };
    if (w === COL_W) delete widths[c];
    else widths[c] = w;
    if ((s.widths?.[c] ?? COL_W) !== w) apply({ ...s, widths });
  };
  const startResize = (c: number, e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const x0 = e.clientX;
    const w0 = widthOf(c);
    let w = w0;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      w = clampW(w0 + ev.clientX - x0);
      setDrag({ c, w });
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      setDrag(null);
      setWidth(c, w);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  };
  const fitColumn = (c: number) => {
    const tds = wrap.current?.querySelectorAll<HTMLElement>(`td[data-col="${c}"]`);
    const ctx = document.createElement("canvas").getContext("2d");
    if (!tds?.length || !ctx) return;
    ctx.font = getComputedStyle(tds[0]).font;
    let max = 0;
    tds.forEach((td) => (max = Math.max(max, ctx.measureText(td.textContent || "").width)));
    setWidth(c, max ? clampW(max + 18) : COL_W);
  };

  const history = (back: boolean) => {
    const from = back ? undo.current : redo.current;
    const prev = from.pop();
    if (!prev) return;
    (back ? redo : undo).current.push(cur.current);
    setSheet(prev);
    onChange(prev);
  };

  const focusGrid = () => catcher.current?.focus({ preventScroll: true });
  const move = (dr: number, dc: number, extend = false) => {
    const { rows, cols } = cur.current;
    let r = Math.max(0, sel.r + dr);
    const c = Math.min(cols - 1, Math.max(0, sel.c + dc));
    // Enter / ↓ past the last row adds one
    if (r >= rows) {
      if (rows < MAX_ROWS) setCells({}, { rows: r + 1 });
      else r = rows - 1;
    }
    setSel({ r, c }, extend);
  };
  useEffect(() => {
    wrap.current?.querySelector(`[data-cell="${id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [id]);

  const startEdit = (initial?: string) => setEdit(initial ?? raw);
  const commit = () => {
    const v = editRef.current;
    if (v === null) return;
    setEdit(null);
    setCells({ [id]: v.trim() === "" ? "" : v });
  };
  const cancel = () => {
    setEdit(null);
    focusGrid();
  };

  const onGridKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // typed faster than the cell's editor opened: treat Enter/Tab/Esc as the editor would
    if (editRef.current !== null) return onEditKey(e);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") return e.preventDefault(), history(!e.shiftKey);
    if (mod && e.key.toLowerCase() === "y") return e.preventDefault(), history(false);
    if (mod && !e.shiftKey && (e.key.toLowerCase() === "b" || e.key.toLowerCase() === "i")) return e.preventDefault(), toggle(e.key.toLowerCase() as "b" | "i");
    if (mod || e.altKey) return;
    const k = e.key;
    if (k === "ArrowUp") return e.preventDefault(), move(-1, 0, e.shiftKey);
    if (k === "ArrowDown") return e.preventDefault(), move(1, 0, e.shiftKey);
    if (k === "ArrowLeft") return e.preventDefault(), move(0, -1, e.shiftKey);
    if (k === "ArrowRight") return e.preventDefault(), move(0, 1, e.shiftKey);
    if (k === "Tab") return e.preventDefault(), move(0, e.shiftKey ? -1 : 1);
    if (k === "Enter") return e.preventDefault(), e.shiftKey ? move(-1, 0) : startEdit();
    if (k === "F2") return e.preventDefault(), startEdit();
    if (k === "Backspace" || k === "Delete") return e.preventDefault(), setCells(Object.fromEntries(boxIds().map((x) => [x, ""])));
    if (k === "Escape" && multi) return e.preventDefault(), setSel(sel);
    // printable keys fall through into the catcher input → onCatch starts the edit
  };
  const onCatch = (e: ReactChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    e.target.value = "";
    if (!v) return;
    setEdit(editRef.current === null ? v : editRef.current + v);
  };
  const onEditKey = (e: ReactKeyboardEvent<HTMLInputElement>, fromBar = false) => {
    const k = e.key;
    if (k === "Escape") return e.preventDefault(), cancel();
    if (k === "Enter" || k === "Tab" || (!fromBar && (k === "ArrowUp" || k === "ArrowDown"))) {
      e.preventDefault();
      commit();
      if (k === "Tab") move(0, e.shiftKey ? -1 : 1);
      else move(k === "ArrowUp" || (k === "Enter" && e.shiftKey) ? -1 : 1, 0);
      focusGrid();
    }
  };

  // While typing a formula, clicking another cell drops its name in (after an operator, "(", "," or ":").
  const pickCell = (at: At, e: ReactMouseEvent) => {
    const v = editRef.current;
    const here = at.r === sel.r && at.c === sel.c;
    if (v !== null && v.startsWith("=") && /[=+\-*/^&(,:<>]\s*$/.test(v) && !here) {
      e.preventDefault();
      setEdit(v + cellId(at.r, at.c));
      return;
    }
    if (v !== null && !here) commit();
    else if (v !== null) return;
    e.preventDefault();
    if (e.shiftKey) return setSel(at, true), focusGrid();
    if (here && v === null && !multi) return startEdit();
    setSel(at);
    dragging.current = true;
    focusGrid();
  };

  const onPaste = (e: ReactClipboardEvent) => {
    if (e.target !== catcher.current) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n");
    const patch: Record<string, string> = {};
    let maxC = 0;
    const sel = { r: box.r0, c: box.c0 };
    lines.forEach((line, i) =>
      line.split("\t").forEach((v, j) => {
        if (sel.r + i < MAX_ROWS && sel.c + j < MAX_COLS) patch[cellId(sel.r + i, sel.c + j)] = v.trim();
        maxC = Math.max(maxC, j);
      }),
    );
    setCells(patch, { rows: Math.min(MAX_ROWS, sel.r + lines.length), cols: Math.min(MAX_COLS, sel.c + maxC + 1) });
  };
  const onCopy = (e: ReactClipboardEvent) => {
    if (e.target !== catcher.current) return;
    e.preventDefault();
    const out: string[] = [];
    for (let r = box.r0; r <= box.r1; r++) {
      const line: string[] = [];
      for (let c = box.c0; c <= box.c1; c++) line.push(shown(sheet.cells[cellId(r, c)] ?? "", values[cellId(r, c)]));
      out.push(line.join("\t"));
    }
    e.clipboardData.setData("text/plain", out.join("\n"));
  };

  const rows = Array.from({ length: sheet.rows }, (_, r) => r);
  const cols = Array.from({ length: sheet.cols }, (_, c) => c);

  return (
    <section className="sk-wsg" aria-label="Sheet" onPaste={onPaste} onCopy={onCopy}>
      <input ref={catcher} className="sk-wsg-catch" aria-label={`Cell ${id}${raw ? `: ${raw}` : ", empty"}. Type to replace, Enter to edit, arrows to move.`} autoComplete="off" autoCapitalize="off" spellCheck={false} onKeyDown={onGridKey} onChange={onCatch} />
      <div className="sk-ws-bar sk-wsg-tools" role="toolbar" aria-label="Cell format" onMouseDown={(e) => (e.target as HTMLElement).closest("button, summary") && e.preventDefault()}>
        <button type="button" title="Undo (⌘Z)" aria-label="Undo" onClick={() => history(true)}>↶</button>
        <button type="button" title="Redo (⇧⌘Z)" aria-label="Redo" onClick={() => history(false)}>↷</button>
        <i />
        <button type="button" className={fmtHere.b ? "is-on" : ""} aria-pressed={!!fmtHere.b} title="Bold (⌘B)" aria-label="Bold" onClick={() => toggle("b")}><b>B</b></button>
        <button type="button" className={fmtHere.i ? "is-on" : ""} aria-pressed={!!fmtHere.i} title="Italic (⌘I)" aria-label="Italic" onClick={() => toggle("i")}><i style={{ fontStyle: "italic" }}>I</i></button>
        <button type="button" className={fmtHere.s ? "is-on" : ""} aria-pressed={!!fmtHere.s} title="Strikethrough" aria-label="Strikethrough" onClick={() => toggle("s")}><s>S</s></button>
        <i />
        <details className="sk-ws-pal">
          <summary title="Text color" aria-label="Text color"><span className="sk-ws-a" style={fmtHere.fg ? { borderBottomColor: fmtHere.fg } : undefined}>A</span></summary>
          <div>
            {TEXT.map((c) => <button key={c} type="button" style={{ background: c }} aria-label={`Text color ${c}`} onClick={(e) => (setFmt({ fg: c }), closePal(e))} />)}
            <button type="button" className="sk-wsg-none" aria-label="Default text color" title="Default" onClick={(e) => (setFmt({ fg: undefined }), closePal(e))} />
          </div>
        </details>
        <details className="sk-ws-pal">
          <summary title="Highlight (fill)" aria-label="Highlight color"><span className="sk-ws-hl" style={fmtHere.bg ? { background: fmtHere.bg } : undefined}>ab</span></summary>
          <div>
            {FILL.map((c) => <button key={c} type="button" style={{ background: c }} aria-label={`Highlight ${c}`} onClick={(e) => (setFmt({ bg: c }), closePal(e))} />)}
            <button type="button" className="sk-wsg-none" aria-label="No highlight" title="None" onClick={(e) => (setFmt({ bg: undefined }), closePal(e))} />
          </div>
        </details>
        <i />
        {(["left", "center", "right"] as const).map((al) => (
          <button key={al} type="button" className={fmtHere.al === al ? "is-on" : ""} aria-pressed={fmtHere.al === al} title={`Align ${al}`} aria-label={`Align ${al}`} onClick={() => setFmt({ al: fmtHere.al === al ? undefined : al })}>
            {al === "left" ? "⯇" : al === "center" ? "≡" : "⯈"}
          </button>
        ))}
        <button type="button" title="Clear formatting" aria-label="Clear formatting" onClick={() => setFmt({ b: undefined, i: undefined, s: undefined, fg: undefined, bg: undefined, al: undefined })}>T̸</button>
        <i />
        <button type="button" title="Add a row" disabled={sheet.rows >= MAX_ROWS} onClick={() => setCells({}, { rows: sheet.rows + 1 })}>+ Row</button>
        <button type="button" title="Add a column" disabled={sheet.cols >= MAX_COLS} onClick={() => setCells({}, { cols: sheet.cols + 1 })}>+ Col</button>
        {tools}
      </div>
      <div className="sk-wsg-bar">
        <b className="sk-wsg-name" aria-label="Selected cell">{multi ? `${cellId(box.r0, box.c0)}:${cellId(box.r1, box.c1)}` : id}</b>
        <span className="sk-wsg-fxlabel" aria-hidden>fx</span>
        <input
          className="sk-wsg-fx"
          aria-label={`Contents of ${id}`}
          placeholder="Type a value, or = for a formula like =SUM(A1:A5)"
          value={edit ?? raw}
          onFocus={() => edit === null && startEdit()}
          onChange={(e) => setEdit(e.target.value)}
          onKeyDown={(e) => onEditKey(e, true)}
          onBlur={commit}
        />
      </div>
      <div className="sk-wsg-wrap" ref={wrap} role="grid" aria-label="Sheet cells" aria-rowcount={sheet.rows} aria-colcount={sheet.cols} >
        <table className="sk-wsg-table" style={{ width: 38 + cols.reduce((s, c) => s + widthOf(c), 0) }}>
          <colgroup>
            <col style={{ width: 38 }} />
            {cols.map((c) => <col key={c} style={{ width: widthOf(c) }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="sk-wsg-corner" aria-hidden />
              {cols.map((c) => (
                <th key={c} scope="col" className={c >= box.c0 && c <= box.c1 ? "is-on" : ""}>
                  {colName(c)}
                  <span
                    className={`sk-wsg-rs${drag?.c === c ? " is-on" : ""}`}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Column ${colName(c)} width`}
                    aria-valuenow={widthOf(c)}
                    aria-valuemin={MIN_COL_W}
                    aria-valuemax={MAX_COL_W}
                    tabIndex={0}
                    title="Drag to resize · double-click to fit"
                    onPointerDown={(e) => startResize(c, e)}
                    onDoubleClick={() => fitColumn(c)}
                    onKeyDown={(e) => {
                      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                      e.preventDefault();
                      setWidth(c, clampW(widthOf(c) + (e.key === "ArrowLeft" ? -8 : 8)));
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <th scope="row" className={r >= box.r0 && r <= box.r1 ? "is-on" : ""}>{r + 1}</th>
                {cols.map((c) => {
                  const k = cellId(r, c);
                  const cellRaw = sheet.cells[k] ?? "";
                  const out = shown(cellRaw, values[k]);
                  const on = r === sel.r && c === sel.c;
                  const v = values[k];
                  const isNum = typeof v === "number" || (cellRaw !== "" && !cellRaw.startsWith("=") && toNumber(cellRaw) !== null);
                  const isErr = cellRaw.startsWith("=") && out.startsWith("#");
                  const f = sheet.fmt?.[k];
                  const style = f
                    ? {
                        fontWeight: f.b ? 700 : undefined,
                        fontStyle: f.i ? "italic" : undefined,
                        textDecoration: f.s ? "line-through" : undefined,
                        background: f.bg,
                        // pastel fills keep dark text so they read in dark mode too
                        color: f.fg ?? (f.bg ? "#1f2328" : undefined),
                        textAlign: f.al,
                      }
                    : undefined;
                  return (
                    <td
                      key={c}
                      data-cell={k}
                      data-col={c}
                      role="gridcell"
                      aria-selected={inBox(r, c)}
                      title={cellRaw.startsWith("=") ? `${cellRaw} → ${out}` : undefined}
                      className={`${on ? "is-on" : ""}${multi && inBox(r, c) ? " is-in" : ""}${isNum ? " is-num" : ""}${isErr ? " is-err" : ""}`}
                      style={style}
                      onMouseDown={(e) => pickCell({ r, c }, e)}
                      onMouseEnter={(e) => dragging.current && e.buttons === 1 && edit === null && setSel({ r, c }, true)}
                      onDoubleClick={() => on && edit === null && startEdit()}
                    >
                      {on && edit !== null ? (
                        <input
                          className="sk-wsg-in"
                          autoFocus
                          aria-label={`Edit ${k}`}
                          value={edit}
                          onChange={(e) => setEdit(e.target.value)}
                          onKeyDown={(e) => onEditKey(e)}
                          onBlur={(e) => {
                            // moving into the fx bar keeps the edit going
                            if ((e.relatedTarget as HTMLElement | null)?.classList.contains("sk-wsg-fx")) return;
                            commit();
                          }}
                        />
                      ) : (
                        out
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small className="sk-wsg-hint">Type = for math: =A1+B1 · =SUM(A1:A10) · AVERAGE, MIN, MAX, COUNT, ROUND, IF. Click a cell while typing a formula to add it.</small>
    </section>
  );
}
