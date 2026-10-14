'use strict';
/* Offline tests for watcher.js — Phase 1 step 2 (observation + attestation).
 * Attestation-id vectors are pinned by an independent Python oracle
 * (hashlib.blake2b over the canonical v1 preimage), not by this code. */
const assert = require('node:assert');
const ib = require('./intent-box');
const w = require('./watcher');

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
const NONCE_A = '00'.repeat(31) + '01';
const BOX_A = 'aa'.repeat(32);
const BOX_B = '0123456789abcdef'.repeat(4);

const plan = ib.buildIntentBoxPlan({
  network: 'testnet', ergoSender: KYLE_ERG, midnightRecipient: MN_ADDR,
  amountNanoErg: 2000000000n, nonceHex: NONCE_A, creationHeight: 1000, timeoutHeight: 2000,
});
function goodBox(overrides = {}) {
  return {
    boxId: BOX_A, value: 2000000000, creationHeight: 1000, spentTransactionId: null,
    additionalRegisters: { R4: { serializedValue: '0e20' + plan.commitment } },
    ...overrides,
  };
}

/* Confirmation depth: the creating block itself counts as 1 */
ok('confirmations at the creating height is 1', w.confirmationsFor(goodBox(), 1000) === 1);
ok('confirmations accumulate with height', w.confirmationsFor(goodBox(), 1500) === 501);
ok('confirmations before creation is 0', w.confirmationsFor(goodBox(), 999) === 0);
ok('confirmations with missing height is 0', w.confirmationsFor({ creationHeight: 'x' }, 1500) === 0);

/* Oracle-pinned attestation ids */
ok('attestation id MAIN (oracle)', w.computeAttestationId({
  commitment: plan.commitment, boxId: BOX_A, observedHeight: 1500, confirmations: 501,
}) === 'fed644fac6e6ca21d9e9a3643192bb557851ef022e8bc695b3952251ef555d61');
ok('attestation id FIRSTCONF (oracle)', w.computeAttestationId({
  commitment: plan.commitment, boxId: BOX_A, observedHeight: 1000, confirmations: 1,
}) === '08fd6d5fbd0509e8aaf5c298da2fae87b50349859a02d9828bd8b5bfc3d45b57');
ok('attestation id OTHERBOX (oracle)', w.computeAttestationId({
  commitment: plan.commitment, boxId: BOX_B, observedHeight: 100, confirmations: 59,
}) === '6b44911be4e3b0f033472c8d2ca0856be2101174d2c85675c9335c8ebf7f5334');

/* Preimage layout: domain || commitment || boxId || u32be height || u32be confs */
ok('attestation preimage layout', (() => {
  const pre = w.attestationPreimage({ commitment: plan.commitment, boxId: BOX_A, observedHeight: 1500, confirmations: 501 });
  const dv = new DataView(pre.buffer, pre.byteOffset, pre.byteLength);
  return pre.length === 76 &&
    Buffer.from(pre.subarray(0, 4)).toString('ascii') === 'EMA1' &&
    Buffer.from(pre.subarray(4, 36)).toString('hex') === plan.commitment &&
    Buffer.from(pre.subarray(36, 68)).toString('hex') === BOX_A &&
    dv.getUint32(68, false) === 1500 && dv.getUint32(72, false) === 501;
})());

/* Every field binds the id */
const baseId = w.computeAttestationId({ commitment: plan.commitment, boxId: BOX_A, observedHeight: 1500, confirmations: 501 });
ok('attestation id binds height', w.computeAttestationId({ commitment: plan.commitment, boxId: BOX_A, observedHeight: 1501, confirmations: 501 }) !== baseId);
ok('attestation id binds confirmations', w.computeAttestationId({ commitment: plan.commitment, boxId: BOX_A, observedHeight: 1500, confirmations: 502 }) !== baseId);
ok('attestation id binds box', w.computeAttestationId({ commitment: plan.commitment, boxId: BOX_B, observedHeight: 1500, confirmations: 501 }) !== baseId);

