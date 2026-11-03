'use client';
import { assignedFocusLists, FOCUS_SECTION_LABELS, type FocusTarget } from '../../lib/focusRouting';
import { sourceById } from '../../lib/sources';
import type { BillDue } from '../../lib/schedule';
import type { SourceId } from '../../lib/types';
import { Group } from '../sticker/kit';
import { FocusCards, type LinkItem, type OpenFinance } from './FocusCards';
import { useShortTermFocus } from './FocusSection';

export function AssignedFocus({ target, focus, events = [], bills = [], openFinance }: {
  target: FocusTarget; focus: ReturnType<typeof useShortTermFocus>;
  events?: LinkItem[]; bills?: BillDue[]; openFinance?: OpenFinance;
}) {
  const lists = assignedFocusLists(focus, target);
  const isSection = target in FOCUS_SECTION_LABELS;
  const name = isSection ? FOCUS_SECTION_LABELS[target as keyof typeof FOCUS_SECTION_LABELS] : sourceById[target as SourceId].name;
  const moving = target === 'move';
  return <Group tone="focus" icon="target" title={moving ? 'Moving goals' : 'Ongoing goals'} className="sk-assigned-focus" meta={name}>
    <FocusCards list={lists[2]} extra={lists.filter((_, i) => i !== 2)} events={events} bills={bills} openFinance={openFinance}
      defaults={isSection ? { section: target as keyof typeof FOCUS_SECTION_LABELS, ongoing: true } : { site: target as SourceId, ongoing: true }}
      label={moving ? "Add a moving goal" : `Add an ongoing goal for ${name}`} empty="Assigned focus items appear here with their scope, why and lists." />
  </Group>;
}

/** Sidebar site pages read the same existing focus keys, subscribing to edits from every view. */
export function SiteFocus(props: Omit<Parameters<typeof AssignedFocus>[0], 'focus'>) {
  const focus = useShortTermFocus();
  return <AssignedFocus {...props} focus={focus} />;
}
