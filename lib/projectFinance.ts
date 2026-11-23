import type { CompletionLedger } from './completions';
import { isReopened } from './completions';
import { isRealCompletion } from './syncState';

/** Absence from a dues snapshot is not proof of payment. Match the exact payment identity. */
export function confirmedProjectBillPayment(dueKey: string, ledger?: CompletionLedger): boolean {
  return Object.values(ledger?.entries || {}).some(entry => entry.source === 'radall' && entry.taskId === dueKey && isRealCompletion(entry) && !isReopened(entry));
}
