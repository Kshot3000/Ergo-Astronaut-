'use strict';
/* Offline tests for btc-chain.js. Expected values come from REAL Bitcoin
 * headers (raw header hex fetched from blockstream.info, block hashes are
 * public constants) and an independent Python oracle implementing Bitcoin
 * Core's pow.cpp rules from the spec (hidden oracle-btcchain.py) — never
 * from this module. */
const assert = require('node:assert');
const chain = require('./btc-chain');

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

/* Raw headers (blockstream.info, 2026-10-13). Heights in names. */
const H0 = '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c';
const H1 = '010000006fe28c0ab6f1b372c1a6a246ae63f74f931e8365e15a089c68d6190000000000982051fd1e4ba744bbbe680e1fee14677ba1a3c3540bf7b1cdb606e857233e0e61bc6649ffff001d01e36299';
const H2 = '010000004860eb18bf1b1620e37e9490fc8a427514416fd75159ab86688e9a8300000000d5fdcc541e25de1c7a5addedf24858b8bb665c9f36ef744ee42c316022c90f9bb0bc6649ffff001d08d2bd61';
const H3 = '01000000bddd99ccfda39da1b108ce1a5d70038d0a967bacb68b6b63065f626a0000000044f672226090d85db9a9f2fbfe5f0f9609b387af7be5b7fbb7a1767c831c9e995dbe6649ffff001d05e0ed6d';
const H2015 = '01000000e25509cde707c3d02a693e4fe9e7cdd57c38a0d2c8d6341f20dae84b000000000c113df1185e162ee92d031fe21d1400ff7d705a3e9b9c860eea855313cd8ca26c087f49ffff001d30b73231';
const H2016 = '010000006397bb6abd4fc521c0d3f6071b5650389f0b4551bc40b4e6b067306900000000ace470aecda9c8818c8fe57688cd2a772b5a57954a00df0420a7dd546b6d2c576b0e7f49ffff001d33f0192f';
const H30240_TS = 1261130161;
const H32255 = '0100000049c1daab3b6536ff1b2633c3a316a6e06ec287676cdeec4ca7baae6b00000000ac10b36b8f354b3353207de15940a5edbc05bb8364af75b4b5409e7823f2b48923ec3a4bffff001dbd5fa412';
const H32256 = '010000004b0360d834a330ec7833e30e1f523ee05a0793361e29a73421964f980000000027b64a020af294e903feed93768705336a20090612a043f47af462a2f5e5b564f8ee3a4b6ad8001dd3a43707';
const GENESIS_TS = 1231006505;
const BLOCK3_HASH = '0000000082b5015589a3fdf2d4baff403e6f0be035a5d9742c1cae6295464449';
const BLOCK2016_HASH = '00000000a141216a896c54f211301c436e557a8d55900637bbdce14c6c7bddef';
const BLOCK32256_HASH = '000000004f2886a170adb7204cb0c7a824217dd24d11a74423d564c4e0904967';

/* --- compact codec: oracle-pinned round-trips and work --- */
ok('pow limit target', chain.POW_LIMIT_TARGET.toString(16).padStart(64, '0') === '00000000ffff0000000000000000000000000000000000000000000000000000');
for (const b of [0x1d00ffff, 0x1c0fffff, 0x1b0404cb, 0x1a00db86, 0x207fffff]) {
  ok('codec round-trip ' + b.toString(16), chain.bitsFromTarget(chain.targetFromBits(b)) === b);
}
ok('work at difficulty 1 (oracle)', chain.workFromBits(0x1d00ffff) === 4295032833n);
ok('work 0x1c0fffff (oracle)', chain.workFromBits(0x1c0fffff) === 68719542272n);
ok('work 0x1b0404cb (oracle)', chain.workFromBits(0x1b0404cb) === 70040908352512n);
ok('work 0x1a00db86 (oracle)', chain.workFromBits(0x1a00db86) === 84030863782868522n);
ok('work at regtest-style bits (oracle)', chain.workFromBits(0x207fffff) === 2n);
ok('zero-target bits decode to zero', chain.targetFromBits(0x01003456) === 0n);
throws('zero target has no work', () => chain.workFromBits(0x01003456), 'non-positive');
throws('sign-bit bits refused', () => chain.targetFromBits(0x1d800000), 'negative');
throws('negative target value refused', () => chain.bitsFromTarget(-1n), 'non-negative');

/* --- retarget: synthetic oracle cases --- */
ok('retarget on-time stays at the limit', chain.expectedRetargetBits(0x1d00ffff, GENESIS_TS, GENESIS_TS + 1209600) === 0x1d00ffff);
ok('retarget half-time halves the target (oracle)', chain.expectedRetargetBits(0x1c0fffff, 1000000000, 1000000000 + 604800) === 0x1c07ffff);
ok('retarget clamps at a quarter timespan (oracle)', chain.expectedRetargetBits(0x1c0fffff, 1000000000, 1000000000 + 1000) === 0x1c03ffff);
ok('retarget clamps at 4x timespan (oracle)', chain.expectedRetargetBits(0x1c0fffff, 1000000000, 1000000000 + 12096000) === 0x1c3ffffc);
ok('retarget third-timespan mid-difficulty (oracle)', chain.expectedRetargetBits(0x1b0404cb, 1300000000, 1300000000 + 403200) === 0x1b0156ee);

