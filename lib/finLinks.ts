'use client';

/** Linking a short-term focus to Finance: which debt-file items a link means, and the deep link into Finance. */

import { writeSaved } from './storage';

export const OPEN_DEBT_KEY = 'lifehub-open-debt';

/** Finance → Outstanding opens next time Money mounts, on this item's pop-out when an id is given. */
export function requestOpenDebt(id?: string) {
  writeSaved('lifehub-money-tab', 'owed');
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
