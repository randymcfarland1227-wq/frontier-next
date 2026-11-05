import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeUrl, linkLabel, fileKind, formatSize, docTag, sortRefs, type FocusRef } from '../lib/focusRefs';

test('normalizeUrl adds https and rejects non-links', () => {
  assert.equal(normalizeUrl('mdcourts.gov/district'), 'https://mdcourts.gov/district');
  assert.equal(normalizeUrl(' https://a.com/x?y=1 '), 'https://a.com/x?y=1');
  assert.equal(normalizeUrl('hello there'), null);
  assert.equal(normalizeUrl('notalink'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
});

test('linkLabel is host plus first path part', () => {
  assert.equal(linkLabel('https://www.mdcourts.gov/district/traffic'), 'mdcourts.gov/district');
  assert.equal(linkLabel('https://docs.google.com'), 'docs.google.com');
});

test('fileKind, docTag, formatSize', () => {
  assert.equal(fileKind('image/jpeg', 'a.jpg'), 'image');
  assert.equal(fileKind('', 'IMG_1.PNG'), 'image');
  assert.equal(fileKind('application/pdf', 'ticket.pdf'), 'doc');
  assert.equal(docTag('ticket.pdf'), 'PDF');
  assert.equal(docTag('scan', 'application/pdf'), 'PDF');
  assert.equal(formatSize(2048), '2 KB');
  assert.equal(formatSize(2_621_440), '2.5 MB');
});

test('sortRefs: links, images, docs; newest first', () => {
  const r = (id: string, kind: FocusRef['kind'], at: string): FocusRef => ({ id, kind, title: id, at });
  const out = sortRefs([r('d', 'doc', '2'), r('l1', 'link', '1'), r('i', 'image', '1'), r('l2', 'link', '3')]);
  assert.deepEqual(out.map((x) => x.id), ['l2', 'l1', 'i', 'd']);
});
