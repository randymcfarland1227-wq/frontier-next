import type { Entry } from '../app/components/FocusSection';
import type { SourceId } from './types';
export type FocusSectionId = 'nutrition' | 'fitness' | 'marvel';
export type FocusTarget = SourceId | FocusSectionId;
export const FOCUS_SECTION_LABELS: Record<FocusSectionId, string> = {
  nutrition: 'Nutrition focus', fitness: 'Fitness focus', marvel: 'Marvel’s focus',
};
export type FocusList = readonly [Entry[], (next: Entry[]) => void];
export type FocusCollections = {
  now: FocusList; weeks: FocusList; ongoing: FocusList;
  nutrition: FocusList; fitness: FocusList; marvel: FocusList;
};
export function focusCollections(focus: FocusCollections): Array<{ list: FocusList; home?: FocusSectionId }> {
  return [{ list: focus.now }, { list: focus.weeks }, { list: focus.ongoing },
    { list: focus.nutrition, home: 'nutrition' }, { list: focus.fitness, home: 'fitness' }, { list: focus.marvel, home: 'marvel' }];
}
export const focusTarget = (item: Entry, home?: FocusSectionId): FocusTarget | undefined => item.unassigned ? undefined : item.section || item.site || home;
/** Edit a filtered view in place: retain every record outside that view, including its saved order. */
export function focusListView(list: FocusList, visible: (item: Entry) => boolean): FocusList {
  const [all, save] = list;
  const shown = all.filter(visible);
  return [shown, next => {
    const oldIds = new Set(shown.map(i => i.id));
    const updates = new Map(next.map(i => [i.id, i]));
    save([...all.flatMap(i => oldIds.has(i.id) ? (updates.has(i.id) ? [updates.get(i.id)!] : []) : [i]),
      ...next.filter(i => !oldIds.has(i.id))]);
  }];
}
export const assignedFocusLists = (focus: FocusCollections, target: FocusTarget) =>
  focusCollections(focus).map(({ list, home }) => focusListView(list, i => focusTarget(i, home) === target));
