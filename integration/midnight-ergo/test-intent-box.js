'use strict';
/* Offline tests for intent-box.js — Phase 1 step 1 (commitment + box plan).
 * Commitment vectors are pinned by an independent Python oracle
 * (hashlib.blake2b over the canonical v1 preimage), not by this code. */
const assert = require('node:assert');
const ib = require('./intent-box');

let pass = 0;
function ok(name, cond) {
  if (!cond) throw new Error('FAIL: ' + name);
  pass += 1;
  console.log('PASS', name);
}
function throws(name, fn, needle) {
  try {
    fn();
  } catch (e) {
    ok(name, String(e.message).includes(needle));
    return;
  }
  throw new Error('FAIL (did not throw): ' + name);
}

const KYLE_ERG = '9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy';
const MN_ADDR = 'mn_addr_test1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0s6vexr4';
const MN_DUST = 'mn_dust14w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w4suxv3rz';
const NONCE_A = '00'.repeat(31) + '01';

/* Blake2b sanity: the RFC/Python empty-input vector */
ok('blake2b256 empty vector', Buffer.from(ib.blake2b256(new Uint8Array(0))).toString('hex') ===
  '0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8');

/* Oracle-pinned commitment vectors */
ok('commitment MAIN (oracle)', ib.computeCommitment({ midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: NONCE_A }) ===
  '110d27f631cda9223e7e645058cab0b7a0206f2e708ec9f8311fa8b8a8bec29e');
ok('commitment dust address, amount 1 (oracle)', ib.computeCommitment({ midnightRecipient: MN_DUST, amountNanoErg: 1n, nonceHex: 'ff'.repeat(32) }) ===
  '22fcb8fe05d177419a450c2dc561cae69b30e065c616f93bbecb4ec2dd8c1b24');
ok('commitment exact beyond float53 (oracle)', ib.computeCommitment({ midnightRecipient: MN_ADDR, amountNanoErg: 9007199254740993n, nonceHex: '0123456789abcdef'.repeat(4) }) ===
  '3eeb997e3a1ffeaeb7fefb55a0c69c911308f7f39aeaf92559d09255476f7af8');
ok('commitment u64 max (oracle)', ib.computeCommitment({ midnightRecipient: MN_ADDR, amountNanoErg: (1n << 64n) - 1n, nonceHex: '00'.repeat(32) }) ===
  'b37bf28a59be286317f22bb6f12181b4873edebfd0bcc489a9db1a8898222893');

/* Preimage structure: domain || u32be len || recipient || u64be amount || nonce */
ok('preimage layout', (() => {
  const pre = ib.commitmentPreimage({ midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: NONCE_A });
  const dv = new DataView(pre.buffer, pre.byteOffset, pre.byteLength);
  return Buffer.from(pre.subarray(0, 4)).toString('ascii') === 'EMI1' &&
    dv.getUint32(4, false) === MN_ADDR.length &&
    Buffer.from(pre.subarray(8, 8 + MN_ADDR.length)).toString('ascii') === MN_ADDR &&
    dv.getBigUint64(8 + MN_ADDR.length, false) === 2000000000n &&
    pre.length === 8 + MN_ADDR.length + 8 + 32;
})());

/* Binding: every field changes the commitment */
const base = ib.computeCommitment({ midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: NONCE_A });
ok('commitment binds amount', ib.computeCommitment({ midnightRecipient: MN_ADDR, amountNanoErg: 2000000001n, nonceHex: NONCE_A }) !== base);
ok('commitment binds nonce', ib.computeCommitment({ midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: '00'.repeat(31) + '02' }) !== base);
ok('commitment binds recipient', ib.computeCommitment({ midnightRecipient: MN_DUST, amountNanoErg: 2000000000n, nonceHex: NONCE_A }) !== base);

/* verifyCommitment */
ok('verify accepts the real tuple', ib.verifyCommitment(base, { midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: NONCE_A }) === true);
ok('verify rejects a tampered amount', ib.verifyCommitment(base, { midnightRecipient: MN_ADDR, amountNanoErg: 1n, nonceHex: NONCE_A }) === false);
ok('verify rejects garbage commitment', ib.verifyCommitment('zz', { midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: NONCE_A }) === false);
ok('verify rejects invalid fields instead of throwing', ib.verifyCommitment(base, { midnightRecipient: KYLE_ERG, amountNanoErg: 2000000000n, nonceHex: NONCE_A }) === false);

