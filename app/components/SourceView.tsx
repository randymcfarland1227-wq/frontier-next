"use client";

import type {
  FeaturedItem,
  SourceId,
  SourceSnapshot,
  TaskItem,
} from "../../lib/types";
import { sourceById } from "../../lib/sources";
import type { SelfItem } from "../../lib/adapters/self";
import { MetricGrid } from "./MetricGrid";
import { FeaturedList } from "./FeaturedList";
import { TaskList } from "./TaskList";
import { ShelfList } from "./ShelfList";
import { SiteIcon } from "./SiteIcon";
import { SelfInbox } from "./SelfInbox";

export function SourceView({
  sourceId,
  snapshot,
  openSource,
  onCompleteFeatured,
  onCompleteTask,
  onStarTask,
  selfItems,
  onSelfAdd,
  onSelfComplete,
  onSelfStar,
}: {
  sourceId: SourceId;
  snapshot: SourceSnapshot;
  openSource: () => void;
  onCompleteFeatured: (item: FeaturedItem) => void;
  onCompleteTask: (task: TaskItem) => void;
  onStarTask: (task: TaskItem) => void;
  selfItems: SelfItem[];
  onSelfAdd: (title: string, detail: string) => void;
  onSelfComplete: (id: string) => void;
  onSelfStar: (id: string) => void;
}) {
  const copy = sourceById[sourceId];
  const links = copy.relatedLinks || [];
  return (
    <div className="room sksite" data-site={sourceId}>
      <section className="sk-group sksite-box sksite-hero">
        <SiteIcon source={sourceId} className="room-icon" />
        <div className="room-hero-main">
          <p className="sk-cap">{copy.eyebrow}</p>
          <h1 className="sk-title">{copy.name}</h1>
          {links.length ? (
            <div className="related-links room-related">
              {links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.label}
                </a>
              ))}
              <span className="related-hint">
                Goals build routines; routines build TickTick.
              </span>
            </div>
          ) : null}
          <p className="sk-sec">{copy.intro}</p>
        </div>
        <div className="sksite-open">
          {copy.url ? (
            <button
              className="sk-btn is-prominent"
              type="button"
              onClick={openSource}
            >
              Open {copy.name} <span>↗</span>
            </button>
          ) : (
            <button className="sk-btn" type="button" disabled>
              {copy.placeholder ? "Coming soon" : "No external link"}
            </button>
          )}
          <p className="sk-cap">
            {copy.placeholder
              ? "Not connected yet, so no numbers or tasks here."
              : copy.bridge === "local"
                ? "Hub-native: add, star and complete right here."
                : "Star items there to feature them here; Done here also marks it done there when the site supports it."}
          </p>
        </div>
      </section>
      <section className="sk-group sksite-box sksite-metrics">
        <MetricGrid sourceId={sourceId} snapshot={snapshot} />
      </section>
      <section className="work-ledger sksite-ledger">
        {sourceId === "self" ? (
          <section className="sk-group sksite-box">
            <SelfInbox
              items={selfItems}
              onAdd={onSelfAdd}
              onComplete={onSelfComplete}
              onStar={onSelfStar}
            />
          </section>
        ) : (
          <>
            <section className="sk-group sksite-box sksite-starred">
              <FeaturedList
                sourceId={sourceId}
                snapshot={snapshot}
                onComplete={onCompleteFeatured}
              />
            </section>
            <section className="sksite-tasks">
              <TaskList
                sourceId={sourceId}
                snapshot={snapshot}
                onComplete={onCompleteTask}
                onStar={onStarTask}
                split={sourceId === "ticktick"}
                fill={sourceId === "ticktick"}
              />
            </section>
            <ShelfList snapshot={snapshot} />
          </>
        )}
      </section>
    </div>
  );
}
