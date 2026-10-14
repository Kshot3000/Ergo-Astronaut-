'use strict';
/* Offline tests for btc-deposit.js. Fixtures are REAL Bitcoin chain data
 * (raw headers + the txid list of block 100000, fetched from
 * blockstream.info 2026-10-13); expected values — the Merkle branch for
 * tx index 2, per-block and cumulative work, and the evidence id — come
 * from an independent Python oracle (hashlib, Core pow rules from the
 * spec; hidden oracle-btcdeposit.py) whose computed Merkle root matches
 * the root committed in block 100000's real header. Never from this
 * module. */
const assert = require('node:assert');
const deposit = require('./btc-deposit');
const spv = require('./btc-spv');

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

/* Block 100000 segment, heights 100000..100005 (bits 0x1b04864c, no
 * retarget boundary inside: 100000 % 2016 = 1216). */
const SEG = [
  '0100000050120119172a610421a6c3011dd330d9df07b63616c2cc1f1cd00200000000006657a9252aacd5c0b2940996ecff952228c3067cc38d4885efb5a4ac4247e9f337221b4d4c86041b0f2b5710',
  '0100000006e533fd1ada86391f3f6c343204b0d278d4aaec1c0b20aa27ba0300000000006abbb3eb3d733a9fe18967fd7d4c117e4ccbbac5bec4d910d900b3ae0793e77f54241b4d4c86041b4089cc9b',
  '0100000090f0a9f110702f808219ebea1173056042a714bad51b916cb6800000000000005275289558f51c9966699404ae2294730c3c9f9bda53523ce50e9b95e558da2fdb261b4d4c86041b1ab1bf93',
  '01000000aff7e0c7dc29d227480c2aa79521419640a161023b51cdb28a3b0100000000003779fc09d638c4c6da0840c41fa625a90b72b125015fd0273f706d61f3be175faa271b4d4c86041b142dca82',
  '01000000e1c5ba3a6817d53738409f5e7229ffd098d481147b002941a7a002000000000077ed2af87aa4f9f450f8dbd15284720c3fd96f565a13c9de42a3c1440b7fc6a50e281b4d4c86041b08aecda2',
  '0100000079cda856b143d9db2c1caff01d1aecc8630d30625d10e8b4b8b0000000000000b50cc069d6a3e33e3ff84a5c41d9d3febe7c770fdcc96b2c3ff60abe184f196367291b4d4c86041b8fa45d63',
];
const PAY_TXID = '6359f0868171b1d194cbee1af2f16ea598ae8fad666d9b012c8ed2b79a236ec4'; // block 100000, index 2
const OTHER_TXID = 'e9a66845e05d5abc0ad04ec80f774a7e585c6e8db975962d069a522137b80c1d'; // index 3
const PAY_BRANCH = [ // oracle, internal order, leaf level first
  '1d0cb83721529a062d9675b98d6e5c587e4a770fc84ed00abc5a5de04568a6e9',
  '15b88c5107195bf09eb9da89b83d95b3d070079a3c5c5d3d17d0dcd873fbdacc',
];
const PAY_BLOCK_HASH = '000000000003ba27aa200b1cecaad478d2b00432346c3f1f3986da1afd33e506';
const TIP_HASH = '000000000000dab0130bbcc991d3d7ae6b81aa6f50a798888dfe62337458dc45';
const WORK = '373259717399796'; // oracle: 6 x 62209952899966
const EVIDENCE_ID = '23ff405d8e22a87e7099137e652c286bf17291ef00e9a47c7babb369e0b029ae';

function evidence(over = {}) {
  return {
    headersHex: SEG,
    startHeight: 100000,
    payment: { txid: PAY_TXID, index: 2, branch: PAY_BRANCH, blockHeight: 100000 },
    ...over,
  };
}

/* --- the happy path, all values oracle-pinned --- */
const good = deposit.verifyDepositEvidence(evidence(), { minConfirmations: 6, minCumulativeWork: WORK });
ok('real deposit evidence accepts at exact policy thresholds', good.accept === true && good.refusals.length === 0);
ok('confirmations count the payment block as 1', good.confirmations === 6);
ok('cumulative work (oracle)', good.cumulativeWork === WORK);
ok('payment block and tip hashes (real)', good.paymentBlockHash === PAY_BLOCK_HASH && good.tipHash === TIP_HASH);
ok('verdict honestly labelled design', good.status === 'design');

const rec = deposit.buildDepositRecord(evidence(), { minConfirmations: 6, minCumulativeWork: WORK });
ok('record evidence id (oracle)', rec.evidenceId === EVIDENCE_ID);
ok('record binds tx, block, depth and work', rec.txid === PAY_TXID && rec.blockHeight === 100000 && rec.confirmations === 6 && rec.cumulativeWork === WORK);
ok('record type and status', rec.recordType === 'spv-deposit-evidence' && rec.status === 'design');
ok('evidence id direct computation (oracle)', deposit.computeEvidenceId({
  txid: PAY_TXID, paymentBlockHash: PAY_BLOCK_HASH, tipHash: TIP_HASH,
  blockHeight: 100000, confirmations: 6, cumulativeWork: WORK,
}) === EVIDENCE_ID);
ok('evidence id binds the tx (oracle sanity)', deposit.computeEvidenceId({
  txid: OTHER_TXID, paymentBlockHash: PAY_BLOCK_HASH, tipHash: TIP_HASH,
  blockHeight: 100000, confirmations: 6, cumulativeWork: WORK,
}) !== EVIDENCE_ID);
ok('evidence id binds the depth (oracle sanity)', deposit.computeEvidenceId({
  txid: PAY_TXID, paymentBlockHash: PAY_BLOCK_HASH, tipHash: TIP_HASH,
  blockHeight: 100000, confirmations: 5, cumulativeWork: WORK,
}) !== EVIDENCE_ID);

