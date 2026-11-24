/** Provider accounts and separate advance draws use the existing per-record finance findings backup. */
import { loadFindings, setFinding, type Finding, type FindingStore } from './finFindings';

export const CASH_PROVIDERS = ['Dave', 'Cleo', 'EarnIn', 'MoneyLion', 'Brigit', 'Tilt'];
export const cashProviderName = (name: string) => {
  const base = name.replace(/\s+(?:advance\s+repay(?:ment)?|advance|repay(?:ment)?)$/i, '').trim();
  const identity = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  return CASH_PROVIDERS.find(p => identity(p) === identity(base)) || base;
};
export const cashProviderKey = (name: string) => `cash-provider:${cashProviderName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
export type CashProvider = { key: string; name: string; removed: boolean };
export function cashProviders(store: FindingStore, names: string[] = []): CashProvider[] {
  const all = new Map<string, CashProvider>();
  for (const name of [...CASH_PROVIDERS, ...names]) {
    const key = cashProviderKey(name);
    if (!all.has(key)) all.set(key, { key, name: cashProviderName(name), removed: false });
  }
  for (const f of Object.values(store)) {
    if (!f?.key.startsWith('cash-provider:') || !f.name) continue;
    all.set(f.key, { key: f.key, name: f.name, removed: Boolean(f.gone) });
  }
  return [...all.values()].sort((a,b) => a.name.localeCompare(b.name));
}
export const cashDraws = (store: FindingStore, provider: string): Finding[] =>
  Object.values(store).filter(f => f && !f.gone && f.cashAdvance?.provider === provider);

/** Called only on the user's submitted form. Never seed or mutate existing sheet advances. */
export function logCashAdvance(input: { provider: string; received: number; repay: number; due: string; takenOn: string }): string {
  const name = cashProviderName(input.provider);
  const key = cashProviderKey(name);
  const validDay = (day: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const [year, month, date] = day.split('-').map(Number);
    const parsed = new Date(`${day}T12:00:00`);
    return parsed.getFullYear() === year && parsed.getMonth() + 1 === month && parsed.getDate() === date;
  };
  if (!name || key === 'cash-provider:' || !Number.isFinite(input.received) || Math.round(input.received * 100) <= 0 || !Number.isFinite(input.repay) || Math.round(input.repay * 100) <= 0 || !validDay(input.due) || !validDay(input.takenOn) || input.due < input.takenOn) throw new Error('Choose a source, positive amounts and a repayment date on or after the advance date.');
  const store = loadFindings();
  const existing = cashProviders(store).find(p => p.key === key);
  const providerName = existing?.name || name;
  if (!store[key] || store[key].gone) setFinding(key, { name: providerName });
  const id = crypto.randomUUID();
  setFinding(`cash-advance:${id}`, {
    name: `${providerName} Advance Repay`, amount: Math.round(input.repay * 100) / 100,
    cashAdvance: { provider: key, received: Math.round(input.received * 100) / 100, takenOn: input.takenOn },
    payments: [{ id, amount: Math.round(input.repay * 100) / 100, due: input.due }],
  });
  return `cash-advance:${id}`;
}
