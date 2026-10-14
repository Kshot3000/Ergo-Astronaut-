'use strict';
/* Offline tests for claim.js — Phase 1 step 4 (Midnight-side claim).
 * Claim-id vectors are pinned by an independent Python oracle
 * (hashlib.blake2b over the canonical v1 preimage), which also
 * recomputed the EMI1 commitment, EMA1 attestations and EMS1
 * settlement record the claim rests on — the full oracle chain
 * agrees with the values pinned in the earlier steps' tests. */
const assert = require('node:assert');
const ib = require('./intent-box');
const w = require('./watcher');
const s = require('./settlement');
const c = require('./claim');

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
const BOX_A = 'aa'.repeat(32);
const BOX_B = '0123456789abcdef'.repeat(4);
const SETTLE_MAIN_ID = 'f04ef57bb1a0bd9d51d963fd4ef475a734169de3e5c4b7872a018e9f611c3552';

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
const REVEAL = { midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: NONCE_A };
const att1 = w.buildAttestation({ watcherId: 'watcher-1', box: goodBox(), plan, currentHeight: 1500 });
const att2 = w.buildAttestation({ watcherId: 'watcher-2', box: goodBox(), plan, currentHeight: 1501 });
const settleMain = s.decideSettlement({
  box: goodBox(), plan, attestations: [att1, att2], quorum: 2, reveal: REVEAL, currentHeight: 1500,
});
const settleSingle = s.decideSettlement({
  box: goodBox(), plan, attestations: [att1], quorum: 1, reveal: REVEAL, currentHeight: 1500,
});

/* The oracle chain under the claim: settlement records are the pinned ones */
ok('settle MAIN record is the oracle-pinned record the claim rests on',
  settleMain.verdict === 'settle' && settleMain.record.recordId === SETTLE_MAIN_ID);
ok('settle SINGLE record is the oracle-pinned aaaed839 record',
  settleSingle.record.recordId === 'aaaed839e4b12ef36e525e732af7de5a4add138310c51342454f6250bd6aa3fd');

/* Oracle-pinned claim ids */
ok('claim id MAIN (oracle)', c.computeClaimId({
  commitment: plan.commitment, boxId: BOX_A, settlementRecordId: SETTLE_MAIN_ID,
  midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: NONCE_A,
}) === '32fcbd0ab7f53b74ade1f1e3eee9848b5533396bc9cbbb8c189fc4cd6127d95c');
ok('claim id SINGLE-settlement (oracle)', c.computeClaimId({
  commitment: plan.commitment, boxId: BOX_A,
  settlementRecordId: 'aaaed839e4b12ef36e525e732af7de5a4add138310c51342454f6250bd6aa3fd',
  midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: NONCE_A,
}) === '36d3ad15df0c8b075e4e79870d0ce9e7e4fea5e2480459e9c195f7312b87fdab');
ok('claim id beyond float53 (oracle)', c.computeClaimId({
  commitment: '16ff581ad0bdec77830a62102f26d1a748bb496a4e1666b280c9c19a33a88529',
  boxId: BOX_A, settlementRecordId: SETTLE_MAIN_ID,
  midnightRecipient: MN_ADDR, amountNanoErg: 9007199254740993n, nonceHex: NONCE_A,
}) === '623ad97a48d9389cbf8955d0aa16cd7db016d4eee1e3c9dd43f2e139c99af235');

/* Preimage layout: domain || commitment || boxId || recordId || u32be len || recipient || u64be amount || nonce */
ok('claim preimage layout', (() => {
  const pre = c.claimPreimage({
    commitment: plan.commitment, boxId: BOX_A, settlementRecordId: SETTLE_MAIN_ID,
    midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: NONCE_A,
  });
  const rb = Buffer.byteLength(MN_ADDR, 'utf8');
  const dv = new DataView(pre.buffer, pre.byteOffset, pre.byteLength);
  return pre.length === 4 + 32 + 32 + 32 + 4 + rb + 8 + 32 &&
    Buffer.from(pre.subarray(0, 4)).toString('ascii') === 'EMC1' &&
    Buffer.from(pre.subarray(4, 36)).toString('hex') === plan.commitment &&
    Buffer.from(pre.subarray(36, 68)).toString('hex') === BOX_A &&
    Buffer.from(pre.subarray(68, 100)).toString('hex') === SETTLE_MAIN_ID &&
    dv.getUint32(100, false) === rb &&
    Buffer.from(pre.subarray(104, 104 + rb)).toString('utf8') === MN_ADDR &&
    dv.getBigUint64(104 + rb, false) === 2000000000n &&
    Buffer.from(pre.subarray(112 + rb)).toString('hex') === NONCE_A;
})());

