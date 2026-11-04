import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addMonths, fromYmd, monthlyCost, payByDate, payMonthly, paymentToClear, ymd } from '../lib/cardProjection';

test('carrying cost now = balance × APR / 12 plus the monthly fee', () => {
  assert.deepEqual(monthlyCost({ bal: 1200, apr: 24, fee: 10 }), { interest: 24, fee: 10, total: 34 });
  assert.deepEqual(monthlyCost({ bal: 500 }), { interest: 0, fee: 0, total: 0 });
});

test('fixed payment: month-by-month balance, 30% and $0 months', () => {
  const r = payMonthly({ bal: 1000, apr: 12, limit: 2000 }, 300, fromYmd('2026-11-20'));
  assert.deepEqual(r.rows.map(x => [x.interest, x.payment, x.end]), [
    [10, 300, 710],
    [7.1, 300, 417.1],
    [4.17, 300, 121.27],
    [1.21, 122.48, 0],
  ]);
  assert.deepEqual(r.hit30, { n: 2, date: '2026-12-20' });
  assert.deepEqual(r.hit0, { n: 4, date: '2027-02-20' });
  assert.equal(r.rows[0].avail, 1290);
  assert.equal(r.totalInterest, 22.48);
  assert.equal(r.neverPays, false);
});

test('a minimum that only covers interest + fee never pays off', () => {
  const r = payMonthly({ bal: 1000, apr: 24, fee: 10, limit: 1500 }, 30, fromYmd('2026-11-20'));
  assert.equal(r.firstCost, 30);
  assert.equal(r.neverPays, true);
  assert.equal(r.hit0, undefined);
  assert.equal(r.rows.at(-1)!.end, 1000);
});

test('already at or under 30% counts as month 0', () => {
  const r = payMonthly({ bal: 200, apr: 20, limit: 1000 }, 50, fromYmd('2026-11-20'));
  assert.equal(r.hit30?.n, 0);
});

test('payment to clear in N months', () => {
  assert.equal(paymentToClear({ bal: 1200 }, 12, fromYmd('2026-11-20')), 100);
  const p = paymentToClear({ bal: 1000, apr: 12 }, 4, fromYmd('2026-11-20'));
  assert.ok(payMonthly({ bal: 1000, apr: 12 }, p, fromYmd('2026-11-20')).hit0!.n <= 4);
  assert.ok(!(payMonthly({ bal: 1000, apr: 12 }, p - 1, fromYmd('2026-11-20')).hit0!.n <= 4));
});

test('by date: daily interest posted on the 1st and on the target date', () => {
  const r = payByDate({ bal: 1000, apr: 36.5, limit: 2000 }, [{ date: '2026-11-30', amount: 500 }, { date: '2026-10-01', amount: 99 }], fromYmd('2026-11-29'), fromYmd('2026-12-02'));
  // 11-29: +1.00 accrues · 11-30: pay 500, +0.50 · 12-01: post 1.50, +0.5015 · 12-02: post 0.50
  assert.equal(r.balance, 502);
  assert.equal(r.interest, 2);
  assert.equal(r.paid, 500);
  assert.equal(r.avail, 1498);
  assert.equal(r.util, 25.1);
  assert.deepEqual(r.skipped, [{ date: '2026-10-01', amount: 99 }]);
  assert.deepEqual(r.carry, { interest: 15.27, fee: 0, total: 15.27 });
});

test('by date: fee each 1st, overpayment stops at $0', () => {
  const r = payByDate({ bal: 100, apr: 0, fee: 5 }, [{ date: '2026-12-10', amount: 150 }], fromYmd('2026-11-04'), fromYmd('2027-01-01'));
  assert.equal(r.fees, 10);
  assert.equal(r.balance, 5);
  assert.equal(r.overpaid, 45);
});

test('addMonths clamps to the end of short months', () => {
  assert.equal(ymd(addMonths(fromYmd('2027-01-31'), 1)), '2027-02-28');
});
