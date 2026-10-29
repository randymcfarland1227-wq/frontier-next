'use client';

import { useMemo, useState } from 'react';
import type { CompletionEntry } from '../../lib/completions';
import type { Capture } from '../../lib/captures';
import type { FocusArea } from '../../lib/focusAreas';
import { goalOf, linkGoalIndex, type GoalLink, type GoalsData } from '../../lib/goals';
import { sourceById } from '../../lib/sources';
import { taskRuleKey, useTaskRules } from '../../lib/taskRules';
import { AreaSelect, GoalSelect } from './SortControls';
import { Icon } from '../sticker/Icon';
import { Tag } from '../sticker/kit';

const SHOW = 8;

/**
 * Under "Completions across sites": things finished (often on their own site) that have no
 * bucket or goal yet. Picking one saves a rule, so the same task sorts itself next time.
 */
export function NeedsSorting({
  entries,
  areas,
  goals,
  links,
  captures,
  openSorting,
}: {
  entries: CompletionEntry[];
  areas: FocusArea[];
  goals: GoalsData | null;
  links: GoalLink[];
  captures: Capture[];
  openSorting: () => void;
}) {
  const { rules, save } = useTaskRules();
  const [open, setOpen] = useState(true);
  const linkIdx = useMemo(() => linkGoalIndex(links, captures), [links, captures]);

  const pending = useMemo(() => {
    const seen = new Map<string, { entry: CompletionEntry; key: string; area: string; goal: string; n: number }>();
    for (const e of entries) {
      const key = taskRuleKey(e.source, e.title, e.taskId);
      const prev = seen.get(key);
      if (prev) {
        prev.n += 1;
        continue;
      }
      const area = e.focusAreaId || '';
      const goal = goalOf(e.source, e.title, [e.taskId], rules, linkIdx) || '';
      if (area && goal) continue;
      seen.set(key, { entry: e, key, area, goal, n: 1 });
    }
    return [...seen.values()];
  }, [entries, rules, linkIdx]);

  if (!pending.length) return null;

  return (
    <div className="sk-sorting" role="region" aria-label="Completed tasks that need sorting">
      <button type="button" className="sk-callout" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>
          <span className="sk-hl">
            {pending.length} Completed Task{pending.length === 1 ? '' : 's'} Need{pending.length === 1 ? 's' : ''} an Area
          </span>
          <span className="sk-sec">So they count toward Balance</span>
        </span>
        <Icon name={open ? 'chevronDown' : 'chevron'} size={14} />
      </button>
      {open ? (
        <>
          <div className="sk-sort-list">
            {pending.slice(0, SHOW).map(p => (
              <div className="sk-sort-row" key={p.key}>
                <div className="sk-sort-task">
                  <Tag>{sourceById[p.entry.source]?.shortName || p.entry.source}</Tag>
                  <span className="sk-rt" title={p.entry.title}>
                    {p.entry.title || p.entry.taskId}
                  </span>
                  {p.n > 1 ? <span className="sk-sec">{p.n}×</span> : null}
                </div>
                <AreaSelect
                  areas={areas}
                  value={p.area}
                  onChange={v => save(p.key, { area: v || null })}
                  label={`Bucket for ${p.entry.title || 'task'}`}
                />
                <GoalSelect
                  goals={goals}
                  value={p.goal}
                  onChange={v => save(p.key, { goal: v || null })}
                  label={`Goal for ${p.entry.title || 'task'}`}
                />
              </div>
            ))}
          </div>
          <p className="sk-sec sk-sort-foot">
            Saved as you pick — the same task sorts itself next time.
            {pending.length > SHOW ? ` +${pending.length - SHOW} more. ` : ' '}
            <button type="button" className="sk-link" onClick={openSorting}>
              Open Task Sorting
            </button>
          </p>
        </>
      ) : null}
    </div>
  );
}
