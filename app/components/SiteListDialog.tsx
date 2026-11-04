"use client";

import { useEffect, useState } from "react";
import { Dialog } from "../sticker/Dialog";
import { Circle } from "../sticker/kit";
import { Icon } from "../sticker/Icon";
import { SearchPick } from "../sticker/SearchPick";
import { sourceById } from "../../lib/sources";
import { PLAN, loadLanes, openTaskPanel, pinKey, placePin, unpin, usePriorityPins } from "../../lib/priorityPins";
import {
  addToSiteList,
  deleteSiteList,
  listOfTask,
  OPEN_SITE_LIST_EVENT,
  removeFromSiteList,
  renameSiteList,
  setListAlsoIn,
  useSiteLists,
  viewOfList,
  type SiteList,
} from "../../lib/siteLists";

/** Opens any site list (from a site's task list, the All tab, or a goal) in one pop-out. */
export function SiteListHost() {
  const { store } = useSiteLists();
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const open = (e: Event) => setOpenId((e as CustomEvent).detail as string);
    window.addEventListener(OPEN_SITE_LIST_EVENT, open);
    return () => window.removeEventListener(OPEN_SITE_LIST_EVENT, open);
  }, []);
  const list = openId ? store[openId] : undefined;
  if (!list || list.gone) return null;
  return <ListDialog list={list} close={() => setOpenId(null)} />;
}

function hasNotes(site: string, id: string) {
  const e = loadLanes()[pinKey(site as never, id)];
  return Boolean(e && (e.note || e.before?.length || e.subs?.length));
}

function ListDialog({ list, close }: { list: SiteList; close: () => void }) {
  const { store, snapshots, complete, doneOf } = useSiteLists();
  const { open, total, done, items } = viewOfList(list, snapshots, doneOf);
  const site = sourceById[list.site];
  const { lanes } = usePriorityPins();
  const deckKey = pinKey(list.site, `list:${list.id}`);
  const inDoing = Boolean(lanes[deckKey]?.lane);
  // Pool tasks of this site that aren't in any list yet, to add.
  const pool = (snapshots[list.site]?.tasks || [])
    .filter(
      (t) =>
        t.status !== "done" &&
        t.kind !== "list" &&
        t.kind !== "habit" &&
        !t.id.startsWith("habit-") &&
        !listOfTask(store, list.site, t.id),
    )
    .map((t) => ({ key: t.id, label: t.title, sub: t.tag || t.detail || undefined }));
  return (
    <Dialog label={list.name} onClose={close} className="sk-listdlg" dataSite={list.site}>
      <header className="sk-dialog-head">
        <Icon name="steps" size={18} />
        <input
          className="sk-fd-title"
          value={list.name}
          onChange={(e) => renameSiteList(list.id, e.target.value)}
          onBlur={(e) => renameSiteList(list.id, e.target.value.trim())}
          aria-label="List name"
          maxLength={60}
          data-autofocus
        />
        <button type="button" className="sk-btn is-small is-icon" onClick={close} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </header>
      <p className="sk-sec">
        {site.name} · {done} of {total} done · counts as one task in {site.shortName}
      </p>
      <div className="sk-listdlg-doing">
        {inDoing ? (
          <>
            <span className="sk-cap">✓ In Doing Now</span>
            <button type="button" className="sk-btn is-small is-quiet" onClick={() => unpin(deckKey)}>
              Take off Doing Now
            </button>
          </>
        ) : (
          <button type="button" className="sk-btn is-small" onClick={() => placePin(deckKey, PLAN)}>
            ＋ Add list to Doing Now
          </button>
        )}
      </div>
      <ul className="sk-listdlg-tasks">
        {items.map((t) => t.done ? (
          <li key={t.id} className="is-done">
            <span className="sk-circle is-done" aria-hidden="true"><Icon name="check" size={12} /></span>
            <button type="button" className="sk-fd-taskopen" title="Done — open its notes" onClick={() => openTaskPanel(pinKey(list.site, t.id))}>
              {t.title}
            </button>
            <span />
          </li>
        ) : (
          <li key={t.id}>
            <Circle onDone={() => complete(list.site, t.id)} label={`Done: ${t.title}`} />
            <button type="button" className="sk-fd-taskopen" title="Open its notes, questions and findings" onClick={() => openTaskPanel(pinKey(list.site, t.id))}>
              {t.title}
              {hasNotes(list.site, t.id) ? " ✎" : ""}
            </button>
            <button
              type="button"
              className="sk-btn is-small is-quiet"
              onClick={() => removeFromSiteList(list.id, t.id)}
              title="Take it out of the list and put it back in the pool"
            >
              Take out
            </button>
          </li>
        ))}
        {!open.length ? <li className="sk-empty">Everything in this list is done.</li> : null}
      </ul>
      <div className="sk-listdlg-add">
        <span className="sk-cap">Add a {site.shortName} task (it leaves the pool)</span>
        <SearchPick
          options={pool}
          label={`Search ${site.shortName} tasks`}
          placeholder="Search tasks…"
          disabled={!pool.length}
          onPick={(o) => addToSiteList(list.id, [o.key])}
        />
      </div>
      <div className="sk-listdlg-add">
        <span className="sk-cap">Also show as a benchmark in</span>
        <div className="sk-listdlg-also">
          {(["move", "self", "candle", "radall", "role", "resale", "income"] as const)
            .filter((s) => s !== list.site && sourceById[s])
            .map((s) => {
              const on = (list.alsoIn || []).includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  className={`sk-btn is-small${on ? "" : " is-quiet"}`}
                  aria-pressed={on}
                  onClick={() => setListAlsoIn(list.id, on ? (list.alsoIn || []).filter((x) => x !== s) : [...(list.alsoIn || []), s])}
                >
                  {on ? "✓ " : ""}
                  {sourceById[s].shortName}
                </button>
              );
            })}
        </div>
      </div>
      <footer className="sk-fd-foot">
        <span className="sk-fd-hint">Add this list to a goal from the goal’s pop-out; it stays here too.</span>
        <button
          type="button"
          className="sk-btn is-small is-quiet"
          onClick={() => {
            deleteSiteList(list.id);
            close();
          }}
        >
          Delete list (tasks go back to the pool)
        </button>
      </footer>
    </Dialog>
  );
}
