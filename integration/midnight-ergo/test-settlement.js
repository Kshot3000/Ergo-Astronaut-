'use strict';
/* Offline tests for settlement.js — Phase 1 step 3 (settlement decision).
 * Record-id vectors are pinned by an independent Python oracle
 * (hashlib.blake2b over the canonical v1 preimage), not by this code. */
const assert = require('node:assert');
const ib = require('./intent-box');
const w = require('./watcher');
const s = require('./settlement');

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
const REVEAL = { midnightRecipient: MN_ADDR, amountNanoErg: 2000000000n, nonceHex: NONCE_A };
const att1 = w.buildAttestation({ watcherId: 'watcher-1', box: goodBox(), plan, currentHeight: 1500 });
const att2 = w.buildAttestation({ watcherId: 'watcher-2', box: goodBox(), plan, currentHeight: 1501 });
const decide = (over = {}) => s.decideSettlement({
  box: goodBox(), plan, attestations: [att1, att2], quorum: 2, reveal: REVEAL, currentHeight: 1500, ...over,
});

/* The watcher layer now names the ids it counted (the record binds them) */
ok('second attestation carries the oracle ATT1501 id', att2.attestationId === '333d695908abd09cd14db7c8171c5ce117e99f1db87b0eed248c4d0a78ff39dd');
ok('quorum verdict names the counted ids, sorted', (() => {
  const r = w.collectAttestations([att2, att1], { quorum: 2, commitment: plan.commitment, boxId: BOX_A });
  return JSON.stringify(r.countedAttestationIds) === JSON.stringify([att2.attestationId, att1.attestationId].sort());
})());

/* Oracle-pinned record ids */
ok('record id MAIN (oracle)', s.computeSettlementRecordId({
  commitment: plan.commitment, boxId: BOX_A, decisionHeight: 1500,
  attestationIds: [att1.attestationId, att2.attestationId],
}) === 'f04ef57bb1a0bd9d51d963fd4ef475a734169de3e5c4b7872a018e9f611c3552');
ok('record id SINGLE (oracle)', s.computeSettlementRecordId({
  commitment: plan.commitment, boxId: BOX_A, decisionHeight: 1500, attestationIds: [att1.attestationId],
}) === 'aaaed839e4b12ef36e525e732af7de5a4add138310c51342454f6250bd6aa3fd');
ok('record id LATER (oracle)', s.computeSettlementRecordId({
  commitment: plan.commitment, boxId: BOX_A, decisionHeight: 1600,
  attestationIds: [att1.attestationId, att2.attestationId],
}) === '516b2e515f092e736f2e4fb9bdec57b1a20fcdb3928b4e5cb01bb1cae5215824');

/* Preimage layout: domain || commitment || boxId || u32be height || u16be count || sorted ids */
ok('record preimage layout', (() => {
  const pre = s.settlementRecordPreimage({
    commitment: plan.commitment, boxId: BOX_A, decisionHeight: 1500,
    attestationIds: [att1.attestationId, att2.attestationId],
  });
  const dv = new DataView(pre.buffer, pre.byteOffset, pre.byteLength);
  return pre.length === 138 &&
    Buffer.from(pre.subarray(0, 4)).toString('ascii') === 'EMS1' &&
    Buffer.from(pre.subarray(4, 36)).toString('hex') === plan.commitment &&
    Buffer.from(pre.subarray(36, 68)).toString('hex') === BOX_A &&
    dv.getUint32(68, false) === 1500 && dv.getUint16(72, false) === 2 &&
    Buffer.from(pre.subarray(74, 106)).toString('hex') === att2.attestationId &&
    Buffer.from(pre.subarray(106, 138)).toString('hex') === att1.attestationId;
})());

/* Arrival order and duplicates do not bind; every other field does */
const baseFields = { commitment: plan.commitment, boxId: BOX_A, decisionHeight: 1500, attestationIds: [att1.attestationId, att2.attestationId] };
const baseId = s.computeSettlementRecordId(baseFields);
ok('record id ignores attestation arrival order', s.computeSettlementRecordId({ ...baseFields, attestationIds: [att2.attestationId, att1.attestationId] }) === baseId);
ok('record id ignores duplicate ids', s.computeSettlementRecordId({ ...baseFields, attestationIds: [att1.attestationId, att1.attestationId, att2.attestationId] }) === baseId);
ok('record id binds the decision height', s.computeSettlementRecordId({ ...baseFields, decisionHeight: 1501 }) !== baseId);
ok('record id binds the attestation set', s.computeSettlementRecordId({ ...baseFields, attestationIds: [att1.attestationId] }) !== baseId);
ok('record id binds the box', s.computeSettlementRecordId({ ...baseFields, boxId: BOX_B }) !== baseId);
throws('record refuses an empty attestation set', () => s.computeSettlementRecordId({ ...baseFields, attestationIds: [] }), 'non-empty');

/* The happy path: settle, with the oracle MAIN record */
ok('settle when box, window, quorum and preimage all check out', (() => {
  const d = decide();
  return d.verdict === 'settle' && d.reasons.length === 0 && d.record !== null &&
    d.record.recordId === 'f04ef57bb1a0bd9d51d963fd4ef475a734169de3e5c4b7872a018e9f611c3552' &&
    d.record.status === 'unsigned-phase1-record' && s.verifySettlementRecord(d.record) === true;
})());
ok('settle record is the same whatever order attestations arrived in',
  decide({ attestations: [att2, att1] }).record.recordId === baseId);
ok('settle still possible on the last in-window height', decide({ currentHeight: 1999, attestations: [att1, att2] }).verdict === 'settle');

