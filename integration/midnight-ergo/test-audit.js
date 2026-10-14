'use strict';
/* Offline tests for audit.js — Phase 1 step 6 (end-to-end audit).
 * The audit-id vectors are pinned by an independent Python oracle
 * (hashlib.blake2b over the canonical EAU1 preimage), whose
 * recomputation of the whole EMI1->EMA1->EMS1->EMC1->EML1 chain
 * agrees with the values pinned in the earlier steps' tests. */
const assert = require('node:assert');
const ib = require('./intent-box');
const w = require('./watcher');
const s = require('./settlement');
const c = require('./claim');
const l = require('./claim-ledger');
const a = require('./audit');

let pass = 0;
function ok(name, cond) {
  if (!cond) throw new Error('FAIL: ' + name);
  pass += 1;
  console.log('PASS', name);
}
function fails(name, bundle, needle) {
  const r = a.auditBundle(bundle);
  ok(name, r.verdict === 'failed' && r.auditId === null && r.failures.includes(needle));
  return r;
}

const KYLE_ERG = '9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy';
const MN_ADDR = 'mn_addr_test1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnzs23v9ccrydpk8qarc0s6vexr4';
const MN_DUST = 'mn_dust14w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w4suxv3rz';
const NONCE_A = '00'.repeat(31) + '01';
const BOX_A = 'aa'.repeat(32);
const BOX_B = '0123456789abcdef'.repeat(4);
const SETTLE_MAIN_ID = 'f04ef57bb1a0bd9d51d963fd4ef475a734169de3e5c4b7872a018e9f611c3552';
const SETTLE_SINGLE_ID = 'aaaed839e4b12ef36e525e732af7de5a4add138310c51342454f6250bd6aa3fd';
const CLAIM_MAIN_ID = '32fcbd0ab7f53b74ade1f1e3eee9848b5533396bc9cbbb8c189fc4cd6127d95c';
const CLAIM_SINGLE_ID = '36d3ad15df0c8b075e4e79870d0ce9e7e4fea5e2480459e9c195f7312b87fdab';
const ENTRY0_ID = '7398015027f993e822c8515ba8a87b2ae781d34ab9e1716366ad534eb6da9039';
const ENTRY1_ID = '0aa63340111a3b9af297a064cf611ebe210c40a10a64307cf7e5b50dddbb74fa';
const AUDIT_MAIN_ID = '3618a2f47d02261d611efa8b8a82ffba5eb29b587cdda1cc1bf7e2f122ab7244';
const AUDIT_TWO_ID = '656d1434da356cc39a8e1df69ff6ab0fcd0b16bd9679e87128bcef467e8e8e82';

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
const claimMain = c.buildClaimPayload({ record: settleMain.record, reveal: REVEAL });
const claimSingle = c.buildClaimPayload({ record: settleSingle.record, reveal: REVEAL });
const e0 = l.appendClaim([], claimMain);
const e1 = l.appendClaim([e0], claimSingle);

/* A third, genuinely distinct intent (different box, amount beyond float53) */
const BIG = 9007199254740993n;
const plan2 = ib.buildIntentBoxPlan({
  network: 'testnet', ergoSender: KYLE_ERG, midnightRecipient: MN_ADDR,
  amountNanoErg: BIG, nonceHex: NONCE_A, creationHeight: 1000, timeoutHeight: 2000,
});
const box2 = {
  boxId: BOX_B, value: BIG.toString(), creationHeight: 1000, spentTransactionId: null,
  additionalRegisters: { R4: { serializedValue: '0e20' + plan2.commitment } },
};
const REVEAL2 = { midnightRecipient: MN_ADDR, amountNanoErg: BIG, nonceHex: NONCE_A };
const attB = w.buildAttestation({ watcherId: 'watcher-1', box: box2, plan: plan2, currentHeight: 1500 });
const settleB = s.decideSettlement({
  box: box2, plan: plan2, attestations: [attB], quorum: 1, reveal: REVEAL2, currentHeight: 1500,
});
const claimB = c.buildClaimPayload({ record: settleB.record, reveal: REVEAL2 });
const eB = l.appendClaim([], claimB);

function mainBundle(overrides = {}) {
  return {
    plan, box: goodBox(), attestations: [att1, att2], quorum: 2, reveal: REVEAL,
    settlementRecord: settleMain.record, claim: claimMain, ledger: [e0],
    ...overrides,
  };
}

/* The chain under the audit is the oracle-pinned one */
ok('artifacts under the audit are the oracle-pinned steps 1-5 artifacts',
  claimMain.claimId === CLAIM_MAIN_ID && claimSingle.claimId === CLAIM_SINGLE_ID &&
  settleMain.record.recordId === SETTLE_MAIN_ID && settleSingle.record.recordId === SETTLE_SINGLE_ID &&
  e0.entryId === ENTRY0_ID && e1.entryId === ENTRY1_ID);

