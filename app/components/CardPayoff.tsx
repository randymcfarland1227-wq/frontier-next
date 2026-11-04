'use client';

import { useState } from 'react';
import { Icon } from '../sticker/Icon';
import { money } from '../../lib/schedule';
import { setMeta, type MetaEntry } from '../../lib/moneyMeta';
import { addMonths, fromYmd, monthlyCost, payByDate, payMonthly, paymentToClear, ymd, type CardInput, type MonthRow, type MonthlyPlan, type PlannedPayment } from '../../lib/cardProjection';
import type { CardRow } from './MoneyBoards';

/** Fee-charging cards by name (fee typed on Life Hub). Kept in step with MoneyBoards. */
export const FEE_CARD_NAMES = /milestone|indigo|destiny/i;

export const cardInput = (c: CardRow): CardInput => ({ bal: Math.max(0, c.bal || 0), apr: c.apr, fee: c.fee, limit: c.limit });

/** Minimum used for Model A: the sheet's / hub card's minimum, else the one typed on Life Hub. */
export const cardMin = (c: CardRow, m?: MetaEntry) => c.min ?? m?.min;

/** First payment of a projection: this month's due date if it's still ahead and unpaid, else next month's. */
export function firstPayDate(c: CardRow, paid: boolean, today = new Date()): Date {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (c.due) {
    const d = fromYmd(c.due.due);
    if (d >= t && !paid) return d;
    let next = addMonths(d, 1);
    while (next <= t) next = addMonths(next, 1);
    return next;
  }
  const day = c.hub?.dueDay;
  if (day) {
    const d = new Date(t.getFullYear(), t.getMonth(), Math.min(day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
    return d > t ? d : addMonths(d, 1);
  }
  return addMonths(t, 1);
}

/** Minimum-only plan, for the Credit tab list and the summary. */
export function minOnlyPlan(c: CardRow, m: MetaEntry | undefined, paid: boolean): MonthlyPlan | undefined {
  const min = cardMin(c, m);
  if (!c.bal || c.bal <= 0 || !min) return undefined;
  return payMonthly(cardInput(c), min, firstPayDate(c, paid));
}

export const monthYear = (s: string) => fromYmd(s).toLocaleDateString([], { month: 'short', year: 'numeric' });
const longDay = (s: string) => fromYmd(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const usd = (n?: number) => (n === undefined ? '—' : money(n) || '$0');
const pct = (n?: number) => (n === undefined ? '—' : `${Math.round(n)}%`);
const span = (n: number) => (n < 12 ? `${n} mo` : `${Math.floor(n / 12)} yr${n % 12 ? ` ${n % 12} mo` : ''}`);

function Fold({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <details className="skm-fold mb-po-fold">
      <summary>
        <Icon name="chevron" className="skm-fchev" />
        <span className="skm-ftitle">{title}</span>
        {meta ? <span className="sk-sec skm-fmeta">{meta}</span> : null}
      </summary>
      {children}
    </details>
  );
}

function MonthTable({ rows }: { rows: MonthRow[] }) {
  return (
    <div className="mb-scroll">
      <table className="mb-table mb-po-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Payment date</th>
            <th className="num">Start</th>
            <th className="num">Interest</th>
            <th className="num">Fee</th>
            <th className="num">Payment</th>
            <th className="num">Balance</th>
            <th className="num">Used</th>
            <th className="num">Available</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.n} className={r.util !== undefined && r.util <= 30 ? 'mb-po-under' : undefined}>
              <td>{r.n}</td>
              <td>{longDay(r.date)}</td>
              <td className="num">{usd(r.start)}</td>
              <td className="num">{usd(r.interest)}</td>
              <td className="num">{r.fee ? usd(r.fee) : '—'}</td>
              <td className="num">{usd(r.payment)}</td>
              <td className="num">{usd(r.end)}</td>
              <td className="num">{pct(r.util)}</td>
              <td className="num">{usd(r.avail)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Big-number answer for a monthly plan: when 30% and when $0, or the never-pays flag. */
function PlanAnswer({ plan, payment, hasLimit }: { plan: MonthlyPlan; payment: number; hasLimit: boolean }) {
  if (plan.neverPays && !plan.hit0)
    return (
      <div className="mb-po-flag">
        <b>Never pays off.</b> {usd(payment)} a month doesn’t beat the {usd(plan.firstCost)} of interest and fees it adds each month, so the balance never goes down.
        {plan.hit30 && plan.hit30.n === 0 ? ' (It’s already under 30% used.)' : ''}
      </div>
    );
  return (
    <div className="mb-po-ans">
      <span>
        <small>30% used</small>
        <b>{!hasLimit ? '—' : plan.hit30 ? (plan.hit30.n === 0 ? 'Already' : monthYear(plan.hit30.date)) : 'Not reached'}</b>
        <small>{hasLimit && plan.hit30 && plan.hit30.n > 0 ? `${span(plan.hit30.n)} · ${longDay(plan.hit30.date)}` : !hasLimit ? 'no limit known' : ''}</small>
      </span>
      <span>
        <small>Paid off ($0)</small>
        <b className="mb-ok">{plan.hit0 ? monthYear(plan.hit0.date) : '—'}</b>
        <small>{plan.hit0 ? `${span(plan.hit0.n)} · ${longDay(plan.hit0.date)}` : ''}</small>
      </span>
      <span>
        <small>Interest + fees paid</small>
        <b className="mb-late">{usd(plan.totalInterest + plan.totalFees)}</b>
        <small>{usd(plan.totalPaid)} paid in all</small>
      </span>
    </div>
  );
}

type Tab = 'a' | 'b' | 'c';

const nextFirst = (from: Date) => new Date(from.getFullYear(), from.getMonth() + 1, 1);

export function CardPayoff({ c, m, paid }: { c: CardRow; m?: MetaEntry; paid: boolean }) {
  const [tab, setTab] = useState<Tab>('a');
  const input = cardInput(c);
  const cost = monthlyCost(input);
  const min = cardMin(c, m);
  const first = firstPayDate(c, paid);
  const hasLimit = !!c.limit;
  const feeMissing = c.fee === undefined && FEE_CARD_NAMES.test(c.name);

  const [payX, setPayX] = useState<string>(m?.payX !== undefined ? String(m.payX) : '');
  const [plan, setPlan] = useState<PlannedPayment[]>(m?.payPlan || []);
  const [target, setTarget] = useState<string>(m?.payTarget || ymd(nextFirst(new Date())));
  const keep = (patch: Partial<Omit<MetaEntry, 'at'>>) => setMeta(c.key, patch);
  const savePlan = (next: PlannedPayment[]) => {
    setPlan(next);
    keep({ payPlan: next.length ? next : undefined });
  };

  const a = min ? payMonthly(input, min, first) : undefined;
  const xNum = Number(payX);
  const b = xNum > 0 ? payMonthly(input, xNum, first) : undefined;
  const in12 = input.bal > 0 ? paymentToClear(input, 12, first) : 0;
  const cRes = payByDate(input, plan, new Date(), fromYmd(target));

  if (!c.bal || c.bal <= 0)
    return (
      <>
        <h4 className="mb-cp-h">Payoff</h4>
        <p className="mb-dim">Nothing owed on this card — no carrying cost.</p>
      </>
    );

  return (
    <section className="mb-po">
      <h4 className="mb-cp-h">Carrying cost &amp; payoff</h4>
      <div className="mb-po-now">
        <span className="is-lead">
          <small>costs you each month now</small>
          <b className="mb-late">{usd(cost.total)}</b>
          <small>
            {usd(cost.interest)} interest{c.apr !== undefined ? ` at ${c.apr}% APR` : ''}
            {cost.fee ? ` + ${usd(cost.fee)} fee` : ''}
          </small>
        </span>
        <span>
          <small>minimum only</small>
          <b className={a?.neverPays ? 'mb-late' : ''}>{!min ? '—' : a?.neverPays ? 'Never' : a?.hit0 ? monthYear(a.hit0.date) : '—'}</b>
          <small>{!min ? 'no minimum known' : a?.neverPays ? `${usd(min)} ≤ ${usd(a.firstCost)} interest + fees` : a?.hit0 ? `paid off in ${span(a.hit0.n)}` : ''}</small>
        </span>
        <span>
          <small>to clear in 12 months</small>
          <b>{usd(in12)}/mo</b>
          <small>first payment {longDay(ymd(first))}</small>
        </span>
      </div>
      {c.apr === undefined ? <p className="mb-po-flag">No APR typed yet, so these numbers count no interest. Type it under “Yours to edit”.</p> : null}
      {feeMissing ? <p className="mb-po-flag">This card charges a monthly fee — type it under “Yours to edit” so it’s counted.</p> : null}

      <div className="skm-subtabs mb-po-tabs" role="tablist" aria-label="Payoff models">
        {([['a', 'A · Minimum only'], ['b', 'B · Fixed payment'], ['c', 'C · By date']] as Array<[Tab, string]>).map(([id, text]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`skm-subtab${tab === id ? ' is-on' : ''}`} onClick={() => setTab(id)}>
            <span className="skm-subtab-l">{text}</span>
          </button>
        ))}
      </div>
      <p className="mb-dim mb-po-how">
        {tab === 'c'
          ? 'Interest accrues daily (balance × APR ÷ 365) and posts on the 1st of each month and on the target date; the fee posts on the 1st. No new purchases.'
          : 'Each month: interest (balance × APR ÷ 12) + fee − payment, starting on the next payment date. No new purchases.'}
      </p>

      {tab === 'a' ? (
        !min ? (
          <p className="mny-empty">No minimum payment known for this card. Set one under “Due date” or the card details.</p>
        ) : a ? (
          <>
            <p className="mb-po-lead">Paying the {usd(min)} minimum every month:</p>
            <PlanAnswer plan={a} payment={min} hasLimit={hasLimit} />
            <Fold title="Month by month" meta={`${a.rows.length} months${a.neverPays && !a.hit0 ? ' shown' : ''}`}>
              <MonthTable rows={a.rows} />
            </Fold>
          </>
        ) : null
      ) : null}

      {tab === 'b' ? (
        <>
          <div className="mb-cp-edit mb-po-inputs">
            <label>
              Pay each month $
              <input type="number" step="1" min={0} inputMode="decimal" placeholder={min ? String(Math.ceil(min * 2)) : '100'} value={payX} onChange={e => setPayX(e.target.value)} onBlur={() => keep({ payX: payX.trim() === '' ? undefined : Number(payX) })} />
            </label>
            <span className="mb-dim">
              {min ? `Minimum ${usd(min)} · ` : ''}
              {usd(in12)}/mo clears it in 12 months
            </span>
          </div>
          {b ? (
            <>
              <PlanAnswer plan={b} payment={xNum} hasLimit={hasLimit} />
              {a?.hit0 && b.hit0 && a.hit0.n > b.hit0.n ? (
                <p className="mb-dim">
                  vs. minimum only: {span(a.hit0.n - b.hit0.n)} sooner and {usd(a.totalInterest + a.totalFees - b.totalInterest - b.totalFees)} less interest + fees.
                </p>
              ) : null}
              <Fold title="Month by month" meta={`${b.rows.length} months`}>
                <MonthTable rows={b.rows} />
              </Fold>
            </>
          ) : (
            <p className="mny-empty">Type a monthly amount to see when it hits 30% and $0.</p>
          )}
        </>
      ) : null}

      {tab === 'c' ? (
        <>
          <div className="mb-po-plan">
            {plan.map((p, i) => (
              <div key={i} className="mb-po-pay">
                <input type="date" aria-label="Payment date" value={p.date} onChange={e => savePlan(plan.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
                <label>
                  $
                  <input type="number" step="0.01" min={0} inputMode="decimal" aria-label="Payment amount" value={p.amount || ''} onChange={e => setPlan(plan.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)))} onBlur={() => savePlan(plan)} />
                </label>
                <button type="button" className="sk-btn is-small is-icon" aria-label="Remove payment" onClick={() => savePlan(plan.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="sk-btn is-small" onClick={() => savePlan([...plan, { date: plan.length ? plan[plan.length - 1].date : ymd(new Date()), amount: 0 }])}>
              + Add payment
            </button>
          </div>
          <div className="mb-cp-edit mb-po-inputs">
            <label>
              Target date
              <input type="date" value={target} onChange={e => { if (e.target.value) { setTarget(e.target.value); keep({ payTarget: e.target.value }); } }} />
            </label>
          </div>
          <p className="mb-po-lead">On {longDay(cRes.target)}, after {usd(cRes.paid)} in payments:</p>
          <div className="mb-po-ans">
            <span>
              <small>balance</small>
              <b>{usd(cRes.balance)}</b>
              <small>from {usd(input.bal)} today</small>
            </span>
            <span>
              <small>available</small>
              <b>{usd(cRes.avail)}</b>
              <small>{hasLimit ? `of ${usd(c.limit)}` : 'no limit known'}</small>
            </span>
            <span>
              <small>used</small>
              <b className={cRes.util !== undefined && cRes.util > 30 ? 'mb-late' : 'mb-ok'}>{pct(cRes.util)}</b>
              <small>{cRes.util === undefined ? '' : cRes.util <= 30 ? 'at or under 30%' : 'over 30%'}</small>
            </span>
            <span>
              <small>carrying cost then</small>
              <b className="mb-late">{usd(cRes.carry.total)}/mo</b>
              <small>{usd(cRes.interest + cRes.fees)} interest + fees until then</small>
            </span>
          </div>
          {cRes.overpaid > 0 ? <p className="mb-dim">{usd(cRes.overpaid)} more than you owe — it would sit as a credit.</p> : null}
          {cRes.skipped.length ? <p className="mb-po-flag">{cRes.skipped.length} payment{cRes.skipped.length > 1 ? 's' : ''} dated before today or after the target date {cRes.skipped.length > 1 ? 'are' : 'is'} left out.</p> : null}
          {cRes.events.length ? (
            <Fold title="Day by day" meta={`${cRes.events.length} entries`}>
              <div className="mb-scroll">
                <table className="mb-table mb-po-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>What</th>
                      <th className="num">Amount</th>
                      <th className="num">Balance after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cRes.events.map((e, i) => (
                      <tr key={i}>
                        <td>{longDay(e.date)}</td>
                        <td>{e.kind === 'pay' ? 'Payment' : e.kind === 'fee' ? 'Monthly fee' : 'Interest posted'}</td>
                        <td className={`num${e.kind === 'pay' ? ' mb-ok' : ''}`}>{e.kind === 'pay' ? '−' : '+'}{usd(e.amount)}</td>
                        <td className="num">{usd(e.bal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Fold>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