/* Field validation */
throws('refuses a non-Midnight recipient', () => ib.computeCommitment({ midnightRecipient: KYLE_ERG, amountNanoErg: 1n, nonceHex: NONCE_A }), 'Bech32m');
throws('refuses zero amount', () => ib.computeCommitment({ midnightRecipient: MN_ADDR, amountNanoErg: 0n, nonceHex: NONCE_A }), 'positive');
throws('refuses amount above u64', () => ib.computeCommitment({ midnightRecipient: MN_ADDR, amountNanoErg: 1n << 64n, nonceHex: NONCE_A }), 'u64');
throws('refuses float amount', () => ib.computeCommitment({ midnightRecipient: MN_ADDR, amountNanoErg: 1.5, nonceHex: NONCE_A }), 'safe integer');
throws('refuses short nonce', () => ib.computeCommitment({ midnightRecipient: MN_ADDR, amountNanoErg: 1n, nonceHex: 'abcd' }), '32 bytes');

/* Box plan */
const plan = ib.buildIntentBoxPlan({
  network: 'testnet', ergoSender: KYLE_ERG, midnightRecipient: MN_ADDR,
  amountNanoErg: 2000000000n, nonceHex: NONCE_A, creationHeight: 1000, timeoutHeight: 2000,
});
ok('plan is labelled a plan, not a live box', plan.status === 'plan' && plan.phase === 1);
ok('plan value is the amount as a string', plan.valueNanoErg === '2000000000');
ok('plan commitment matches computeCommitment', plan.commitment === base);
ok('plan R4 serialized as 0e20 + commitment', plan.registers.R4.serializedValue === '0e20' + base);
ok('plan R5 carries the timeout', plan.registers.R5.value === 2000);
ok('plan guard is labelled draft/not compiled', plan.guard.status === 'draft-source-not-compiled');
throws('plan refuses mainnet', () => ib.buildIntentBoxPlan({
  network: 'mainnet', ergoSender: KYLE_ERG, midnightRecipient: MN_ADDR,
  amountNanoErg: 1n, nonceHex: NONCE_A, creationHeight: 1, timeoutHeight: 2,
}), 'testnet-only');
throws('plan refuses timeout at creation height', () => ib.buildIntentBoxPlan({
  network: 'testnet', ergoSender: KYLE_ERG, midnightRecipient: MN_ADDR,
  amountNanoErg: 1n, nonceHex: NONCE_A, creationHeight: 100, timeoutHeight: 100,
}), 'after creationHeight');
throws('plan refuses bad sender', () => ib.buildIntentBoxPlan({
  network: 'testnet', ergoSender: 'nope', midnightRecipient: MN_ADDR,
  amountNanoErg: 1n, nonceHex: NONCE_A, creationHeight: 1, timeoutHeight: 2,
}), 'Ergo address');

/* Height rules */
ok('refund not eligible inside the window', ib.refundEligible(plan, 1999) === false);
ok('refund eligible at the timeout height', ib.refundEligible(plan, 2000) === true);
ok('settlement window open before timeout', ib.settlementWindowOpen(plan, 1999) === true);
ok('settlement window closed at timeout', ib.settlementWindowOpen(plan, 2000) === false);
ok('window helpers decline a missing plan instead of crashing', ib.settlementWindowOpen(null, 1500) === false &&
  ib.settlementWindowOpen(undefined, 1500) === false &&
  ib.refundEligible(null, 1500) === false && ib.refundEligible(undefined, 1500) === false);
ok('window helpers judge a non-number timeout by value, never by coercion',
  ib.settlementWindowOpen({ timeoutHeight: '2000' }, 1500) === false &&
  ib.settlementWindowOpen({ timeoutHeight: Infinity }, 1500) === false &&
  ib.refundEligible({ timeoutHeight: Infinity }, 1500) === false &&
  ib.settlementWindowOpen({ timeoutHeight: 1500.5 }, 1500) === false &&
  ib.settlementWindowOpen({ timeoutHeight: { valueOf() { throw new Error('hostile'); } } }, 1500) === false &&
  ib.refundEligible({ timeoutHeight: { valueOf() { throw new Error('hostile'); } } }, 1500) === false);
ok('window helpers keep a negative safe-integer timeout judged as before',
  ib.settlementWindowOpen({ timeoutHeight: -5 }, 0) === false && ib.refundEligible({ timeoutHeight: -5 }, 0) === true);

/* Watcher inspection against explorer-shaped boxes */
const goodBox = { boxId: 'a'.repeat(64), value: 2000000000, additionalRegisters: { R4: { serializedValue: '0e20' + base } } };
ok('watcher accepts a box carrying the plan', ib.inspectIntentBox(goodBox, plan).matches === true);
const shortBox = { value: 1999999999, additionalRegisters: { R4: { serializedValue: '0e20' + base } } };
ok('watcher rejects an underfunded box', ib.inspectIntentBox(shortBox, plan).matches === false &&
  ib.inspectIntentBox(shortBox, plan).checks.valueCovers === false);
