/** The same red / yellow / green order used by the hub's task priorities. */
export type FocusPriority = 'red' | 'yellow' | 'green';
export const FOCUS_PRIORITY_LABEL: Record<FocusPriority, string> = {
  red: '1 · High', yellow: '2 · Medium', green: '3 · Low',
};
const rank = { red: 0, yellow: 1, green: 2 };
export function orderFocus<T extends { done?: boolean; priority?: FocusPriority }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done))
    || (a.priority ? rank[a.priority] : 3) - (b.priority ? rank[b.priority] : 3));
}
