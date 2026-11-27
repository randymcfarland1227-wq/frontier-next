import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellId, colName, evaluateSheet, parseRef, sheetOf, shown, toNumber, SheetError } from '../lib/sheetFormula';

const calc = (cells: Record<string, string>, id: string) => {
  const v = evaluateSheet(cells)[id];
  return v instanceof SheetError ? v.code : v;
};

test('column letters and refs round-trip', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  assert.equal(cellId(4, 27), 'AB5');
  assert.deepEqual(parseRef('$AB$5'), { r: 4, c: 27 });
});

test('money-style numbers count as numbers', () => {
  assert.equal(toNumber('$1,234.50'), 1234.5);
  assert.equal(toNumber('-$12'), -12);
  assert.equal(toNumber('5%'), 0.05);
  assert.equal(toNumber('rent'), null);
  assert.equal(toNumber('1,23'), null);
});

test('arithmetic, precedence, parentheses and refs', () => {
  const cells = { A1: '10', A2: '$5.25', A3: '=A1+A2*2', A4: '=(A1+A2)*2', A5: '=-A1^2', A6: '=A1/4', A7: '=50%*A1' };
  assert.equal(calc(cells, 'A3'), 20.5);
  assert.equal(calc(cells, 'A4'), 30.5);
  assert.equal(calc(cells, 'A5'), 100);
  assert.equal(calc(cells, 'A6'), 2.5);
  assert.equal(calc(cells, 'A7'), 5);
});

test('SUM / AVERAGE / MIN / MAX / COUNT over ranges skip text and blanks', () => {
  const cells = { A1: '100', A2: 'rent', A3: '$50', B1: '25', C1: '=SUM(A1:B3)', C2: '=AVERAGE(A1:A5)', C3: '=MIN(A1:B1, 7)', C4: '=MAX(A1:B3)', C5: '=COUNT(A1:B3)', C6: '=avg(A1,A3)' };
  assert.equal(calc(cells, 'C1'), 175);
  assert.equal(calc(cells, 'C2'), 75);
  assert.equal(calc(cells, 'C3'), 7);
  assert.equal(calc(cells, 'C4'), 100);
  assert.equal(calc(cells, 'C5'), 3);
  assert.equal(calc(cells, 'C6'), 75);
});

test('ROUND, IF, comparisons and & join', () => {
  const cells = { A1: '1200', A2: '=ROUND(A1/7, 2)', A3: '=IF(A1>1000, "over", "ok")', A4: '="Left: "&A1' };
  assert.equal(calc(cells, 'A2'), 171.43);
  assert.equal(calc(cells, 'A3'), 'over');
  assert.equal(calc(cells, 'A4'), 'Left: 1,200');
});

test('errors: divide by zero, text in math, unknown function, bad syntax, cycles', () => {
  const cells = { A1: 'x', B1: '=1/0', B2: '=A1*2', B3: '=FOO(1)', B4: '=1+', B5: '=B6', B6: '=B5+1', B7: '=B1+1' };
  assert.equal(calc(cells, 'B1'), '#DIV/0');
  assert.equal(calc(cells, 'B2'), '#VALUE');
  assert.equal(calc(cells, 'B3'), '#NAME');
  assert.equal(calc(cells, 'B4'), '#ERR');
  assert.equal(calc(cells, 'B5'), '#CYCLE');
  assert.equal(calc(cells, 'B7'), '#DIV/0');
});

test('display: typed text stays as typed, results are formatted', () => {
  const v = evaluateSheet({ A1: '$1,000', A2: '=A1/3', A3: '=A1*2' });
  assert.equal(shown('$1,000', v.A1), '$1,000');
  assert.equal(shown('=A1/3', v.A2), '333.33');
  assert.equal(shown('=A1*2', v.A3), '2,000');
});

test('old worksheets without a sheet, or junk, load as a blank 10×20 grid', () => {
  assert.deepEqual(sheetOf(undefined), { cols: 10, rows: 20, cells: {} });
  assert.deepEqual(sheetOf({ cells: { A1: '1', bad: 'x', B2: 5 }, rows: 3 }), { cols: 10, rows: 3, cells: { A1: '1' } });
});

test('column widths survive a reload and junk widths are dropped or clamped', () => {
  assert.deepEqual(sheetOf({ cells: {}, widths: { 0: 180, 1: 5, 2: 9999, x: 50, 3: 'wide' } }).widths, { 0: 180, 1: 36, 2: 600 });
  assert.equal(sheetOf({ cells: {} }).widths, undefined);
});

test('cell formats load cleanly; bad colors and keys are dropped', () => {
  const s = sheetOf({ cells: {}, fmt: { A1: { b: true, bg: '#fff3a3', al: 'right' }, B2: { fg: 'red', i: 'yes' }, junk: { b: true } } });
  assert.deepEqual(s.fmt, { A1: { b: true, bg: '#fff3a3', al: 'right' } });
});
