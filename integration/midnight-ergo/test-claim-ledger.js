'use strict';
/* Offline tests for claim-ledger.js — Phase 1 step 5 (claim ledger).
 * Entry-id vectors are pinned by an independent Python oracle
 * (hashlib.blake2b over the canonical v1 preimage), whose
 * recomputation of the whole EMI1->EMA1->EMS1->EMC1 chain agrees
 * with the values pinned in the earlier steps' tests. */
const assert = require('node:assert');
const ib = require('./intent-box');
const w = require('./watcher');
const s = require('./settlement');
const c = require('./claim');
const l = require('./claim-ledger');

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
const SETTLE_SINGLE_ID = 'aaaed839e4b12ef36e525e732af7de5a4add138310c51342454f6250bd6aa3fd';
const CLAIM_MAIN_ID = '32fcbd0ab7f53b74ade1f1e3eee9848b5533396bc9cbbb8c189fc4cd6127d95c';
const CLAIM_SINGLE_ID = '36d3ad15df0c8b075e4e79870d0ce9e7e4fea5e2480459e9c195f7312b87fdab';
const ENTRY0_ID = '7398015027f993e822c8515ba8a87b2ae781d34ab9e1716366ad534eb6da9039';
const ENTRY1_ID = '0aa63340111a3b9af297a064cf611ebe210c40a10a64307cf7e5b50dddbb74fa';

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

/* A third, genuinely distinct claim (different box, amount beyond float53, own settlement) */
function thirdClaim() {
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
  return c.buildClaimPayload({
    record: dec.record, reveal: { midnightRecipient: MN_ADDR, amountNanoErg: big, nonceHex: NONCE_A },
  });
}
const claimThird = thirdClaim();

/* The oracle chain under the ledger: the claims are the pinned ones */
ok('claims under the ledger are the oracle-pinned step-4 claims',
  claimMain.claimId === CLAIM_MAIN_ID && claimSingle.claimId === CLAIM_SINGLE_ID &&
  settleMain.record.recordId === SETTLE_MAIN_ID && settleSingle.record.recordId === SETTLE_SINGLE_ID);

/* Oracle-pinned entry ids */
ok('ledger entry 0 id (oracle)', l.computeLedgerEntryId({
  prevHead: l.GENESIS_HEAD, claimId: CLAIM_MAIN_ID, settlementRecordId: SETTLE_MAIN_ID, seq: 0,
}) === ENTRY0_ID);
ok('ledger entry 1 id (oracle)', l.computeLedgerEntryId({
  prevHead: ENTRY0_ID, claimId: CLAIM_SINGLE_ID, settlementRecordId: SETTLE_SINGLE_ID, seq: 1,
}) === ENTRY1_ID);

/* Preimage layout: domain || prevHead || claimId || settlementRecordId || u32be seq */
ok('ledger entry preimage layout', (() => {
  const pre = l.ledgerEntryPreimage({
    prevHead: l.GENESIS_HEAD, claimId: CLAIM_MAIN_ID, settlementRecordId: SETTLE_MAIN_ID, seq: 0,
  });
  const dv = new DataView(pre.buffer, pre.byteOffset, pre.byteLength);
  return pre.length === 4 + 32 + 32 + 32 + 4 &&
    Buffer.from(pre.subarray(0, 4)).toString('ascii') === 'EML1' &&
    Buffer.from(pre.subarray(4, 36)).toString('hex') === l.GENESIS_HEAD &&
    Buffer.from(pre.subarray(36, 68)).toString('hex') === CLAIM_MAIN_ID &&
    Buffer.from(pre.subarray(68, 100)).toString('hex') === SETTLE_MAIN_ID &&
    dv.getUint32(100, false) === 0;
})());

/* Every bound field moves the id */
const baseEntry = { prevHead: l.GENESIS_HEAD, claimId: CLAIM_MAIN_ID, settlementRecordId: SETTLE_MAIN_ID, seq: 0 };
ok('entry id binds the prev head', l.computeLedgerEntryId({ ...baseEntry, prevHead: ENTRY0_ID }) !== ENTRY0_ID);
ok('entry id binds the claim', l.computeLedgerEntryId({ ...baseEntry, claimId: CLAIM_SINGLE_ID }) !== ENTRY0_ID);
ok('entry id binds the settlement', l.computeLedgerEntryId({ ...baseEntry, settlementRecordId: SETTLE_SINGLE_ID }) !== ENTRY0_ID);
ok('entry id binds the seq', l.computeLedgerEntryId({ ...baseEntry, seq: 1 }) !== ENTRY0_ID);