/* --- single-transaction block: genesis coinbase, empty branch --- */
const GENESIS = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
const GENESIS_TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
const g = deposit.verifyDepositEvidence({
  headersHex: [GENESIS], startHeight: 0,
  payment: { txid: GENESIS_TXID, index: 0, branch: [], blockHeight: 0 },
});
ok('genesis coinbase evidence accepts (1 confirmation)', g.accept === true && g.confirmations === 1);

/* --- policy gates refuse by name --- */
const shallow = deposit.verifyDepositEvidence(evidence(), { minConfirmations: 7 });
ok('too-shallow evidence refused', shallow.accept === false);
ok('the refusal names confirmations', shallow.refusals.some((r) => r.check === 'confirmations'));
const weak = deposit.verifyDepositEvidence(evidence(), { minCumulativeWork: '373259717399797' });
ok('one unit of work short is refused', weak.accept === false && weak.refusals.some((r) => r.check === 'cumulative-work'));
throws('record refuses unaccepted evidence by check name',
  () => deposit.buildDepositRecord(evidence(), { minConfirmations: 7 }), 'confirmations');

/* --- inclusion gates refuse by name --- */
const wrongTx = deposit.verifyDepositEvidence(evidence({
  payment: { txid: OTHER_TXID, index: 2, branch: PAY_BRANCH, blockHeight: 100000 },
}));
ok('a different tx against this branch is refused as inclusion', wrongTx.accept === false && wrongTx.refusals.some((r) => r.check === 'inclusion'));
const wrongIndex = deposit.verifyDepositEvidence(evidence({
  payment: { txid: PAY_TXID, index: 3, branch: PAY_BRANCH, blockHeight: 100000 },
}));
ok('the right tx at the wrong index is refused as inclusion', wrongIndex.accept === false && wrongIndex.refusals.some((r) => r.check === 'inclusion'));
const tamperedBranch = deposit.verifyDepositEvidence(evidence({
  payment: { txid: PAY_TXID, index: 2, branch: ['00'.repeat(32), PAY_BRANCH[1]], blockHeight: 100000 },
}));
ok('a tampered branch element is refused as inclusion', tamperedBranch.accept === false && tamperedBranch.refusals.some((r) => r.check === 'inclusion'));

/* --- chain gates refuse by name --- */
const outside = deposit.verifyDepositEvidence(evidence({
  payment: { txid: PAY_TXID, index: 2, branch: PAY_BRANCH, blockHeight: 100006 },
}));
ok('payment block past the tip is refused', outside.accept === false && outside.refusals.some((r) => r.check === 'block-not-in-chain'));
ok('an out-of-chain payment reports no confirmations', outside.confirmations === null);
const swapped = deposit.verifyDepositEvidence(evidence({ headersHex: [SEG[0], SEG[2], SEG[1], SEG[3], SEG[4], SEG[5]] }));
ok('a broken chain is refused', swapped.accept === false);
ok('the chain refusal names the link check', swapped.refusals.some((r) => r.check === 'link'));

/* --- unverified retargets: refused unless explicitly allowed --- */
const H2015 = '01000000e25509cde707c3d02a693e4fe9e7cdd57c38a0d2c8d6341f20dae84b000000000c113df1185e162ee92d031fe21d1400ff7d705a3e9b9c860eea855313cd8ca26c087f49ffff001d30b73231';
const H2016 = '010000006397bb6abd4fc521c0d3f6071b5650389f0b4551bc40b4e6b067306900000000ace470aecda9c8818c8fe57688cd2a772b5a57954a00df0420a7dd546b6d2c576b0e7f49ffff001d33f0192f';
const coinbase2016 = spv.parseHeader(H2016).merkleRoot; // single-tx block: txid == root (input data, not an expected value)
const retargetEvidence = {
  headersHex: [H2015, H2016], startHeight: 2015,
  payment: { txid: coinbase2016, index: 0, branch: [], blockHeight: 2016 },
};
const unver = deposit.verifyDepositEvidence(retargetEvidence);
ok('unverified retarget refuses by default', unver.accept === false && unver.refusals.some((r) => r.check === 'retarget-unverified'));
const allowed = deposit.verifyDepositEvidence(retargetEvidence, { allowUnverifiedRetargets: true });
ok('unverified retarget accepts only when explicitly allowed', allowed.accept === true && allowed.retargetsUnverified.length === 1);
const verified = deposit.verifyDepositEvidence({ ...retargetEvidence, periodStartTimestamp: 1231006505 });
ok('supplying the period start verifies the retarget and accepts', verified.accept === true && JSON.stringify(verified.retargetsChecked) === '[2016]');

/* --- malformed shapes throw --- */
throws('missing payment throws', () => deposit.verifyDepositEvidence({ headersHex: SEG, startHeight: 100000 }), 'payment');
throws('negative index throws', () => deposit.verifyDepositEvidence(evidence({
  payment: { txid: PAY_TXID, index: -1, branch: PAY_BRANCH, blockHeight: 100000 },
})), 'index');
throws('zero minConfirmations throws', () => deposit.verifyDepositEvidence(evidence(), { minConfirmations: 0 }), 'minConfirmations');
throws('non-numeric work floor throws', () => deposit.verifyDepositEvidence(evidence(), { minCumulativeWork: 'lots' }), 'minCumulativeWork');
throws('empty header list throws', () => deposit.verifyDepositEvidence(evidence({ headersHex: [] })), 'at least one header');

console.log('ALL PASS (' + pass + ' checks)');
