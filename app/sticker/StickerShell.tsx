"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { SourceId, SpaceId } from "../../lib/types";
import { sourceById } from "../../lib/sources";
import { ZoomControl } from "../components/ZoomControl";
import { Icon, type IconName } from "./Icon";
import { readSaved, writeSaved } from "../../lib/storage";
import { useSiteIcons } from "../../lib/siteIcons";

/** Sites in the sidebar, in the same three groups as the Home site rows. */
export const SITE_GROUPS: {
  label: string;
  tone: "ops" | "role" | "vent";
  ids: SourceId[];
}[] = [
  {
    label: "Daily ops",
    tone: "ops",
    ids: ["ticktick", "radall", "self", "gmail", "outlook", "repair"],
  },
  { label: "Role · move", tone: "role", ids: ["role", "move"] },
  { label: "Ventures", tone: "vent", ids: ["income", "resale", "candle"] },
];

/** Sidebar colours Randy can pick from; the paint lives in sticker.css under [data-tint]. */
const SIDE_TINTS: { id: string; name: string; swatch: string }[] = [
  { id: "brown", name: "Brown", swatch: "#7a5238" },
  { id: "chocolate", name: "Chocolate", swatch: "#3f2b22" },
  { id: "tan", name: "Tan", swatch: "#d8b999" },
  { id: "rose", name: "Rose", swatch: "#b5586e" },
  { id: "forest", name: "Forest", swatch: "#2f5a45" },
  { id: "ocean", name: "Ocean", swatch: "#2f5b7e" },
  { id: "plum", name: "Plum", swatch: "#5d3d7a" },
  { id: "slate", name: "Slate", swatch: "#4a4f5e" },
  { id: "cream", name: "Cream", swatch: "#efe4d0" },
];

/** Sites with no logo of their own (yet) show a symbol, not an initial; an uploaded picture still wins. */
const SITE_FALLBACK: Partial<Record<SourceId, IconName>> = {
  role: "briefcase",
  self: "sparkles",
};

const PAGES: { id: SpaceId; label: string; icon: IconName; hint: string }[] = [
  { id: "home", label: "Home", icon: "home", hint: "Everything at a glance" },
  {
    id: "money",
    label: "Money",
    icon: "wallet",
    hint: "Bills, cards, pay later and plans from the Radall sheet",
  },
  {
    id: "logs",
    label: "Logs",
    icon: "logs",
    hint: "Nutrition & movement, Marvel, music",
  },
  {
    id: "why",
    label: "Why",
    icon: "compass",
    hint: "Summary, Flow, your goals and the work attached to them",
  },
];

/**
 * The sticker app frame: a sidebar that is navigation only (pages, then sites by group, then sync,
 * Refresh and Settings) — a 5-tab bar under 960px, with everything else in More.
 * Carries every action the old top bar had: sites, Why, Logs, Money, zoom, Settings, theme,
 * Refresh and the Today drawer.
 */