/* Observation: the happy path and each single failure */
const obs = (over = {}, args = {}) => w.evaluateObservation({ box: goodBox(over), plan, currentHeight: 1500, ...args });
ok('observation attestable when deep, unspent, in window', obs().attestable === true && obs().confirmations === 501);
ok('observation refuses a spent box', obs({ spentTransactionId: 'bb'.repeat(32) }).attestable === false &&
  obs({ spentTransactionId: 'bb'.repeat(32) }).checks.unspent === false);
ok('observation refuses a shallow box', w.evaluateObservation({ box: goodBox(), plan, currentHeight: 1003 }).attestable === false &&
  w.evaluateObservation({ box: goodBox(), plan, currentHeight: 1003 }).checks.depthReached === false);
ok('observation attestable exactly at min depth', w.evaluateObservation({ box: goodBox(), plan, currentHeight: 1005 }).attestable === true);
ok('observation honours a custom min depth', w.evaluateObservation({ box: goodBox(), plan, currentHeight: 1005, minConfirmations: 10 }).checks.depthReached === false);
ok('observation refuses after the refund timeout', w.evaluateObservation({ box: goodBox(), plan, currentHeight: 2000 }).attestable === false &&
  w.evaluateObservation({ box: goodBox(), plan, currentHeight: 2000 }).checks.windowOpen === false);
ok('observation refuses a box not carrying the plan', obs({ additionalRegisters: { R4: { serializedValue: '0e20' + '00'.repeat(32) } } }).checks.boxMatchesPlan === false);
throws('observation refuses a zero min depth', () => w.evaluateObservation({ box: goodBox(), plan, currentHeight: 1500, minConfirmations: 0 }), 'positive integer');

/* Building attestations */
const att1 = w.buildAttestation({ watcherId: 'watcher-1', box: goodBox(), plan, currentHeight: 1500 });
ok('attestation is labelled an unsigned Phase 1 record', att1.status === 'unsigned-phase1-record' && att1.version === 1);
ok('attestation carries the oracle MAIN id', att1.attestationId === 'fed644fac6e6ca21d9e9a3643192bb557851ef022e8bc695b3952251ef555d61');
ok('attestation names plan commitment and box', att1.commitment === plan.commitment && att1.boxId === BOX_A && att1.confirmations === 501);
throws('attestation refuses a shallow box', () => w.buildAttestation({ watcherId: 'watcher-1', box: goodBox(), plan, currentHeight: 1002 }), 'depthReached');
throws('attestation refuses a spent box', () => w.buildAttestation({ watcherId: 'watcher-1', box: goodBox({ spentTransactionId: 'bb'.repeat(32) }), plan, currentHeight: 1500 }), 'unspent');
throws('attestation refuses an empty watcher id', () => w.buildAttestation({ watcherId: '', box: goodBox(), plan, currentHeight: 1500 }), 'watcherId');
/* The box id is judged from its length before it is lowercased for
 * the record: an oversize id reaches the preimage's named refusal
 * untouched (it was fully lowercased in full first), and a genuine
 * uppercase id still mints the pinned record, lowercased. */
throws('attestation refuses an oversize box id by name', () =>
  w.buildAttestation({ watcherId: 'watcher-1', box: goodBox({ boxId: 'ab'.repeat(100000) }), plan, currentHeight: 1500 }), 'boxId must be 32 bytes of hex');
ok('attestation from an uppercase box id mints the pinned record', (() => {
  const up = w.buildAttestation({ watcherId: 'watcher-1', box: goodBox({ boxId: BOX_A.toUpperCase() }), plan, currentHeight: 1500 });
  return up.boxId === BOX_A && up.attestationId === att1.attestationId;
})());

/* Verification detects tampering with any field */
ok('verify accepts a genuine attestation', w.verifyAttestation(att1) === true);
ok('verify rejects a tampered height', w.verifyAttestation({ ...att1, observedHeight: 1501 }) === false);
/* Honest limitation, pinned on purpose: the id binds the OBSERVATION
 * (commitment, box, height, depth), not the watcher — records are
 * unsigned in Phase 1, so swapping watcherId still verifies. Identity
 * binding is the Phase 2 signature layer; this test exists so nobody
 * mistakes the record for a signed attestation. */
