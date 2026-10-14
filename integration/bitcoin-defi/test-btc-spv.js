'use strict';
/* Offline tests for btc-spv.js. Expected values are either public Bitcoin
 * constants (genesis block) or were produced by an independent Python
 * hashlib oracle (double-SHA256) — never by this module. */
const assert = require('node:assert');
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

const GENESIS_HEADER =
  '01000000' +
  '0000000000000000000000000000000000000000000000000000000000000000' +
  '3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a' +
  '29ab5f49' +
  'ffff001d' +
  '1dac2b7c';
const GENESIS_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f';
const GENESIS_COINBASE_TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b';
const KYLE_ERG = '9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy';
const SATOSHI_ADDR = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

/* --- genesis block: parse, hash, PoW --- */
const gh = spv.parseHeader(GENESIS_HEADER);
ok('genesis version', gh.version === 1);
ok('genesis prev hash is zero', gh.prevHash === '0'.repeat(64));
ok('genesis merkle root is the coinbase txid', gh.merkleRoot === GENESIS_COINBASE_TXID);
ok('genesis timestamp', gh.timestamp === 1231006505);
ok('genesis bits', gh.bits === 0x1d00ffff);
ok('genesis nonce', gh.nonce === 2083236893);
ok('genesis hash matches the known block hash', gh.hash === GENESIS_HASH);
ok('genesis pow valid', spv.checkPow(GENESIS_HEADER) === true);
ok(
  'genesis target matches the known value',
  spv.powTarget(0x1d00ffff).toString(16).padStart(64, '0') ===
    '00000000ffff0000000000000000000000000000000000000000000000000000'
);
const crushedBits = GENESIS_HEADER.slice(0, 144) + '56340001' + GENESIS_HEADER.slice(152);
ok('crushed-target pow target is zero', spv.powTarget(0x01003456) === 0n);
ok('crushed-target header fails pow', spv.checkPow(crushedBits) === false);
const tamperedNonce = GENESIS_HEADER.slice(0, 152) + '00000000';
ok('tampered nonce changes the hash', spv.parseHeader(tamperedNonce).hash !== GENESIS_HASH);
throws('short header refused', () => spv.parseHeader(GENESIS_HEADER.slice(0, 158)), '80 bytes');
throws('non-hex header refused', () => spv.parseHeader('zz' + GENESIS_HEADER.slice(2)), 'hex');

/* --- merkle roots --- */
ok('single-tx merkle root is the txid', spv.merkleRoot([GENESIS_COINBASE_TXID]) === GENESIS_COINBASE_TXID);
const leaf = (i) => ('0' + i).repeat(32); // bytes([i])*32 — display == internal for these
ok('oracle merkle n=2', spv.merkleRoot([leaf(1), leaf(2)]) === 'b4100303b9e99ada4b479b0bb93d9b549cb057a1c4be08896bc982debe20ce39');
ok(
  'oracle merkle n=3 (odd leaf duplicated)',
  spv.merkleRoot([leaf(1), leaf(2), leaf(3)]) === 'acbd47d5022a6c5e954ad677df8ec221c893f871889826df53f0f1ad3f023e22'
);
const five = [leaf(1), leaf(2), leaf(3), leaf(4), leaf(5)];
const ROOT5 = 'd3e522600f2e93120ad9331f4e199c5dd98262a23ff8ae8b3f8b36720f87e226';
ok('oracle merkle n=5', spv.merkleRoot(five) === ROOT5);
throws('empty merkle refused', () => spv.merkleRoot([]), 'at least one');
throws('short txid refused', () => spv.merkleRoot(['abcd']), '32 bytes');

/* --- inclusion proofs (branch elements are internal-order, oracle-pinned) --- */
const BRANCH_IDX2 = [
  '0404040404040404040404040404040404040404040404040404040404040404',
  '39ce20bede82c96b8908bec4a157b09c549b3db90b9b474bda9ae9b9030310b4',
  'b93bfcfb094ddf2b2ef0feb482bbd018bf1ef5c08bd9620727d212fcb11311dd',
];
ok('inclusion proof verifies', spv.verifyInclusion(leaf(3), 2, BRANCH_IDX2, ROOT5) === true);
ok('inclusion proof at wrong index fails', spv.verifyInclusion(leaf(3), 3, BRANCH_IDX2, ROOT5) === false);
ok('inclusion proof for wrong leaf fails', spv.verifyInclusion(leaf(4), 2, BRANCH_IDX2, ROOT5) === false);
const tamperedBranch = BRANCH_IDX2.slice();
tamperedBranch[1] = '00' + tamperedBranch[1].slice(2);
ok('tampered branch fails', spv.verifyInclusion(leaf(3), 2, tamperedBranch, ROOT5) === false);
ok('single-leaf inclusion is identity', spv.verifyInclusion(GENESIS_COINBASE_TXID, 0, [], GENESIS_COINBASE_TXID) === true);

/* --- address format checks --- */
ok('btc legacy address format', spv.looksLikeBtcAddress(SATOSHI_ADDR) === true);
ok('btc bech32 address format', spv.looksLikeBtcAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh') === true);
ok('ergo address is not a btc address', spv.looksLikeBtcAddress(KYLE_ERG) === false);
ok('ergo address format', spv.looksLikeErgoAddress(KYLE_ERG) === true);

/* --- route planner --- */
const plan = spv.planBtcDefiRoute({ satoshis: 100000n, btcAddress: SATOSHI_ADDR, ergoAddress: KYLE_ERG });
ok('plan direction', plan.direction === 'btc->ergo-defi');
ok('plan amount string', plan.amountSatoshis === '100000');
ok('plan overall status honestly mixed', plan.status === 'mixed');
ok('plan leg 1 is live rosen', plan.legs[0].status === 'live' && plan.legs[0].via === 'Rosen Bridge');
ok('plan leg 2 is live ecosystem', plan.legs[1].status === 'live-ecosystem');
ok('plan leg 3 (spv) honestly design', plan.legs[2].status === 'design');
throws('plan refuses zero', () => spv.planBtcDefiRoute({ satoshis: 0n, btcAddress: SATOSHI_ADDR, ergoAddress: KYLE_ERG }), 'positive');
throws('plan refuses float', () => spv.planBtcDefiRoute({ satoshis: 1.5, btcAddress: SATOSHI_ADDR, ergoAddress: KYLE_ERG }), 'BigInt or a safe integer');
throws('plan refuses bad btc address', () => spv.planBtcDefiRoute({ satoshis: 1n, btcAddress: KYLE_ERG, ergoAddress: KYLE_ERG }), 'btcAddress');
throws('plan refuses bad ergo address', () => spv.planBtcDefiRoute({ satoshis: 1n, btcAddress: SATOSHI_ADDR, ergoAddress: 'nope' }), 'ergoAddress');

console.log('ALL PASS (' + pass + ' checks)');
