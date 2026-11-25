'use client';
import { assignedFocusLists, FOCUS_SECTION_LABELS, type FocusTarget } from '../../lib/focusRouting';
import { sourceById } from '../../lib/sources';
import type { BillDue } from '../../lib/schedule';
import type { SourceId } from '../../lib/types';
import { Group } from '../sticker/kit';
import { FocusCards, type LinkItem, type OpenFinance } from './FocusCards';
import { useShortTermFocus, type Entry } from './FocusSection';
import { localDayKey } from '../../lib/dayKey';

export function AssignedFocus({ target, focus, events = [], bills = [], openFinance }: {
  target: FocusTarget; focus: ReturnType<typeof useShortTermFocus>;
  events?: LinkItem[]; bills?: BillDue[]; openFinance?: OpenFinance;
}) {
  const lists = assignedFocusLists(focus, target);
  const isSection = target in FOCUS_SECTION_LABELS;
  const name = isSection ? FOCUS_SECTION_LABELS[target as keyof typeof FOCUS_SECTION_LABELS] : sourceById[target as SourceId].name;
  const moving = target === 'move';
  // A site's + asks what it is: a plain project (not Short-term focus), a Short-term focus card, or a goal.
  const make = (li: number, extra: Partial<Entry>) => (title: string) => {
    const id = `${Date.now()}`;
    const [items, save] = lists[li];
    save([...items, { id, title, site: target as SourceId, added: localDayKey(), ...extra }]);
    return id;
  };
  const kinds = [
    { id: 'project', label: 'Project', add: make(0, { kind: 'project' }) },
    { id: 'focus', label: 'Short-term focus', add: make(0, {}) },
    { id: 'goal', label: 'Goal', add: make(2, { ongoing: true }) },
  ];
  // Move OS is mostly goals, so Goal is picked first there.
  const addAs = isSection ? undefined : moving ? [kinds[2], kinds[0], kinds[1]] : kinds;
  return <Group tone="focus" icon="target" title={moving ? 'Moving goals' : isSection ? 'Ongoing goals' : 'Projects & goals'} className="sk-assigned-focus" meta={name}>
    <FocusCards list={lists[2]} extra={lists.filter((_, i) => i !== 2)} events={events} bills={bills} openFinance={openFinance}
      defaults={isSection ? { section: target as keyof typeof FOCUS_SECTION_LABELS, ongoing: true } : { site: target as SourceId, ongoing: true }}
      addAs={addAs} label={moving ? "Add to Moving goals" : isSection ? `Add an ongoing goal for ${name}` : `Add a project, focus or goal for ${name}`} empty="Assigned focus items appear here with their scope, why and lists." />
  </Group>;
}

/** Sidebar site pages read the same existing focus keys, subscribing to edits from every view. */
export function SiteFocus(props: Omit<Parameters<typeof AssignedFocus>[0], 'focus'>) {
  const focus = useShortTermFocus();
  return <AssignedFocus {...props} focus={focus} />;
}