/* Oracle-pinned audit ids */
ok('audit id over the one-entry history (oracle)', a.computeAuditId({
  commitment: plan.commitment, boxId: BOX_A, settlementRecordId: SETTLE_MAIN_ID,
  claimId: CLAIM_MAIN_ID, ledgerHead: ENTRY0_ID,
}) === AUDIT_MAIN_ID);
ok('audit id over the two-entry history (oracle)', a.computeAuditId({
  commitment: plan.commitment, boxId: BOX_A, settlementRecordId: SETTLE_MAIN_ID,
  claimId: CLAIM_MAIN_ID, ledgerHead: ENTRY1_ID,
}) === AUDIT_TWO_ID);

/* Preimage layout: domain || commitment || boxId || settlementRecordId || claimId || ledgerHead */
ok('audit preimage layout', (() => {
  const pre = a.auditPreimage({
    commitment: plan.commitment, boxId: BOX_A, settlementRecordId: SETTLE_MAIN_ID,
    claimId: CLAIM_MAIN_ID, ledgerHead: ENTRY0_ID,
  });
  const hex = Buffer.from(pre).toString('hex');
  return pre.length === 4 + 32 * 5 &&
    Buffer.from(pre.subarray(0, 4)).toString('ascii') === 'EAU1' &&
    hex.slice(8) === plan.commitment + BOX_A + SETTLE_MAIN_ID + CLAIM_MAIN_ID + ENTRY0_ID;
})());

/* Every bound field moves the id */
const baseAudit = {
  commitment: plan.commitment, boxId: BOX_A, settlementRecordId: SETTLE_MAIN_ID,
  claimId: CLAIM_MAIN_ID, ledgerHead: ENTRY0_ID,
};
ok('audit id binds the settlement', a.computeAuditId({ ...baseAudit, settlementRecordId: SETTLE_SINGLE_ID }) !== AUDIT_MAIN_ID);
ok('audit id binds the claim', a.computeAuditId({ ...baseAudit, claimId: CLAIM_SINGLE_ID }) !== AUDIT_MAIN_ID);
ok('audit id binds the ledger head', a.computeAuditId({ ...baseAudit, ledgerHead: ENTRY1_ID }) !== AUDIT_MAIN_ID);
ok('audit id binds the box', a.computeAuditId({ ...baseAudit, boxId: BOX_B }) !== AUDIT_MAIN_ID);

/* The happy path: the whole history re-verifies, link by link */
ok('a complete honest bundle audits, with the oracle audit id', (() => {
  const r = a.auditBundle(mainBundle());
  return r.verdict === 'audited' && r.auditId === AUDIT_MAIN_ID && r.ledgerHead === ENTRY0_ID &&
    r.claimId === CLAIM_MAIN_ID && r.settlementRecordId === SETTLE_MAIN_ID &&
    r.status === 'unsigned-phase1-audit' && r.failures.length === 0 &&
    Object.values(r.checks).every(Boolean);
})());
ok('the same claim against a longer honest history is a different audit', (() => {
  const r = a.auditBundle(mainBundle({ ledger: [e0, e1] }));
  return r.verdict === 'audited' && r.auditId === AUDIT_TWO_ID && r.ledgerHead === ENTRY1_ID;
})());
ok('a beyond-float53 intent audits end to end exactly', (() => {
  const r = a.auditBundle({
    plan: plan2, box: box2, attestations: [attB], quorum: 1, reveal: REVEAL2,
    settlementRecord: settleB.record, claim: claimB, ledger: [eB],
  });
  return r.verdict === 'audited' && r.auditId === a.computeAuditId({
    commitment: plan2.commitment, boxId: BOX_B, settlementRecordId: settleB.record.recordId,
    claimId: claimB.claimId, ledgerHead: eB.entryId,
  });
})());
ok('the audit does not mutate the bundle it was handed', (() => {
  const b = mainBundle();
  const attsBefore = b.attestations.map((x) => x.attestationId).join(',');
  a.auditBundle(b);
  return b.ledger.length === 1 && b.attestations.map((x) => x.attestationId).join(',') === attsBefore;
})());

/* Link 1 — plan and commitment */
fails('a reveal for a different amount fails the commitment link',
  mainBundle({ reveal: { ...REVEAL, amountNanoErg: 3000000000n } }), 'commitment-mismatch');
fails('a missing reveal is named', mainBundle({ reveal: null }), 'reveal-missing');
fails('a mainnet plan is refused (Phase 1 is testnet-only)',
  mainBundle({ plan: { ...plan, network: 'mainnet' } }), 'plan-not-testnet');