/* Every bound field moves the id */
const baseClaim = {
  commitment: plan.commitment, boxId: BOX_A, settlementRecordId: SETTLE_MAIN_ID,
  midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: NONCE_A,
};
const baseClaimId = c.computeClaimId(baseClaim);
ok('claim id binds the box', c.computeClaimId({ ...baseClaim, boxId: BOX_B }) !== baseClaimId);
ok('claim id binds the settlement record', c.computeClaimId({ ...baseClaim, settlementRecordId: settleSingle.record.recordId }) !== baseClaimId);
ok('claim id binds the amount', c.computeClaimId({ ...baseClaim, amountNanoErg: 2000000001n }) !== baseClaimId);
ok('claim id binds the nonce', c.computeClaimId({ ...baseClaim, nonceHex: 'ff'.repeat(32) }) !== baseClaimId);
ok('claim id binds the recipient', c.computeClaimId({ ...baseClaim, midnightRecipient: MN_DUST }) !== baseClaimId);

/* The happy path: a settle verdict becomes exactly one verifiable claim */
ok('claimable when record verifies, preimage verifies, and nothing claimed yet', (() => {
  const r = c.evaluateClaim({ record: settleMain.record, reveal: REVEAL, claimed: [] });
  return r.verdict === 'claimable' && r.reasons.length === 0 && r.claim !== null &&
    r.claim.claimId === '32fcbd0ab7f53b74ade1f1e3eee9848b5533396bc9cbbb8c189fc4cd6127d95c' &&
    r.claim.status === 'unsigned-phase1-claim' && r.claim.amountNanoErg === '2000000000' &&
    c.verifyClaimPayload(r.claim) === true;
})());
ok('claim from the SINGLE settlement carries the oracle SINGLE claim id', (() => {
  const r = c.evaluateClaim({ record: settleSingle.record, reveal: REVEAL });
  return r.verdict === 'claimable' && r.claim.claimId === '36d3ad15df0c8b075e4e79870d0ce9e7e4fea5e2480459e9c195f7312b87fdab';
})());
ok('buildClaimPayload mints the same payload evaluateClaim returns',
  c.buildClaimPayload({ record: settleMain.record, reveal: REVEAL }).claimId === baseClaimId);

/* Reject: the claim can never rest on a record that does not verify */
ok('reject when the settlement record was tampered with (height moved, id kept)', (() => {
  const tampered = { ...settleMain.record, decisionHeight: 1501 };
  const r = c.evaluateClaim({ record: tampered, reveal: REVEAL });
  return r.verdict === 'reject' && r.claim === null && r.reasons.includes('settlement-record-invalid');
})());
ok('reject when there is no settlement record at all (a wait verdict mints none)', (() => {
  const wait = s.decideSettlement({ box: goodBox(), plan, attestations: [att1], quorum: 2, reveal: REVEAL, currentHeight: 1500 });
  const r = c.evaluateClaim({ record: wait.record, reveal: REVEAL });
  return wait.record === null && r.verdict === 'reject' && r.reasons.includes('settlement-record-invalid');
})());
ok('reject when no fields are revealed, naming it', (() => {
  const r = c.evaluateClaim({ record: settleMain.record });
  return r.verdict === 'reject' && r.reasons.includes('preimage-not-revealed') && r.checks.preimageVerified === false;
})());
ok('reject when the reveal names a different recipient (redirect attempt)', (() => {
  const r = c.evaluateClaim({ record: settleMain.record, reveal: { ...REVEAL, midnightRecipient: MN_DUST } });
  return r.verdict === 'reject' && r.reasons.includes('preimage-does-not-verify');
})());
ok('reject when the reveal names a different amount', (() => {
  const r = c.evaluateClaim({ record: settleMain.record, reveal: { ...REVEAL, amountNanoErg: 2000000001n } });
  return r.verdict === 'reject' && r.reasons.includes('preimage-does-not-verify');
})());
throws('buildClaimPayload refuses an invalid record', () => c.buildClaimPayload({ record: { ...settleMain.record, decisionHeight: 1501 }, reveal: REVEAL }), 'settlement-record-invalid');
throws('buildClaimPayload refuses a non-verifying reveal', () => c.buildClaimPayload({ record: settleMain.record, reveal: { ...REVEAL, nonceHex: 'ff'.repeat(32) } }), 'preimage-does-not-verify');

