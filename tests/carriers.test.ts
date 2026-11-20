import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carrierEnabled, detectCarrier, type CarrierEnv } from '../worker/carriers';

test('detects the carrier from real Packages numbers', () => {
  assert.equal(detectCarrier('9400136208122664003564'), 'usps');
  assert.equal(detectCarrier('9434 6362 0812 2529 5855 41'), 'usps');
  assert.equal(detectCarrier('EA123456789US'), 'usps');
  assert.equal(detectCarrier('1Z2K159X0241280882'), 'ups');
  assert.equal(detectCarrier('1z2y55899096782546'), 'ups');
  assert.equal(detectCarrier('771234567890'), 'fedex');
  assert.equal(detectCarrier('9612345678901234567890'), 'fedex');
  assert.equal(detectCarrier('SPXMTN126910688658'), undefined);
});

test('a carrier is used only when both secrets are set', () => {
  const env = { USPS_CLIENT_ID: 'a', USPS_CLIENT_SECRET: 'b', FEDEX_CLIENT_ID: 'c' } as unknown as CarrierEnv;
  assert.equal(carrierEnabled(env, 'usps'), true);
  assert.equal(carrierEnabled(env, 'fedex'), false);
  assert.equal(carrierEnabled(env, 'ups'), false);
});