/* The empty ledger */
ok('empty ledger verifies with the genesis head', (() => {
  const v = l.verifyLedger([]);
  return v.valid === true && v.head === l.GENESIS_HEAD && v.count === 0 && l.ledgerHead([]) === l.GENESIS_HEAD;
})());

/* The happy path: appends chain into the oracle-pinned history */
const e0 = l.appendClaim([], claimMain);
const ledger1 = [e0];
ok('append mints the oracle entry 0 and does not mutate its input', (() => {
  const empty = [];
  return e0.entryId === ENTRY0_ID && e0.seq === 0 && e0.prevHead === l.GENESIS_HEAD &&
    e0.status === 'unsigned-phase1-ledger-entry' && l.appendClaim(empty, claimMain).entryId === ENTRY0_ID &&
    empty.length === 0;
})());
const e1 = l.appendClaim(ledger1, claimSingle);
const ledger2 = [e0, e1];
ok('second append chains onto the first with the oracle entry 1 id',
  e1.entryId === ENTRY1_ID && e1.prevHead === ENTRY0_ID && e1.seq === 1);
ok('two-entry ledger verifies and its head is the oracle head after 2', (() => {
  const v = l.verifyLedger(ledger2);
  return v.valid === true && v.head === ENTRY1_ID && v.count === 2 && l.ledgerHead(ledger2) === ENTRY1_ID;
})());
const e2 = l.appendClaim(ledger2, claimThird);
const ledger3 = [e0, e1, e2];
ok('a third distinct claim extends the ledger and moves the head', (() => {
  const v = l.verifyLedger(ledger3);
  return v.valid === true && v.count === 3 && v.head === e2.entryId && e2.entryId !== ENTRY1_ID &&
    e2.prevHead === ENTRY1_ID;
})());

/* Reads: the replay question, answered from the chained history */
ok('isClaimedInLedger finds a claim by id and by settlement, and misses strangers', (() =>
  l.isClaimedInLedger(ledger3, { claimId: CLAIM_MAIN_ID }) === true &&
  l.isClaimedInLedger(ledger3, { settlementRecordId: claimThird.settlementRecordId }) === true &&
  l.isClaimedInLedger(ledger3, { claimId: 'ee'.repeat(32) }) === false &&
  l.isClaimedInLedger([], { claimId: CLAIM_MAIN_ID }) === false)());
ok('claimedSetFromLedger feeds step 4: a ledgered settlement is already-claimed there', (() => {
  const replay = c.evaluateClaim({ record: settleMain.record, reveal: REVEAL, claimed: l.claimedSetFromLedger(ledger2) });
  const fresh = c.evaluateClaim({ record: settleSingle.record, reveal: REVEAL, claimed: l.claimedSetFromLedger([e0]) });
  return replay.verdict === 'already-claimed' && fresh.verdict === 'claimable';
})());

/* The append gate: duplicates and unverifiable payloads never enter */
throws('append refuses the same claim twice', () => l.appendClaim(ledger1, claimMain), 'duplicate');
throws('append refuses a claim whose settlement is already claimed (same payload, either duplicate check)',
  () => l.appendClaim(ledger2, claimMain), 'duplicate');
throws('append refuses a payload whose recipient was swapped after minting',
  () => l.appendClaim([], { ...claimMain, midnightRecipient: MN_DUST }), 'claim-payload-invalid');
throws('append refuses a payload with a foreign claim id',
  () => l.appendClaim([], { ...claimMain, claimId: 'ee'.repeat(32) }), 'claim-payload-invalid');
throws('append refuses to extend a ledger that does not verify',
  () => l.appendClaim([{ ...e0, claimId: 'ee'.repeat(32) }], claimSingle), 'ledger does not verify');

/* Tamper evidence: history cannot be edited, dropped, or reordered quietly */
ok('verify refuses an entry whose claim id was edited after minting', (() => {
  const v = l.verifyLedger([{ ...e0, claimId: 'ee'.repeat(32) }, e1]);
  return v.valid === false && v.failures.includes('entry-id-mismatch');
})());
ok('verify refuses a ledger with the middle entry deleted', (() => {
  const v = l.verifyLedger([e0, e2]);
  return v.valid === false && (v.failures.includes('prev-head-mismatch') || v.failures.includes('seq-mismatch'));
})());
ok('verify refuses a ledger with two entries reordered', (() => {
  const v = l.verifyLedger([e1, e0]);
  return v.valid === false && v.failures.includes('prev-head-mismatch');
})());
ok('verify refuses a first entry that does not start from the genesis head', (() => {
  const foreign = l.buildLedgerEntry({ prevHead: ENTRY0_ID, seq: 0, claim: claimMain });
  const v = l.verifyLedger([foreign]);
  return v.valid === false && v.failures.includes('prev-head-mismatch');
})());
ok('verify refuses a seq that was rewritten', (() => {
  const v = l.verifyLedger([{ ...e0, seq: 7 }]);
  return v.valid === false && v.failures.includes('seq-mismatch');
})());
ok('verify refuses a malformed entry', (() => {
  const v = l.verifyLedger([{ version: 1, seq: 0 }]);
  return v.valid === false && v.failures.includes('malformed-entry');
})());