ok('verify does NOT bind watcherId (unsigned Phase 1 record, pinned)', w.verifyAttestation({ ...att1, watcherId: 'watcher-9' }) === true);
ok('verify rejects a tampered confirmation count', w.verifyAttestation({ ...att1, confirmations: 999 }) === false);
ok('verify rejects garbage', w.verifyAttestation({ version: 1, watcherId: 'w', attestationId: 'zz' }) === false && w.verifyAttestation(null) === false);

/* Quorum collection */
const att2 = w.buildAttestation({ watcherId: 'watcher-2', box: goodBox(), plan, currentHeight: 1501 });
const att3 = w.buildAttestation({ watcherId: 'watcher-3', box: goodBox(), plan, currentHeight: 1502 });
const q = (list, over = {}) => w.collectAttestations(list, { quorum: 2, commitment: plan.commitment, boxId: BOX_A, ...over });
ok('quorum reached by two distinct watchers', q([att1, att2]).quorumReached === true && q([att1, att2]).distinctWatchers === 2);
ok('quorum not reached by one watcher', q([att1]).quorumReached === false);
ok('a duplicate watcher counts once and is reported', (() => {
  const r = q([att1, att1, att2]);
  return r.distinctWatchers === 2 && r.duplicates.length === 1 && r.duplicates[0] === 'watcher-1';
})());
ok('a tampered attestation is excluded and reported', (() => {
  const r = q([att1, { ...att2, confirmations: 1 }]);
  return r.distinctWatchers === 1 && r.invalid.length === 1 && r.quorumReached === false;
})());
ok('an attestation for another box is excluded and reported', (() => {
  const other = w.buildAttestation({ watcherId: 'watcher-2', box: goodBox({ boxId: BOX_B }), plan, currentHeight: 1500 });
  const r = q([att1, other]);
  return r.distinctWatchers === 1 && r.invalid.length === 1;
})());
ok('expected commitment mismatch excludes everything', (() => {
  const r = w.collectAttestations([att1, att2], { quorum: 2, commitment: '00'.repeat(32), boxId: BOX_A });
  return r.distinctWatchers === 0 && r.invalid.length === 2 && r.quorumReached === false;
})());
ok('quorum of three reached by three watchers', q([att1, att2, att3], { quorum: 3 }).quorumReached === true);
throws('quorum refuses a zero quorum', () => w.collectAttestations([], { quorum: 0 }), 'positive integer');

/* Bounds: the attestation list is untrusted input — the same 10,000-entry
 * bound audit.js imposes on it applies here, at the layer every caller
 * (settlement, audit, direct) funnels through. Over the bound refuses
 * before a single record is hashed; at the bound the scan still runs. */
ok('attestation bound is the audit bound', w.MAX_ATTESTATIONS === 10000);
throws('quorum collection refuses an oversize attestation list', () =>
  w.collectAttestations(new Array(w.MAX_ATTESTATIONS + 1).fill(null), { quorum: 2 }), 'bound');
ok('quorum collection still scans a list at the bound', (() => {
  const r = w.collectAttestations(new Array(w.MAX_ATTESTATIONS).fill(null), { quorum: 2 });
  return r.distinctWatchers === 0 && r.invalid.length === w.MAX_ATTESTATIONS && r.quorumReached === false;
})());

/* Bounds: a record's id is judged from its length before it is
 * lowercased for the comparison — an oversize or non-string id can
 * never match the recomputed 64-char id and is never copied in full. */
ok('verifyAttestation refuses an oversize attestation id from its length',
  w.verifyAttestation({ ...att1, attestationId: 'a'.repeat(1000000) }) === false);
ok('verifyAttestation refuses a non-string attestation id',
  w.verifyAttestation({ ...att1, attestationId: 42 }) === false);
ok('verifyAttestation still accepts the genuine record',
  w.verifyAttestation(att1) === true);

console.log('ALL PASS (' + pass + ' checks)');
