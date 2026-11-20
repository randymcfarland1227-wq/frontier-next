"use client";

/**
 * Today › Worksheet: scratch documents like a quick Google Doc. A list of saved sheets (new / open / delete),
 * a title, a formatting toolbar, and @ to link a task, focus card, goal or money item (the link opens it).
 * Saves as you type (lib/worksheets.ts), and cloud sync carries it to other devices.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cleanHtml, deleteWorksheet, newWorksheet, saveWorksheet, useWorksheets } from "../../lib/worksheets";
import { readSaved, writeSaved } from "../../lib/storage";
import { Icon } from "../sticker/Icon";

export type MentionOpt = { key: string; label: string; sub?: string; group: string };

const SIZES: [string, string][] = [["2", "Small"], ["3", "Normal"], ["5", "Large"], ["6", "Huge"]];
const BLOCKS: [string, string][] = [["P", "Text"], ["H1", "Title"], ["H2", "Heading"], ["H3", "Subheading"], ["BLOCKQUOTE", "Quote"]];
const COLORS = ["#1f2328", "#f6f8fa", "#d1242f", "#e16f24", "#bf8700", "#1a7f37", "#0969da", "#8250df", "#bf3989", "#6e7781"];
const MARKS = ["#fff3a3", "#ffd6a5", "#c9f2c7", "#bde0fe", "#ffc8dd", "transparent"];

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
};
const plainOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function WorksheetTab({ mentions, openMention }: { mentions: MentionOpt[]; openMention: (key: string) => void }) {
  const store = useWorksheets();
  const sheets = useMemo(() => Object.values(store).filter((s) => !s.gone).sort((a, b) => b.at.localeCompare(a.at)), [store]);
  const [openId, setOpenIdState] = useState<string>(() => readSaved<string>("sk-worksheet-open", ""));
  const setOpenId = (id: string) => {
    setOpenIdState(id);
    writeSaved("sk-worksheet-open", id);
  };
  const [q, setQ] = useState("");
  const current = openId && store[openId] && !store[openId].gone ? store[openId] : undefined;
  const shown = q.trim() ? sheets.filter((s) => `${s.title} ${plainOf(s.html)}`.toLowerCase().includes(q.trim().toLowerCase())) : sheets;

  const create = () => setOpenId(newWorksheet(""));
  const remove = (id: string, title: string) => {
    if (!window.confirm(`Delete “${title || "Untitled worksheet"}”? This can't be undone.`)) return;
    deleteWorksheet(id);
    if (id === openId) setOpenId("");
  };

  return (
    <div className="sk-ws">
      <aside className="sk-ws-side" aria-label="Worksheets">
        <button type="button" className="sk-btn is-small sk-ws-new" onClick={create}>
          <Icon name="plus" size={14} /> New worksheet
        </button>
        <input type="search" className="sk-ws-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search worksheets" aria-label="Search worksheets" />
        <ul className="sk-ws-list">
          {shown.map((s) => (
            <li key={s.id} className={s.id === current?.id ? "is-on" : ""}>
              <button type="button" className="sk-ws-open" onClick={() => setOpenId(s.id)} aria-current={s.id === current?.id}>
                <b>{s.title || "Untitled worksheet"}</b>
                <small>{fmtWhen(s.at)} · {plainOf(s.html).slice(0, 60) || "Empty"}</small>
              </button>
              <button type="button" className="sk-btn is-small is-icon is-quiet" aria-label={`Delete ${s.title || "Untitled worksheet"}`} title="Delete" onClick={() => remove(s.id, s.title)}>
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
          {!shown.length ? <li className="sk-ws-empty">{q ? "No worksheets match." : "No worksheets yet."}</li> : null}
        </ul>
      </aside>
      {current ? (
        <Editor key={current.id} id={current.id} title={current.title} html={current.html} at={current.at} mentions={mentions} openMention={openMention} />
      ) : (
        <div className="sk-ws-blank">
          <p>Scratch space for working things out: notes, math, plans. Type @ to link a task, goal or money item.</p>
          <button type="button" className="sk-btn" onClick={create}>
            <Icon name="plus" size={14} /> New worksheet
          </button>
        </div>
      )}
    </div>
  );
}

function Editor({ id, title, html, at, mentions, openMention }: { id: string; title: string; html: string; at: string; mentions: MentionOpt[]; openMention: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [name, setName] = useState(title);
  const [saved, setSaved] = useState(at);
  const [dirty, setDirty] = useState(false);
  const [, bump] = useState(0);
  // @ mention picker: the text typed after @, where to show it, which row is highlighted
  const [mq, setMq] = useState<{ text: string; x: number; y: number } | null>(null);
  const [mi, setMi] = useState(0);

  // Load once per sheet; after that the editor owns its DOM (re-rendering innerHTML would move the caret).
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = cleanHtml(html);
    if (!title) document.querySelector<HTMLInputElement>(".sk-ws-title")?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!ref.current) return;
    saveWorksheet(id, { html: cleanHtml(ref.current.innerHTML) });
    setSaved(new Date().toISOString());
    setDirty(false);
  }, [id]);
  const queue = () => {
    setDirty(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 700);
  };
  useEffect(() => () => flush(), [flush]);

  // The toolbar's menus (style, size, colors) take focus; keep the last selection in the page and put it back first.
  const lastRange = useRef<Range | null>(null);
  useEffect(() => {
    const keep = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && ref.current?.contains(sel.anchorNode)) lastRange.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener("selectionchange", keep);
    return () => document.removeEventListener("selectionchange", keep);
  }, []);
  const exec = (cmd: string, value?: string) => {
    ref.current?.focus();
    const sel = window.getSelection();
    if (lastRange.current && sel && !(sel.rangeCount && ref.current?.contains(sel.anchorNode))) {
      sel.removeAllRanges();
      sel.addRange(lastRange.current);
    }
    document.execCommand("styleWithCSS", false, cmd === "fontSize" ? "false" : "true");
    document.execCommand(cmd, false, value);
    queue();
    bump((n) => n + 1);
  };
  const on = (cmd: string) => {
    try {
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };

  const matches = useMemo(() => {
    if (!mq) return [];
    const n = mq.text.toLowerCase();
    return mentions.filter((m) => !n || `${m.label} ${m.sub || ""} ${m.group}`.toLowerCase().includes(n)).slice(0, 12);
  }, [mq, mentions]);

  /** The "@words" right before the caret, if the caret is in one. */
  const mentionAtCaret = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !ref.current?.contains(node)) return null;
    const before = (node.textContent || "").slice(0, sel.anchorOffset);
    const m = /(^|\s)@([^@\n]{0,40})$/.exec(before);
    if (!m) return null;
    return { node: node as Text, start: sel.anchorOffset - m[2].length - 1, end: sel.anchorOffset, text: m[2] };
  };
  const checkMention = () => {
    const hit = mentionAtCaret();
    if (!hit) return setMq(null);
    const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
    const box = ref.current!.getBoundingClientRect();
    setMq({ text: hit.text, x: Math.max(0, r.left - box.left), y: r.bottom - box.top + 4 });
    setMi(0);
  };
  const pick = (o: MentionOpt) => {
    const hit = mentionAtCaret();
    if (!hit) return setMq(null);
    const range = document.createRange();
    range.setStart(hit.node, hit.start);
    range.setEnd(hit.node, hit.end);
    range.deleteContents();
    const chip = document.createElement("a");
    chip.className = "sk-ws-mention";
    chip.contentEditable = "false";
    chip.dataset.key = o.key;
    chip.title = `${o.group}${o.sub ? ` · ${o.sub}` : ""} — click to open`;
    chip.textContent = `@${o.label}`;
    const space = document.createTextNode(" ");
    range.insertNode(space);
    range.insertNode(chip);
    const sel = window.getSelection()!;
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
    setMq(null);
    queue();
  };

  const onKey = (e: ReactKeyboardEvent) => {
    if (mq && matches.length) {
      if (e.key === "ArrowDown") return e.preventDefault(), setMi((i) => (i + 1) % matches.length);
      if (e.key === "ArrowUp") return e.preventDefault(), setMi((i) => (i - 1 + matches.length) % matches.length);
      if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), pick(matches[mi]);
    }
    if (mq && e.key === "Escape") return e.preventDefault(), setMq(null);
    if (e.key === "Tab") {
      e.preventDefault();
      exec(e.shiftKey ? "outdent" : "indent");
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      flush();
    }
  };

  const block = (() => {
    try {
      return String(document.queryCommandValue("formatBlock") || "p").toUpperCase();
    } catch {
      return "P";
    }
  })();

  return (
    <section className="sk-ws-doc">
      <header className="sk-ws-head">
        <input
          className="sk-ws-title"
          value={name}
          placeholder="Untitled worksheet"
          aria-label="Worksheet title"
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== title && saveWorksheet(id, { title: name.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), saveWorksheet(id, { title: name.trim() }), ref.current?.focus())}
        />
        <small className="sk-ws-saved" aria-live="polite">{dirty ? "Saving…" : `Saved ${fmtWhen(saved)}`}</small>
      </header>
      <div className="sk-ws-bar" role="toolbar" aria-label="Formatting" onMouseDown={(e) => (e.target as HTMLElement).closest("button, summary") && e.preventDefault()}>
        <button type="button" title="Undo (⌘Z)" aria-label="Undo" onClick={() => exec("undo")}>↶</button>
        <button type="button" title="Redo (⇧⌘Z)" aria-label="Redo" onClick={() => exec("redo")}>↷</button>
        <i />
        <select aria-label="Paragraph style" value={BLOCKS.some(([v]) => v === block) ? block : "P"} onChange={(e) => exec("formatBlock", e.target.value)}>
          {BLOCKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="Text size" defaultValue="" onChange={(e) => { exec("fontSize", e.target.value); e.target.value = ""; }}>
          <option value="" disabled>Size</option>
          {SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <i />
        <button type="button" className={on("bold") ? "is-on" : ""} aria-pressed={on("bold")} title="Bold (⌘B)" aria-label="Bold" onClick={() => exec("bold")}><b>B</b></button>
        <button type="button" className={on("italic") ? "is-on" : ""} aria-pressed={on("italic")} title="Italic (⌘I)" aria-label="Italic" onClick={() => exec("italic")}><i style={{ fontStyle: "italic" }}>I</i></button>
        <button type="button" className={on("underline") ? "is-on" : ""} aria-pressed={on("underline")} title="Underline (⌘U)" aria-label="Underline" onClick={() => exec("underline")}><u>U</u></button>
        <button type="button" className={on("strikeThrough") ? "is-on" : ""} aria-pressed={on("strikeThrough")} title="Strikethrough" aria-label="Strikethrough" onClick={() => exec("strikeThrough")}><s>S</s></button>
        <i />
        <details className="sk-ws-pal">
          <summary title="Text color" aria-label="Text color"><span className="sk-ws-a">A</span></summary>
          <div>
            {COLORS.map((c) => <button key={c} type="button" style={{ background: c }} aria-label={`Text color ${c}`} onClick={(e) => { exec("foreColor", c); (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }} />)}
          </div>
        </details>
        <details className="sk-ws-pal">
          <summary title="Highlight" aria-label="Highlight color"><span className="sk-ws-hl">ab</span></summary>
          <div>
            {MARKS.map((c) => <button key={c} type="button" style={{ background: c === "transparent" ? "repeating-linear-gradient(45deg,#ccc 0 3px,#fff 3px 6px)" : c }} aria-label={c === "transparent" ? "No highlight" : `Highlight ${c}`} onClick={(e) => { exec("hiliteColor", c); (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; }} />)}
          </div>
        </details>
        <i />
        <button type="button" className={on("insertUnorderedList") ? "is-on" : ""} title="Bulleted list" aria-label="Bulleted list" onClick={() => exec("insertUnorderedList")}>•≡</button>
        <button type="button" className={on("insertOrderedList") ? "is-on" : ""} title="Numbered list" aria-label="Numbered list" onClick={() => exec("insertOrderedList")}>1≡</button>
        <button type="button" title="Indent less (⇧Tab)" aria-label="Indent less" onClick={() => exec("outdent")}>⇤</button>
        <button type="button" title="Indent more (Tab)" aria-label="Indent more" onClick={() => exec("indent")}>⇥</button>
        <i />
        <button type="button" title="Align left" aria-label="Align left" onClick={() => exec("justifyLeft")}>⯇</button>
        <button type="button" title="Center" aria-label="Center" onClick={() => exec("justifyCenter")}>≡</button>
        <button type="button" title="Line" aria-label="Insert a line" onClick={() => exec("insertHorizontalRule")}>―</button>
        <button type="button" title="Clear formatting" aria-label="Clear formatting" onClick={() => exec("removeFormat")}>T̸</button>
        <button type="button" className="sk-ws-at" title="Link a task, goal or money item" aria-label="Insert a link with @" onClick={() => { ref.current?.focus(); document.execCommand("insertText", false, "@"); checkMention(); }}>@ Link</button>
      </div>
      <div className="sk-ws-page">
        <div
          ref={ref}
          className="sk-ws-edit"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Worksheet"
          data-placeholder="Start typing… Type @ to link a task, goal or money item."
          onInput={() => { queue(); checkMention(); }}
          onKeyDown={onKey}
          onKeyUp={(e) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) checkMention(); bump((n) => n + 1); }}
          onMouseUp={() => bump((n) => n + 1)}
          onBlur={() => { flush(); window.setTimeout(() => setMq(null), 150); }}
          onPaste={(e) => {
            const h = e.clipboardData.getData("text/html");
            if (!h) return;
            e.preventDefault();
            document.execCommand("insertHTML", false, cleanHtml(h));
          }}
          onClick={(e) => {
            const chip = (e.target as HTMLElement).closest<HTMLElement>(".sk-ws-mention");
            if (chip?.dataset.key) openMention(chip.dataset.key);
          }}
        />
        {mq ? (
          <div className="sk-ws-pop" role="listbox" aria-label="Link to" style={{ left: mq.x, top: mq.y }}>
            {matches.length ? matches.map((m, i) => (
              <button key={m.key} type="button" role="option" aria-selected={i === mi} className={i === mi ? "is-on" : ""} onMouseDown={(e) => { e.preventDefault(); pick(m); }}>
                <b>{m.label}</b>
                <small>{m.group}{m.sub ? ` · ${m.sub}` : ""}</small>
              </button>
            )) : <p>No matches for “{mq.text}”</p>}
          </div>
        ) : null}
      </div>
    </section>
  );
}