const wrongCommitmentBox = { value: 2000000000, additionalRegisters: { R4: { serializedValue: '0e20' + '00'.repeat(32) } } };
ok('watcher rejects a wrong commitment', ib.inspectIntentBox(wrongCommitmentBox, plan).matches === false &&
  ib.inspectIntentBox(wrongCommitmentBox, plan).checks.commitmentRegister === false);
ok('watcher rejects a shapeless box', ib.inspectIntentBox({ value: 2000000000 }, plan).matches === false);
/* A plan that names no commitment register is a plan no box can
 * match — judged, never crashed on: the settler admits a plan by its
 * commitment alone, so a registers-stripped plan (or none) reached
 * the inspection admitted and died there on plan.registers.R4. */
const strippedPlan = { commitment: plan.commitment, timeoutHeight: 2000, network: 'testnet' };
ok('watcher declines a registers-stripped plan instead of throwing', (() => {
  const r = ib.inspectIntentBox(goodBox, strippedPlan);
  return r.matches === false && r.checks.shape === true &&
    r.checks.commitmentRegister === false && r.checks.valueCovers === false;
})());
ok('watcher declines a missing plan instead of throwing',
  ib.inspectIntentBox(goodBox, null).matches === false &&
  ib.inspectIntentBox(goodBox, undefined).matches === false);
ok('watcher declines a plan whose R4 names no serialized value',
  ib.inspectIntentBox(goodBox, { ...plan, registers: {} }).matches === false &&
  ib.inspectIntentBox(goodBox, { ...plan, registers: { R4: {} } }).matches === false &&
  ib.inspectIntentBox(goodBox, { ...plan, registers: { R4: { serializedValue: 42 } } }).matches === false);
ok('watcher tolerates string values from the explorer', ib.inspectIntentBox(
  { value: '2000000000', additionalRegisters: { R4: { serializedValue: '0e20' + base } } }, plan).matches === true);

/* Bounds: the value comparison never parses an unbounded string.
 * A hostile box (or plan) value is judged by its significant digits:
 * 21 digits already exceed every u64 plan, leading zeros are skipped
 * within the scan bound, and only the significant digits are parsed. */
ok('watcher accepts a box whose huge digit-string value covers the plan, judged by magnitude', ib.inspectIntentBox(
  { value: '9'.repeat(100000), additionalRegisters: { R4: { serializedValue: '0e20' + base } } }, plan).checks.valueCovers === true);
ok('watcher rejects a huge leading-zero string whose significant value is small', ib.inspectIntentBox(
  { value: '0'.repeat(1000) + '5', additionalRegisters: { R4: { serializedValue: '0e20' + base } } }, plan).checks.valueCovers === false);
ok('watcher accepts a leading-zero string whose significant value covers exactly', ib.inspectIntentBox(
  { value: '0'.repeat(1000) + '2000000000', additionalRegisters: { R4: { serializedValue: '0e20' + base } } }, plan).checks.valueCovers === true);
ok('watcher declines a value string of zeros beyond the scan bound instead of parsing it', ib.inspectIntentBox(
  { value: '0'.repeat(ib.MAX_VALUE_SCAN + 1) + '9'.repeat(25), additionalRegisters: { R4: { serializedValue: '0e20' + base } } }, plan).checks.valueCovers === false);
ok('watcher declines a huge plan value instead of parsing it', ib.inspectIntentBox(
  goodBox, { ...plan, valueNanoErg: '9'.repeat(100000) }).checks.valueCovers === false);
ok('watcher declines a long non-decimal box value', ib.inspectIntentBox(
  { value: 'x'.repeat(100), additionalRegisters: { R4: { serializedValue: '0e20' + base } } }, plan).checks.valueCovers === false);
ok('watcher declines a long value whose garbage follows 21 significant digits', ib.inspectIntentBox(
  { value: '9'.repeat(21) + 'x'.repeat(50), additionalRegisters: { R4: { serializedValue: '0e20' + base } } }, plan).checks.valueCovers === false &&
  ib.boxValueCovers('9'.repeat(21) + '.5' + '0'.repeat(30), '10') === false &&
  ib.boxValueCovers('0'.repeat(50) + '9'.repeat(21) + 'x'.repeat(10), '10') === false);
ok('watcher still accepts a long value whose digits continue past 21', ib.inspectIntentBox(
  { value: '9'.repeat(21) + '5'.repeat(50000), additionalRegisters: { R4: { serializedValue: '0e20' + base } } }, plan).checks.valueCovers === true);
ok('short native value forms are unchanged (hex string, negative, exact)', ib.boxValueCovers('0x10', '10') === true &&
  ib.boxValueCovers('-5', '10') === false && ib.boxValueCovers('2000000000', '2000000000') === true);

console.log('ALL PASS (' + pass + ' checks)');