/* The recomputed-duplicate attack: correct chain math, forbidden content */
ok('verify refuses a correctly-chained duplicate of an earlier claim', (() => {
  const dup = l.buildLedgerEntry({ prevHead: ENTRY1_ID, seq: 2, claim: claimMain });
  const v = l.verifyLedger([e0, e1, dup]);
  return v.valid === false && v.failures.includes('duplicate-claim') && v.failures.includes('duplicate-settlement');
})());
ok('verify refuses a correctly-chained duplicate settlement under a fresh claim id', (() => {
  const impostor = { ...claimThird, settlementRecordId: SETTLE_MAIN_ID };
  // computeLedgerEntryId is the pure mint: chain math is honest, the content is a replay
  const dup = l.buildLedgerEntry({ prevHead: ENTRY1_ID, seq: 2, claim: impostor });
  const v = l.verifyLedger([e0, e1, dup]);
  return v.valid === false && v.failures.includes('duplicate-settlement') && !v.failures.includes('duplicate-claim');
})());

/* Broken ledgers answer nothing */
throws('ledgerHead throws on a broken ledger', () => l.ledgerHead([e1, e0]), 'ledger does not verify');
throws('isClaimedInLedger throws on a broken ledger instead of answering from it',
  () => l.isClaimedInLedger([e1, e0], { claimId: CLAIM_MAIN_ID }), 'ledger does not verify');
throws('isClaimedInLedger throws on an empty query', () => l.isClaimedInLedger(ledger2, {}), 'must name');
throws('claimedSetFromLedger throws on a broken ledger',
  () => l.claimedSetFromLedger([{ ...e0, entryId: 'ee'.repeat(32) }]), 'ledger does not verify');

/* Bounds: untrusted histories are refused, never scanned without limit */
ok('verify reports an over-bound ledger instead of scanning it', (() => {
  const v = l.verifyLedger(new Array(l.MAX_LEDGER_ENTRIES + 1).fill(null));
  return v.valid === false && v.failures.includes('ledger-exceeds-bound');
})());
throws('append refuses a ledger already at the bound',
  () => l.appendClaim(new Array(l.MAX_LEDGER_ENTRIES).fill(null), claimMain), 'bound');
throws('entry preimage refuses a seq beyond the u32 it carries',
  () => l.ledgerEntryPreimage({ ...baseEntry, seq: 0x100000000 }), 'u32');
throws('entry preimage refuses a short prev head',
  () => l.ledgerEntryPreimage({ ...baseEntry, prevHead: 'abcd' }), '32 bytes of hex');
ok('isClaimedInLedger judges an oversize query id from its length: a plain miss, genuine ids still found', (() =>
  l.isClaimedInLedger(ledger3, { claimId: 'e'.repeat(1000000) }) === false &&
  l.isClaimedInLedger(ledger3, { settlementRecordId: 'e'.repeat(1000000) }) === false &&
  l.isClaimedInLedger(ledger3, { claimId: CLAIM_MAIN_ID }) === true)());
throws('buildLedgerEntry refuses an oversize prev head by name, without lowercasing it in full',
  () => l.buildLedgerEntry({ prevHead: 'a'.repeat(1000000), seq: 0, claim: claimMain }), '32 bytes of hex');
ok('buildLedgerEntry still canonicalizes uppercase 64-char ids to the same entry', (() => {
  const upper = l.buildLedgerEntry({
    prevHead: l.GENESIS_HEAD, seq: 0,
    claim: { claimId: CLAIM_MAIN_ID.toUpperCase(), settlementRecordId: claimMain.settlementRecordId.toUpperCase() },
  });
  return upper.entryId === ENTRY0_ID && upper.claimId === CLAIM_MAIN_ID;
})());

console.log('ALL ' + pass + ' CLAIM-LEDGER TESTS PASS');
assert.ok(pass >= 30);
