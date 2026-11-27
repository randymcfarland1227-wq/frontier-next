/**
 * Auto-filled money lists on a focus card: Overdue, Due today and Before next pay.
 * Each unpaid bill belongs to one auto list per card, so nothing shows twice:
 *   overdue (due before today) → the Overdue list, else Before next pay;
 *   due today                  → the Due today list, else Before next pay;
 *   due after today, before the next payday → Before next pay.
 * As days pass, an open bill moves on its own (a Due today bill becomes Overdue tomorrow).
 * Bills already in any other list on the card are left where they are, and a bill removed from an
 * auto list is remembered (autoSkip) so it isn't added back.
 */
export type AutoRule = 'overdue' | 'today' | 'payday';

export const AUTO_RULES: Array<{ rule: AutoRule; name: string; hint: string }> = [
  { rule: 'overdue', name: 'Overdue', hint: 'Every unpaid bill past its due date, added and kept up to date on its own' },
  { rule: 'today', name: 'Due today', hint: 'Bills due today (overdue ones stay out of it); tomorrow the unpaid ones move to Overdue' },
  { rule: 'payday', name: 'Before next pay', hint: 'Bills due before your next payday. Anything already on this card’s Overdue or Due today list stays there' },
];

type Task = { id: string; text: string; done: boolean; fin?: { key: string; label: string } };
type List = { id: string; name: string; tasks: Task[]; auto?: AutoRule; autoSkip?: string[] };
type Bill = { key: string; due: string; days: number; skipped?: boolean; bill: { name: string } };

/** Which auto list (by id) an unpaid bill belongs to, or null. */
function ownerOf(b: Bill, by: Partial<Record<AutoRule, string>>, payday: string | null): string | null {
  if (b.days < 0) return by.overdue ?? by.payday ?? null;
  if (b.days === 0) return by.today ?? by.payday ?? null;
  if (payday && b.due < payday) return by.payday ?? null;
  return null;
}

/** The card's lists with its auto lists brought up to date, or null when nothing changed. */
export function syncAutoLists<L extends List>(lists: L[], bills: Bill[], payday: string | null, newId: () => string): L[] | null {
  const by: Partial<Record<AutoRule, string>> = {};
  for (const l of lists) if (l.auto && !by[l.auto]) by[l.auto] = l.id;
  if (!Object.keys(by).length) return null;
  const open = new Map(bills.filter((b) => !b.skipped).map((b) => [`bill:${b.key}`, b]));
  const next = lists.map((l) => ({ ...l, tasks: [...l.tasks] }));
  const idx = new Map(next.map((l, i) => [l.id, i]));
  let changed = false;
  // 1. Move open bills that now belong to another auto list.
  for (const l of next) {
    if (!l.auto) continue;
    for (const t of [...l.tasks]) {
      const b = t.fin && !t.done ? open.get(t.fin.key) : undefined;
      if (!b) continue;
      const to = ownerOf(b, by, payday);
      if (!to || to === l.id) continue;
      l.tasks = l.tasks.filter((x) => x.id !== t.id);
      next[idx.get(to)!].tasks.push(t);
      changed = true;
    }
  }
  // 2. Add open bills that aren't on the card yet.
  const onCard = new Set(next.flatMap((l) => l.tasks.map((t) => t.fin?.key).filter(Boolean) as string[]));
  for (const b of [...open.values()].sort((x, y) => x.due.localeCompare(y.due))) {
    const key = `bill:${b.key}`;
    if (onCard.has(key)) continue;
    const to = ownerOf(b, by, payday);
    if (!to) continue;
    const l = next[idx.get(to)!];
    if (l.autoSkip?.includes(key)) continue;
    l.tasks.push({ id: newId(), text: b.bill.name, done: false, fin: { key, label: b.bill.name } });
    onCard.add(key);
    changed = true;
  }
  return changed ? (next as L[]) : null;
}