/* Wait: named, non-terminal shortfalls inside the window */
ok('wait when the quorum is short, naming it', (() => {
  const d = decide({ attestations: [att1] });
  return d.verdict === 'wait' && d.record === null && d.reasons.includes('quorum-not-reached') &&
    d.checks.quorumReached === false && d.checks.preimageVerified === true;
})());
ok('wait when no preimage is revealed, naming it', (() => {
  const d = decide({ reveal: undefined });
  return d.verdict === 'wait' && d.reasons.includes('preimage-not-revealed') && d.checks.preimageVerified === false;
})());
ok('wait when the revealed preimage does not verify, naming it', (() => {
  const d = decide({ reveal: { ...REVEAL, nonceHex: 'ff'.repeat(32) } });
  return d.verdict === 'wait' && d.reasons.includes('preimage-does-not-verify');
})());
ok('a tampered attestation cannot carry a settle', (() => {
  const d = decide({ attestations: [att1, { ...att2, confirmations: 1 }] });
  return d.verdict === 'wait' && d.quorum.invalid.length === 1 && d.checks.quorumReached === false;
})());
ok('an attestation for another box cannot carry a settle', (() => {
  const other = w.buildAttestation({ watcherId: 'watcher-2', box: goodBox({ boxId: BOX_B }), plan, currentHeight: 1500 });
  const d = decide({ attestations: [att1, other] });
  return d.verdict === 'wait' && d.quorum.invalid.length === 1;
})());

/* Refund-only: at/after the timeout the settle branch is dead, full stop */
ok('refund-only at the timeout even with quorum and preimage', (() => {
  const d = decide({ currentHeight: 2000 });
  return d.verdict === 'refund-only' && d.record === null && d.checks.windowOpen === false &&
    d.checks.quorumReached === true && d.checks.preimageVerified === true &&
    d.reasons.includes('settlement-window-closed');
})());
ok('refund-only after the timeout', decide({ currentHeight: 2500 }).verdict === 'refund-only');

/* Terminal verdicts outrank everything else */
ok('spent outranks settle, refund and reject', (() => {
  const spentBox = goodBox({ spentTransactionId: 'bb'.repeat(32) });
  return decide({ box: spentBox }).verdict === 'spent' &&
    decide({ box: spentBox, currentHeight: 2500 }).verdict === 'spent' &&
    decide({ box: spentBox }).checks.unspent === false;
})());
ok('reject a box carrying a different commitment', (() => {
  const d = decide({ box: goodBox({ additionalRegisters: { R4: { serializedValue: '0e20' + '00'.repeat(32) } } }) });
  return d.verdict === 'reject' && d.record === null && d.reasons.includes('box-does-not-match-plan');
})());
ok('reject an undervalued box', decide({ box: goodBox({ value: 1999999999 }) }).verdict === 'reject');
ok('reject a missing box', decide({ box: null }).verdict === 'reject');

/* Record verification detects tampering */
ok('verify rejects a tampered record height', (() => {
  const d = decide();
  return s.verifySettlementRecord({ ...d.record, decisionHeight: 1501 }) === false &&
    s.verifySettlementRecord({ ...d.record, attestationIds: [att1.attestationId] }) === false &&
    s.verifySettlementRecord(null) === false;
})());

/* Bounds: the record's attestation-id list is refused before it is processed */
const hexId = (i) => i.toString(16).padStart(64, '0');
throws('record refuses an attestation-id list beyond the bound, before processing it',
  () => s.computeSettlementRecordId({ ...baseFields, attestationIds: Array.from({ length: s.MAX_ATTESTATION_IDS + 1 }, (_, i) => hexId(i)) }),
  'exceed the ' + s.MAX_ATTESTATION_IDS + '-entry bound');
ok('record still processes an attestation-id list at the bound', (() => {
  const atBound = Array.from({ length: s.MAX_ATTESTATION_IDS }, (_, i) => hexId(i));
  return typeof s.computeSettlementRecordId({ ...baseFields, attestationIds: atBound }) === 'string';
})());
throws('record refuses an oversize attestation id from its length, before decoding it',
  () => s.computeSettlementRecordId({ ...baseFields, attestationIds: ['a'.repeat(2000000)] }),
  'attestation ids must be 32 bytes of hex');
throws('record refuses a non-string attestation id instead of coercing it',
  () => s.computeSettlementRecordId({ ...baseFields, attestationIds: [42] }),
  'attestation ids must be 32 bytes of hex');
ok('a hostile record with an over-bound id list fails verification, it does not verify or throw', (() => {
  const d = decide();
  const hostile = { ...d.record, attestationIds: Array.from({ length: s.MAX_ATTESTATION_IDS + 1 }, (_, i) => hexId(i)) };
  return s.verifySettlementRecord(hostile) === false;
})());
ok('record verification refuses an oversize record id from its length, without throwing', (() => {
  const d = decide();
  return s.verifySettlementRecord({ ...d.record, recordId: 'a'.repeat(1000000) }) === false;
})());
ok('record verification refuses a non-string record id', (() => {
  const d = decide();
  return s.verifySettlementRecord({ ...d.record, recordId: 42 }) === false;
})());

/* Input discipline */
throws('decision refuses a zero quorum', () => decide({ quorum: 0 }), 'positive integer');
throws('decision refuses a negative height', () => decide({ currentHeight: -1 }), 'non-negative integer');
throws('decision refuses a plan without a commitment', () => decide({ plan: {} }), 'intent-box plan');

console.log('ALL PASS (' + pass + ' checks)');
