"use client";

/**
 * Worksheet › Sheet view: a small spreadsheet grid beside the notes (same worksheet, toggled with the Sheet button).
 * Click or arrow to a cell, type to replace it, Enter/F2 or a second click to edit, "=" for a formula
 * (lib/sheetFormula.ts). Tab/Enter move on, Esc cancels, Delete clears, ⌘Z undoes, paste takes rows from a spreadsheet.
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent as ReactChangeEvent, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { MAX_COLS, MAX_ROWS, cellId, colName, evaluateSheet, shown, toNumber, type SheetData } from "../../lib/sheetFormula";

type At = { r: number; c: number };

export function SheetGrid({ data, onChange, tools }: { data: SheetData; onChange: (d: SheetData) => void; tools?: ReactNode }) {
  const [sheet, setSheetState] = useState<SheetData>(data);
  // the latest grid, so a commit followed by a move in the same event doesn't work from a stale copy
  const cur = useRef<SheetData>(data);
  const setSheet = (d: SheetData) => {
    cur.current = d;
    setSheetState(d);
  };
  const [sel, setSel] = useState<At>({ r: 0, c: 0 });
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
    if (changed || rows !== sheet.rows || cols !== sheet.cols) apply({ rows, cols, cells });
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
  const move = (dr: number, dc: number) => {
    const { rows, cols } = cur.current;
    let r = Math.max(0, sel.r + dr);
    const c = Math.min(cols - 1, Math.max(0, sel.c + dc));
    // Enter / ↓ past the last row adds one
    if (r >= rows) {
      if (rows < MAX_ROWS) setCells({}, { rows: r + 1 });
      else r = rows - 1;
    }
    setSel({ r, c });
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
    if (mod || e.altKey) return;
    const k = e.key;
    if (k === "ArrowUp") return e.preventDefault(), move(-1, 0);
    if (k === "ArrowDown") return e.preventDefault(), move(1, 0);
    if (k === "ArrowLeft") return e.preventDefault(), move(0, -1);
    if (k === "ArrowRight") return e.preventDefault(), move(0, 1);
    if (k === "Tab") return e.preventDefault(), move(0, e.shiftKey ? -1 : 1);
    if (k === "Enter") return e.preventDefault(), e.shiftKey ? move(-1, 0) : startEdit();
    if (k === "F2") return e.preventDefault(), startEdit();
    if (k === "Backspace" || k === "Delete") return e.preventDefault(), setCells({ [id]: "" });
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
    if (here && v === null) return startEdit();
    if (!here) setSel(at);
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
    e.clipboardData.setData("text/plain", shown(raw, values[id]));
  };

  const rows = Array.from({ length: sheet.rows }, (_, r) => r);
  const cols = Array.from({ length: sheet.cols }, (_, c) => c);

  return (
    <section className="sk-wsg" aria-label="Sheet" onPaste={onPaste} onCopy={onCopy}>
      <input ref={catcher} className="sk-wsg-catch" aria-label={`Cell ${id}${raw ? `: ${raw}` : ", empty"}. Type to replace, Enter to edit, arrows to move.`} autoComplete="off" autoCapitalize="off" spellCheck={false} onKeyDown={onGridKey} onChange={onCatch} />
      <div className="sk-wsg-bar" role="toolbar" aria-label="Sheet tools">
        <b className="sk-wsg-name" aria-label="Selected cell">{id}</b>
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
        <button type="button" title="Add a row" disabled={sheet.rows >= MAX_ROWS} onClick={() => setCells({}, { rows: sheet.rows + 1 })}>+ Row</button>
        <button type="button" title="Add a column" disabled={sheet.cols >= MAX_COLS} onClick={() => setCells({}, { cols: sheet.cols + 1 })}>+ Col</button>
        {tools}
      </div>
      <div className="sk-wsg-wrap" ref={wrap} role="grid" aria-label="Sheet cells" aria-rowcount={sheet.rows} aria-colcount={sheet.cols} >
        <table className="sk-wsg-table">
          <thead>
            <tr>
              <th className="sk-wsg-corner" aria-hidden />
              {cols.map((c) => <th key={c} scope="col" className={c === sel.c ? "is-on" : ""}>{colName(c)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <th scope="row" className={r === sel.r ? "is-on" : ""}>{r + 1}</th>
                {cols.map((c) => {
                  const k = cellId(r, c);
                  const cellRaw = sheet.cells[k] ?? "";
                  const out = shown(cellRaw, values[k]);
                  const on = r === sel.r && c === sel.c;
                  const v = values[k];
                  const isNum = typeof v === "number" || (cellRaw !== "" && !cellRaw.startsWith("=") && toNumber(cellRaw) !== null);
                  const isErr = cellRaw.startsWith("=") && out.startsWith("#");
                  return (
                    <td
                      key={c}
                      data-cell={k}
                      role="gridcell"
                      aria-selected={on}
                      title={cellRaw.startsWith("=") ? `${cellRaw} → ${out}` : undefined}
                      className={`${on ? "is-on" : ""}${isNum ? " is-num" : ""}${isErr ? " is-err" : ""}`}
                      onMouseDown={(e) => pickCell({ r, c }, e)}
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
