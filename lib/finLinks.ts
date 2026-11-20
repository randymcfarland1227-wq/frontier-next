'use client';

/** Linking a short-term focus to Finance: which debt-file items a link means, and the deep link into Finance. */

import { writeSaved } from './storage';

export const OPEN_DEBT_KEY = 'lifehub-open-debt';

/** Finance → Outstanding opens next time Money mounts, on this item's pop-out when an id is given. */
export function requestOpenDebt(id?: string, tab: 'owed' | 'flow' = 'owed') {
  writeSaved('lifehub-money-tab', tab);
  try {
    if (id) sessionStorage.setItem(OPEN_DEBT_KEY, id);
    else sessionStorage.removeItem(OPEN_DEBT_KEY);
  } catch {
    /* private mode: it still opens Outstanding */
  }
}

export function pendingDebt(): string | null {
  try {
    return sessionStorage.getItem(OPEN_DEBT_KEY);
  } catch {
    return null;
  }
}

export function clearPendingDebt() {
  try {
    sessionStorage.removeItem(OPEN_DEBT_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** A bill's own Money pop-out, from anywhere (same event MoneyPage's openMoneyDue fires; kept here so lists needn't import MoneyPage). */
export const openBillPop = (dueKey: string) => window.dispatchEvent(new CustomEvent('lifehub:open-money-due', { detail: dueKey }));

/** Mark a bill paid on Life Hub from anywhere (life-hub.tsx runs its payBill: ledger + sheet cross-off). */
export const PAY_BILL_EVENT = 'lifehub:pay-bill';
export const requestPayBill = (dueKey: string) => window.dispatchEvent(new CustomEvent(PAY_BILL_EVENT, { detail: dueKey }));