/* --- retarget: the two real ones in the fixtures --- */
ok('real retarget 2016 capped at pow limit', chain.expectedRetargetBits(0x1d00ffff, GENESIS_TS, 1233061996) === 0x1d00ffff);
ok('real retarget 32256 — first difficulty increase', chain.expectedRetargetBits(0x1d00ffff, H30240_TS, 1262152739) === 0x1d00d86a);

/* --- chain verification: real genesis segment --- */
const seg = chain.verifyHeaderChain([H0, H1, H2, H3]);
ok('genesis segment valid', seg.valid === true && seg.errors.length === 0);
ok('genesis segment cumulative work (oracle: 4 x 4295032833)', seg.cumulativeWork === '17180131332');
ok('genesis segment tip', seg.tipHeight === 3 && seg.tipHash === BLOCK3_HASH);
ok('genesis segment honestly labelled design', seg.status === 'design');

/* --- chain verification: real retarget segments --- */
const r2016 = chain.verifyHeaderChain([H2015, H2016], { startHeight: 2015, periodStartTimestamp: GENESIS_TS });
ok('2016 segment valid with period start supplied', r2016.valid === true);
ok('2016 retarget checked', JSON.stringify(r2016.retargetsChecked) === '[2016]' && r2016.retargetsUnverified.length === 0);
ok('2016 segment tip hash', r2016.tipHash === BLOCK2016_HASH);
const r2016u = chain.verifyHeaderChain([H2015, H2016], { startHeight: 2015 });
ok('2016 segment without period start is valid but unverified-retarget', r2016u.valid === true && JSON.stringify(r2016u.retargetsUnverified) === '[2016]');
const r32256 = chain.verifyHeaderChain([H32255, H32256], { startHeight: 32255, periodStartTimestamp: H30240_TS });
ok('32256 segment valid (bits changed exactly as retarget requires)', r32256.valid === true);
ok('32256 retarget checked', JSON.stringify(r32256.retargetsChecked) === '[32256]');
ok('32256 segment work (oracle: 4295032833 + 5080592338)', r32256.cumulativeWork === '9375625171');
ok('32256 segment tip hash', r32256.tipHash === BLOCK32256_HASH);

/* --- chain verification: failures are named, never silent --- */
const swapped = chain.verifyHeaderChain([H0, H2, H1, H3]);
ok('out-of-order chain invalid', swapped.valid === false);
ok('out-of-order chain names the link check', swapped.errors.some((e) => e.check === 'link'));
const tampered = chain.verifyHeaderChain([H0, H1, H2.slice(0, 152) + '00000000', H3]);
ok('tampered nonce invalid', tampered.valid === false && tampered.errors.some((e) => e.check === 'pow' || e.check === 'link'));
// Flip H1's bits to a neighbouring value: PoW over the mutated header and
// the bits-continuity rule both get their say; continuity must be named.
const bitsFlip = chain.verifyHeaderChain([H0, H1.slice(0, 144) + 'feff001d' + H1.slice(152), H2, H3]);
ok('off-boundary bits change invalid', bitsFlip.valid === false);
ok('off-boundary bits change names bits-continuity', bitsFlip.errors.some((e) => e.check === 'bits-continuity'));
const wrongRetarget = chain.verifyHeaderChain([H32255, H32256.slice(0, 144) + 'ffff001d' + H32256.slice(152)], { startHeight: 32255, periodStartTimestamp: H30240_TS });
ok('a header that ignores the retarget is invalid', wrongRetarget.valid === false);
ok('the ignored retarget is named as a retarget failure', wrongRetarget.errors.some((e) => e.check === 'retarget'));
const overLimit = chain.verifyHeaderChain(['01000000' + '00'.repeat(64) + '00000000' + 'ffff0020' + '00000000']);
ok('over-limit target named as a bits failure', overLimit.valid === false && overLimit.errors.some((e) => e.check === 'bits'));
throws('empty chain refused', () => chain.verifyHeaderChain([]), 'at least one header');
throws('negative start height refused', () => chain.verifyHeaderChain([H0], { startHeight: -1 }), 'startHeight');

/* --- guard draft: exported, labelled, not compiled --- */
ok('guard draft labelled draft', chain.SPV_GUARD_ERGOSCRIPT_DRAFT.includes('DRAFT') && chain.SPV_GUARD_ERGOSCRIPT_DRAFT.includes('not compiled'));
ok('guard draft keys on cumulative work', chain.SPV_GUARD_ERGOSCRIPT_DRAFT.includes('cumulative work'));

console.log('ALL PASS (' + pass + ' checks)');