/* Replay: one settle funds exactly one claim */
ok('already-claimed when the same claim id is in the claimed set', (() => {
  const first = c.evaluateClaim({ record: settleMain.record, reveal: REVEAL });
  const second = c.evaluateClaim({ record: settleMain.record, reveal: REVEAL, claimed: [first.claim.claimId] });
  return second.verdict === 'already-claimed' && second.claim === null &&
    second.reasons.includes('settlement-already-claimed') && second.candidateClaimId === first.claim.claimId;
})());
ok('already-claimed when a prior claim payload rests on the same settlement record', (() => {
  const first = c.evaluateClaim({ record: settleMain.record, reveal: REVEAL });
  const second = c.evaluateClaim({ record: settleMain.record, reveal: REVEAL, claimed: [first.claim] });
  return second.verdict === 'already-claimed';
})());
ok('already-claimed even for a re-minted payload quoting the same record under another id', (() => {
  const impostor = { claimId: 'ee'.repeat(32), settlementRecordId: SETTLE_MAIN_ID };
  const r = c.evaluateClaim({ record: settleMain.record, reveal: REVEAL, claimed: [impostor] });
  return r.verdict === 'already-claimed';
})());
ok('a claim on a DIFFERENT settlement is not blocked by the first claim', (() => {
  const first = c.evaluateClaim({ record: settleMain.record, reveal: REVEAL });
  const second = c.evaluateClaim({ record: settleSingle.record, reveal: REVEAL, claimed: [first.claim] });
  return second.verdict === 'claimable';
})());

/* Payload verification catches tampering with any carried field */
ok('verifyClaimPayload refuses a payload whose recipient was swapped after minting', (() => {
  const p = c.buildClaimPayload({ record: settleMain.record, reveal: REVEAL });
  return c.verifyClaimPayload({ ...p, midnightRecipient: MN_DUST }) === false;
})());
ok('verifyClaimPayload refuses a payload whose amount was inflated after minting', (() => {
  const p = c.buildClaimPayload({ record: settleMain.record, reveal: REVEAL });
  return c.verifyClaimPayload({ ...p, amountNanoErg: '2000000001' }) === false;
})());
ok('verifyClaimPayload refuses a payload with a foreign claim id', (() => {
  const p = c.buildClaimPayload({ record: settleMain.record, reveal: REVEAL });
  return c.verifyClaimPayload({ ...p, claimId: 'ee'.repeat(32) }) === false;
})());

/* Bounds: untrusted inputs are refused before hashing or scanning */
throws('claim refuses a recipient beyond the 200-byte bound', () => c.computeClaimId({ ...baseClaim, midnightRecipient: 'x'.repeat(201) }), '200-byte');
throws('claim refuses a zero amount', () => c.computeClaimId({ ...baseClaim, amountNanoErg: 0n }), 'positive');
throws('claim refuses an amount beyond the u64 the encoding carries', () => c.computeClaimId({ ...baseClaim, amountNanoErg: 1n << 64n }), 'u64');
throws('claim refuses a short nonce', () => c.computeClaimId({ ...baseClaim, nonceHex: 'abcd' }), '32 bytes of hex');
throws('evaluateClaim refuses to scan an unbounded claimed set', () => c.evaluateClaim({
  record: settleMain.record, reveal: REVEAL, claimed: new Array(c.MAX_CLAIMED_ENTRIES + 1).fill('ee'.repeat(32)),
}), 'bound');
ok('evaluateClaim scans a claimed set at exactly the bound', (() => {
  const r = c.evaluateClaim({
    record: settleMain.record, reveal: REVEAL, claimed: new Array(c.MAX_CLAIMED_ENTRIES).fill('ee'.repeat(32)),
  });
  return r.verdict === 'claimable';
})());

