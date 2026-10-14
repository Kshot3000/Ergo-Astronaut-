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
/* Element size is judged from the string length BEFORE any scan or
 * decode: a 200,000-char "header" refused in ~77 ms of regex+Buffer
 * work pre-fix; the length check refuses it (and non-strings) in O(1)
 * with the same 80-byte error. */
throws('oversize header refused by length', () => spv.parseHeader('00'.repeat(100000)), '80 bytes');
throws('non-string header refused', () => spv.parseHeader(123), '80 bytes');

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
/* Bounds: a caller-supplied txid list is refused BEFORE the leaf buffers
 * are allocated and hashed — 200,001 identical txids took ~1.5 s of
 * hashing pre-fix. The bound sits far above any real block's tx count. */
throws('oversize merkle list refused', () => spv.merkleRoot(new Array(spv.MAX_MERKLE_TXIDS + 1).fill(leaf(1))), 'bound');
ok('merkle bound is finite and generous', spv.MAX_MERKLE_TXIDS === 100000);
/* The list bound caps the COUNT; the per-element length check caps the
 * SIZE — one txid element is judged by its 64-char length before it is
 * scanned, decoded and reversed, not after. */
throws('oversize txid element refused by length', () => spv.merkleRoot(['ab'.repeat(1000)]), '32 bytes');
throws('non-string txid element refused', () => spv.merkleRoot([123]), '32 bytes');

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
/* Bounds: branch depth is ceil(log2(tx count)) — 32 levels cover 2^32
 * txs, so a deeper branch is not a proof, it is unbounded hashing work,
 * and it refuses up front. A branch at the bound still runs. */
ok('inclusion branch bound covers 2^32 txs', spv.MAX_INCLUSION_BRANCH === 32);
throws('oversize inclusion branch refused', () =>
  spv.verifyInclusion(leaf(3), 2, new Array(spv.MAX_INCLUSION_BRANCH + 1).fill(leaf(1)), ROOT5), 'bound');
ok('inclusion branch at the bound still runs', typeof spv.verifyInclusion(leaf(3), 2, new Array(spv.MAX_INCLUSION_BRANCH).fill(leaf(1)), ROOT5) === 'boolean');
throws('non-array inclusion branch refused', () => spv.verifyInclusion(leaf(3), 2, 'not-an-array', ROOT5), 'array');
/* Same length-before-decode rule on this path: an oversize branch
 * element refuses by its string length, and a non-string expected root
 * is the module's own Error — pre-fix it crashed with a raw TypeError
 * from .toLowerCase. A short STRING root stays a plain false: it is a
 * well-formed shape that simply does not match. */
throws('oversize branch element refused by length', () =>
  spv.verifyInclusion(leaf(3), 2, ['ab'.repeat(1000)], ROOT5), '32 bytes');
throws('non-string expected root refused', () => spv.verifyInclusion(leaf(3), 2, BRANCH_IDX2, 123), 'string');
ok('short expected root simply fails', spv.verifyInclusion(leaf(3), 2, BRANCH_IDX2, 'abcd') === false);
/* The expected root is length-judged before the comparison: the
 * computed root is exactly 64 hex chars, so an oversize "root" fails
 * from its length, never lowercased in full first, and an uppercase
 * 64-char root still verifies. */
ok('oversize expected root simply fails, judged from its length', spv.verifyInclusion(leaf(3), 2, BRANCH_IDX2, 'ab'.repeat(100000)) === false);
ok('uppercase expected root still verifies', spv.verifyInclusion(leaf(3), 2, BRANCH_IDX2, ROOT5.toUpperCase()) === true);

/* --- address format checks --- */
ok('btc legacy address format', spv.looksLikeBtcAddress(SATOSHI_ADDR) === true);
ok('btc bech32 address format', spv.looksLikeBtcAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh') === true);
ok('ergo address is not a btc address', spv.looksLikeBtcAddress(KYLE_ERG) === false);
/* The address length is judged BEFORE the regexes scan: the longest
 * string either pattern can match is 67 chars ('bc1' + 64), so an
 * oversize "address" is refused from its length, never scanned in
 * full first (a 20 MB one burned ~30-55 ms of anchored scanning) —
 * and an at-bound 67-char bech32 string still matches. */
ok('at-bound 67-char bech32 address still matches', spv.looksLikeBtcAddress('bc1' + 'q'.repeat(64)) === true);
ok('oversize bech32 address refused from its length', spv.looksLikeBtcAddress('bc1' + 'q'.repeat(65)) === false);
ok('oversize legacy-shaped address refused from its length', spv.looksLikeBtcAddress('1' + 'a'.repeat(100000)) === false);
ok('address bound is the bech32 maximum', spv.MAX_BTC_ADDRESS_LENGTH === 67);
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
throws('plan refuses oversize btc address', () => spv.planBtcDefiRoute({ satoshis: 1n, btcAddress: '1' + 'a'.repeat(100000), ergoAddress: KYLE_ERG }), 'btcAddress');
throws('plan refuses bad ergo address', () => spv.planBtcDefiRoute({ satoshis: 1n, btcAddress: SATOSHI_ADDR, ergoAddress: 'nope' }), 'ergoAddress');

console.log('ALL PASS (' + pass + ' checks)');