export function StickerShell({
  active,
  enter,
  unfinished,
  openFocus,
  onRefresh,
  syncing,
  syncLabel,
  theme,
  onToggleTheme,
  children,
}: {
  active: SpaceId;
  enter: (id: SpaceId) => void;
  unfinished: number;
  openFocus: () => void;
  onRefresh?: () => void;
  syncing?: boolean;
  syncLabel: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  children: ReactNode;
}) {
  const [more, setMore] = useState(false);
  const { iconFor } = useSiteIcons();
  // Sidebar colour: brown to start, changeable at the bottom of the sidebar, remembered per device.
  const [tint, setTint] = useState<string>(() =>
    readSaved("sk-side-tint", "brown"),
  );
  const pickTint = (id: string) => {
    setTint(id);
    writeSaved("sk-side-tint", id);
  };
  // Sidebar groups fold; which ones are folded is remembered per device.
  const [folded, setFolded] = useState<Record<string, boolean>>(() =>
    readSaved("sk-side-folded", {}),
  );
  const toggleGroup = (label: string) =>
    setFolded((f) => {
      const next = { ...f, [label]: !f[label] };
      writeSaved("sk-side-folded", next);
      return next;
    });
  // Collapsed = a slim icon rail; remembered per device.
  const [slim, setSlim] = useState(() => {
    try {
      return localStorage.getItem("sk-side-slim") === "1";
    } catch {
      return false;
    }
  });
  const toggleSlim = () =>
    setSlim((v) => {
      try {
        localStorage.setItem("sk-side-slim", v ? "0" : "1");
      } catch {
        /* private window: just don't remember */
      }
      return !v;
    });
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMore(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [more]);

  const go = (id: SpaceId) => {
    setMore(false);
    enter(id);
    window.scrollTo({ top: 0 });
  };
  const current = (id: SpaceId) =>
    active === id ? ("page" as const) : undefined;

  const sites = SITE_GROUPS.map((g) => {
    const closed = Boolean(folded[g.label]) && !slim; // the slim icon rail always shows every site
    return (
      <div key={g.label} className={`sk-navgroup${closed ? " is-folded" : ""}`}>
        <h2 className="sk-navh">
          <button
            type="button"
            className="sk-navh-btn"
            aria-expanded={!closed}
            onClick={() => toggleGroup(g.label)}
            title={closed ? `Show ${g.label}` : `Fold ${g.label}`}
          >
            <Icon name="chevron" className="sk-navh-chev" />
            {g.label}
          </button>
        </h2>
        {closed
          ? null
          : g.ids.map((id) => (
              <button
                key={id}
                type="button"
                className="sk-navi"
                aria-current={current(id)}
                onClick={() => go(id)}
                title={sourceById[id].label}
              >
                <span
                  className={`sk-sw tone-${g.tone}`}
                  aria-hidden="true"
                  data-initial={sourceById[id].name.slice(0, 1)}
                />
                <span className="sk-siteico" aria-hidden="true">
                  {iconFor(id) ? (
                    <>
                      {/* Plain <img>: Vite site, tiny bundled logos */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={iconFor(id)} alt="" />
                    </>
                  ) : (
                    <Icon name={SITE_FALLBACK[id] || "star"} />
                  )}
                </span>
                <span className="sk-navl">{sourceById[id].name}</span>
              </button>
            ))}
      </div>
    );
  });

  const tools = (
    <>
      <p className="sk-sec">{syncing ? "Syncing every source…" : syncLabel}</p>
      <div className="sk-tools">
        {onRefresh ? (
          <button
            type="button"
            className="sk-btn is-small"
            onClick={onRefresh}
            disabled={syncing}
            title="Sync Gmail, Radall, calendar, bills and TickTick now"
          >
            <Icon name="refresh" size={14} />
            {syncing ? "Syncing" : "Refresh"}
          </button>
        ) : null}
        <button
          type="button"
          className="sk-btn is-small is-icon"
          aria-pressed={active === "settings"}
          onClick={() => go(active === "settings" ? "home" : "settings")}
          aria-label="Settings — task sorting"
          title="Settings · Task sorting"
        >
          <Icon name="settings" size={14} />
        </button>
        <button
          type="button"
          className="sk-btn is-small is-icon"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={14} />
        </button>
      </div>
      <div className="sk-zoom">
        <span className="sk-cap">Page size</span>
        <ZoomControl />
      </div>
    </>
  );

  const todayButton = (
    <button
      type="button"
      className="sk-navi"
      onClick={() => {
        setMore(false);
        openFocus();
      }}
      title="Today: what you said you'd do today"
    >
      <Icon name="checks" />
      <span className="sk-navl">Today&apos;s List</span>
      {unfinished ? <span className="sk-navcount">{unfinished}</span> : null}
    </button>
  );

  return (
    <div
      className="sk-app"
      data-page={
        active === "home" ? "home" : active === "money" ? "money" : "classic"
      }
      data-side={slim ? "slim" : "full"}
    >
      <aside className="sk-side" data-tint={tint} aria-label="Life Hub">
        <div className="sk-sidehead">
          <button type="button" className="sk-brand" onClick={() => go("home")}>
            Randy&apos;s Life Hub
          </button>
          <button
            type="button"
            className="sk-btn is-small is-icon sk-slimtoggle"
            onClick={toggleSlim}
            aria-pressed={slim}
            aria-label={slim ? "Expand sidebar" : "Collapse sidebar"}
            title={slim ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name="sidebar" size={14} />
          </button>
        </div>
        <nav className="sk-nav" aria-label="Pages">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              className="sk-navi"
              aria-current={current(p.id)}
              onClick={() => go(p.id)}
              title={p.hint}
            >
              <Icon name={p.icon} />
              <span className="sk-navl">{p.label}</span>
            </button>
          ))}
          {todayButton}
        </nav>
        <nav className="sk-nav" aria-label="Sites">
          {sites}
        </nav>
        <div className="sk-sidefoot">
          <div className="sk-tints" role="group" aria-label="Sidebar colour">
            <span className="sk-cap">Sidebar</span>
            {SIDE_TINTS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="sk-tint"
                style={{ background: t.swatch }}
                aria-pressed={tint === t.id}
                aria-label={`${t.name} sidebar`}
                title={t.name}
                onClick={() => pickTint(t.id)}
              />
            ))}
          </div>
          {tools}
        </div>
      </aside>

      <div className="sk-main">
        {active === "home" ? (
          <div className="sk-content">{children}</div>
        ) : (
          children
        )}
      </div>

      <nav className="sk-tabbar" aria-label="Pages">
        {PAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-current={current(p.id)}
            onClick={() => go(p.id)}
          >
            <Icon name={p.icon} size={22} />
            {p.label}
          </button>
        ))}
        <button
          type="button"
          aria-expanded={more}
          aria-current={
            more || active === "settings" || sourceById[active as SourceId]
              ? "page"
              : undefined
          }
          onClick={() => setMore((m) => !m)}
        >
          <Icon name="more" size={22} />
          More
        </button>
      </nav>

      {more ? (
        <div className="sk-sheet-wrap" onClick={() => setMore(false)}>
          <div
            className="sk-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sk-sheet-head">
              <h2 className="sk-title">More</h2>
              <button
                type="button"
                className="sk-btn is-small is-icon"
                onClick={() => setMore(false)}
                aria-label="Close"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            {todayButton}
            {sites}
            <div className="sk-sidefoot">{tools}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