/* Bounds: scalar fields are judged by size before they are processed —
 * an oversize amount string is refused from its length (a canonical u64
 * amount is at most 20 characters), never parsed by BigInt() first, and
 * an oversize or non-string claim id is refused from its length, never
 * lowercased in full. Claimed-set entries get the same length-first
 * treatment in the replay scan. */
ok('verifyClaimPayload refuses an oversize amount string from its length, before parsing it', (() => {
  const p = c.buildClaimPayload({ record: settleMain.record, reveal: REVEAL });
  return c.verifyClaimPayload({ ...p, amountNanoErg: '9'.repeat(100000) }) === false;
})());
ok('verifyClaimPayload refuses an oversize claim id from its length', (() => {
  const p = c.buildClaimPayload({ record: settleMain.record, reveal: REVEAL });
  return c.verifyClaimPayload({ ...p, claimId: 'a'.repeat(1000000) }) === false;
})());
ok('verifyClaimPayload refuses a non-string claim id', (() => {
  const p = c.buildClaimPayload({ record: settleMain.record, reveal: REVEAL });
  return c.verifyClaimPayload({ ...p, claimId: 42 }) === false;
})());
ok('verifyClaimPayload still refuses a 20-digit amount beyond the u64 (the length gate is not the range check)', (() => {
  const p = c.buildClaimPayload({ record: settleMain.record, reveal: REVEAL });
  return c.verifyClaimPayload({ ...p, amountNanoErg: '18446744073709551616' }) === false;
})());
ok('an oversize claimed-set entry is skipped by length and does not block a claim', (() => {
  const r = c.evaluateClaim({
    record: settleMain.record, reveal: REVEAL,
    claimed: ['a'.repeat(1000000), { claimId: 'b'.repeat(1000000), settlementRecordId: 'c'.repeat(1000000) }],
  });
  return r.verdict === 'claimable';
})());

/* End-to-end precision: an amount beyond float53 survives plan -> settle -> claim exactly */
ok('beyond-float53 amount survives the full plan/settle/claim chain exactly', (() => {
  const big = 9007199254740993n;
  const plan2 = ib.buildIntentBoxPlan({
    network: 'testnet', ergoSender: KYLE_ERG, midnightRecipient: MN_ADDR,
    amountNanoErg: big, nonceHex: NONCE_A, creationHeight: 1000, timeoutHeight: 2000,
  });
  const box2 = {
    boxId: BOX_B, value: big.toString(), creationHeight: 1000, spentTransactionId: null,
    additionalRegisters: { R4: { serializedValue: '0e20' + plan2.commitment } },
  };
  const att = w.buildAttestation({ watcherId: 'watcher-1', box: box2, plan: plan2, currentHeight: 1500 });
  const dec = s.decideSettlement({
    box: box2, plan: plan2, attestations: [att], quorum: 1,
    reveal: { midnightRecipient: MN_ADDR, amountNanoErg: big, nonceHex: NONCE_A }, currentHeight: 1500,
  });
  const r = c.evaluateClaim({ record: dec.record, reveal: { midnightRecipient: MN_ADDR, amountNanoErg: big, nonceHex: NONCE_A } });
  return dec.verdict === 'settle' && r.verdict === 'claimable' &&
    r.claim.amountNanoErg === '9007199254740993' && c.verifyClaimPayload(r.claim) === true;
})());

console.log('ALL ' + pass + ' CLAIM TESTS PASS');
assert.ok(pass >= 30);
