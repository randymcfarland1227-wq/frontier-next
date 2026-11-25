'use client';

/**
 * Goals page: every ongoing goal (the same records Short-term focus and the site pages use), grouped by
 * type — a goal's own "Goal type", else the site / section it belongs to. + adds a goal into an existing
 * type or a new one; the goal's pop-out has the type field and a Gallery for reference images.
 */
import { useContext, useState, type FormEvent } from 'react';
import { focusListView } from '../../lib/focusRouting';
import { isProject } from '../../lib/selfProjects';
import { goalGroupOf } from '../../lib/goalTypes';
import { dayKey } from '../../lib/schedule';
import type { BillDue } from '../../lib/schedule';
import { Group, PaneHeadContext, Section } from '../sticker/kit';
import { createPortal } from 'react-dom';
import { Icon } from '../sticker/Icon';
import { FocusCards, type LinkItem, type OpenFinance } from './FocusCards';
import { useShortTermFocus } from './FocusSection';

const NEW = '__new__';

const newGoalId = () => `${Date.now()}`;

export function GoalsView({ events = [], bills = [], openFinance }: { events?: LinkItem[]; bills?: BillDue[]; openFinance?: OpenFinance }) {
  // Inside a Today pane the tab line is the header: no Section box, the + goes up into the tab line's slot.
  const paneHead = useContext(PaneHeadContext);
  const focus = useShortTermFocus();
  const [allGoals, save] = focus.ongoing;
  // Projects share the record but aren't goals.
  const items = allGoals.filter((i) => !isProject(i));
  const groups = [...new Set(items.map(goalGroupOf))].sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)));
  const [adding, setAdding] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [newType, setNewType] = useState('');
  const open = (g?: string) => {
    setAdding('');
    setType(g || groups[0] || NEW);
    setNewType('');
    setTitle('');
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    const goalType = (type === NEW ? newType : type).trim();
    if (!title.trim() || !goalType) return;
    save([...allGoals, { id: newGoalId(), title: title.trim(), ongoing: true, goalType, added: dayKey(new Date()), at: new Date().toISOString() }]);
    setAdding(null);
  };
  const open_ = items.filter((i) => !i.done).length;
  const body = (
    <>
        {adding !== null ? (
          <form className="sk-goal-add" onSubmit={add}>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The goal — e.g. Find a 2-bed near work" aria-label="Goal" maxLength={120} />
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Goal type">
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              <option value={NEW}>+ New type…</option>
            </select>
            {type === NEW ? <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="New type — e.g. Fitness" aria-label="New goal type" maxLength={40} /> : null}
            <div className="sk-ref-btns">
              <button type="submit" className="sk-btn is-small" disabled={!title.trim() || (type === NEW && !newType.trim())}>Add goal</button>
              <button type="button" className="sk-btn is-small is-quiet" onClick={() => setAdding(null)}>Cancel</button>
            </div>
          </form>
        ) : null}
        {groups.length ? groups.map((g) => {
          const list = focusListView(focus.ongoing, (i) => !isProject(i) && goalGroupOf(i) === g);
          const left = list[0].filter((i) => !i.done).length;
          return (
            <Group key={g} tone="focus" icon="target" title={g} meta={`${left} open`} className="sk-goal-group"
              actions={<button type="button" className="sk-fc-plus is-small" aria-label={`Add a ${g} goal`} title={`Add a ${g} goal`} onClick={() => open(g)}><Icon name="plus" size={14} /></button>}>
              <FocusCards list={list} events={events} bills={bills} openFinance={openFinance} ticktick={undefined} label={g} noAdd />
            </Group>
          );
        }) : <p className="sk-empty">No goals yet. Press + to add your first one and give it a type.</p>}
    </>
  );
  if (paneHead !== undefined) {
    return (
      <div className="sk-goals is-pane">
        {paneHead ? createPortal(<span className="sk-ghead-actions"><button type="button" className="sk-fc-plus" aria-label="Add a goal" title="Add a goal" onClick={() => open()}><Icon name="plus" size={16} /></button></span>, paneHead) : null}
        <PaneHeadContext.Provider value={undefined}>{body}</PaneHeadContext.Provider>
      </div>
    );
  }
  return (
    <div className="sk-goals">
      <Section
        id="goals"
        title="Goals"
        summary={`${open_} ongoing · ${groups.length} type${groups.length === 1 ? '' : 's'}`}
        actions={<button type="button" className="sk-fc-plus" aria-label="Add a goal" title="Add a goal" onClick={() => open()}><Icon name="plus" size={16} /></button>}
      >
        {body}
      </Section>
    </div>
  );
}