fails('a bundle with no plan is a failed audit, not a crash', {}, 'plan-malformed');
ok('a null bundle is a failed audit, not a crash',
  a.auditBundle(null).verdict === 'failed' && a.auditBundle().verdict === 'failed');

/* Link 2 — the box */
fails('a box carrying too little value fails the box link',
  mainBundle({ box: goodBox({ value: 100 }) }), 'box-does-not-match-plan');
fails('a spent box fails the audit however good the rest is',
  mainBundle({ box: goodBox({ spentTransactionId: 'ff'.repeat(32) }) }), 'box-spent');
fails('a box from a different intent fails the settlement binding',
  mainBundle({ box: goodBox({ boxId: BOX_B }) }), 'settlement-binds-other-box-or-plan');

/* Link 3 — attestations and quorum */
fails('an attestation edited after minting fails the attestation link',
  mainBundle({ attestations: [{ ...att1, observedHeight: 1499 }, att2] }), 'attestation-invalid');
fails('one watcher short of quorum fails the quorum link',
  mainBundle({ attestations: [att1] }), 'quorum-not-reached');
fails('a foreign attestation is named even when quorum is still reached',
  mainBundle({ attestations: [att1, att2, attB] }), 'attestation-names-other-box-or-commitment');
fails('a non-array attestation list is a failed audit, not a crash',
  mainBundle({ attestations: 'two watchers, trust me' }), 'attestations-malformed');
fails('an over-bound attestation list is refused, never scanned',
  mainBundle({ attestations: new Array(a.MAX_ATTESTATIONS + 1).fill(null) }), 'attestations-exceed-bound');

/* Link 4 — the settlement record */
fails('a settlement record edited after minting fails the record link',
  mainBundle({ settlementRecord: { ...settleMain.record, decisionHeight: 1501 } }), 'settlement-record-invalid');
fails('a record resting on fewer attestations than the bundle shows fails the binding',
  mainBundle({
    settlementRecord: settleSingle.record, claim: claimSingle, ledger: [e0, e1],
  }), 'settlement-attestations-mismatch');
ok('a self-consistent record decided after the timeout fails window and reproduction', (() => {
  const late = {
    version: 1, status: 'unsigned-phase1-record',
    commitment: plan.commitment, boxId: BOX_A, decisionHeight: 2500,
    attestationIds: settleMain.record.attestationIds,
  };
  late.recordId = s.computeSettlementRecordId(late);
  const r = fails('a self-consistent record decided after the timeout fails the window check',
    mainBundle({ settlementRecord: late }), 'settlement-outside-window');
  return r.failures.includes('settlement-not-reproduced');
})());

/* Link 5 — the claim */
fails('a claim whose recipient was swapped after minting fails the claim link',
  mainBundle({ claim: { ...claimMain, midnightRecipient: MN_DUST } }), 'claim-payload-invalid');
fails('a claim resting on a different settlement fails the claim binding',
  mainBundle({ claim: claimSingle }), 'claim-binds-other-settlement-box-or-plan');

/* Link 6 — the ledger */
fails('a claim the ledger never recorded fails the ledger link', {
  plan, box: goodBox(), attestations: [att1], quorum: 1, reveal: REVEAL,
  settlementRecord: settleSingle.record, claim: claimSingle, ledger: [e0],
}, 'claim-not-in-ledger');
fails('a reordered ledger fails the ledger link',
  mainBundle({ ledger: [e1, e0] }), 'ledger-invalid');
fails('an empty ledger records no claim',
  mainBundle({ ledger: [] }), 'claim-not-in-ledger');
/* The ids the ledger scan compares are length-judged ONCE before the
 * scan, never lowercased once per ledger entry: an oversize claim or
 * record id is a plain miss (a verified entry's ids are exactly 64
 * chars, so no other length could ever match), and a genuine
 * uppercase claim id still finds its entry and audits. */
fails('an oversize claim id is a plain ledger miss, judged from its length',
  mainBundle({ claim: { ...claimMain, claimId: 'ab'.repeat(100000) } }), 'claim-not-in-ledger');
fails('an oversize settlement record id is a plain ledger miss',
  mainBundle({ settlementRecord: { ...settleMain.record, recordId: 'cd'.repeat(100000) } }), 'claim-not-in-ledger');
ok('an uppercase genuine claim id still audits end to end', (() => {
  const r = a.auditBundle(mainBundle({ claim: { ...claimMain, claimId: claimMain.claimId.toUpperCase() } }));
  return r.verdict === 'audited' && r.auditId === AUDIT_MAIN_ID;
})());

console.log('ALL ' + pass + ' AUDIT TESTS PASS');
assert.ok(pass >= 28);
