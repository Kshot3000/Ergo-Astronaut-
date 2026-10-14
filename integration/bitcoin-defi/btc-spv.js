'use strict';
/*
 * btc-spv.js — Bitcoin SPV verification primitives for Ergo-side contracts and
 * tooling, plus a BTC->Ergo DeFi route planner. Phase 0 of the native Bitcoin
 * DeFi on Ergo workstream (see README.md in this folder).
 *
 * The point of SPV on Ergo: an ErgoScript contract (or off-chain tooling that
 * prepares its inputs) can check that a Bitcoin payment really happened —
 * header parses, proof-of-work meets the nBits target, and a transaction is
 * committed in the header's Merkle root — without trusting an oracle's word.
 * These functions are that check, dependency-free, and pinned by tests
 * against the real Bitcoin genesis block and an independent Python oracle.
 *
 * Read-only math only. Nothing here signs, broadcasts, or custodies anything.
 * Built by Kyle Cox (@kshot9000), independent builder.
 */

const crypto = require('node:crypto');

function sha256d(buf) {
  const once = crypto.createHash('sha256').update(buf).digest();
  return crypto.createHash('sha256').update(once).digest();
}

function hexToBuf(hex, what) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error((what || 'value') + ' must be even-length hex');
  }
  return Buffer.from(hex, 'hex');
}

// Bitcoin displays hashes byte-reversed vs their internal (wire) order.
function reverseHex(hex) {
  return Buffer.from(hexToBuf(hex, 'hash')).reverse().toString('hex');
}

/* ---------------- Headers and proof-of-work ---------------- */

function parseHeader(headerHex) {
  const raw = hexToBuf(headerHex, 'header');
  if (raw.length !== 80) throw new Error('a Bitcoin block header is exactly 80 bytes');
  const hashInternal = sha256d(raw);
  return {
    version: raw.readUInt32LE(0),
    prevHash: raw.subarray(4, 36).reverse().toString('hex'), // display order
    merkleRoot: raw.subarray(36, 68).reverse().toString('hex'), // display order
    timestamp: raw.readUInt32LE(68),
    bits: raw.readUInt32LE(72),
    nonce: raw.readUInt32LE(76),
    hash: Buffer.from(hashInternal).reverse().toString('hex'), // display order
  };
}

function powTarget(bits) {
  if (!Number.isSafeInteger(bits) || bits < 0 || bits > 0xffffffff) throw new Error('bits must be a u32');
  const exponent = bits >>> 24;
  const mantissa = BigInt(bits & 0xffffff);
  if (exponent <= 3) return mantissa >> BigInt(8 * (3 - exponent));
  return mantissa << BigInt(8 * (exponent - 3));
}

function checkPow(headerHex) {
  const h = parseHeader(headerHex);
  // The hash as an integer is its display-order hex read big-endian
  // (equivalently, the raw digest read little-endian).
  return BigInt('0x' + h.hash) <= powTarget(h.bits);
}

/* ---------------- Merkle roots and inclusion proofs ---------------- */

function merkleRoot(txidsDisplay) {
  if (!Array.isArray(txidsDisplay) || txidsDisplay.length === 0) {
    throw new Error('at least one txid is required');
  }
  let level = txidsDisplay.map((t) => hexToBuf(reverseHex(t), 'txid'));
  for (const leaf of level) {
    if (leaf.length !== 32) throw new Error('txids must be 32 bytes');
  }
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length - 1]);
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(sha256d(Buffer.concat([level[i], level[i + 1]])));
    }
    level = next;
  }
  return Buffer.from(level[0]).reverse().toString('hex');
}

// branch: sibling hashes in INTERNAL (wire) order, leaf level first — the
// shape Bitcoin SPV proofs (e.g. BIP-37 partial Merkle trees) are built from.
function verifyInclusion(txidDisplay, index, branchInternalHex, expectedRootDisplay) {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('index must be a non-negative integer');
  let cur = hexToBuf(reverseHex(txidDisplay), 'txid');
  if (cur.length !== 32) throw new Error('txid must be 32 bytes');
  let idx = index;
  for (const sibHex of branchInternalHex || []) {
    const sib = hexToBuf(sibHex, 'branch element');
    if (sib.length !== 32) throw new Error('branch elements must be 32 bytes');
    cur = idx % 2 === 0 ? sha256d(Buffer.concat([cur, sib])) : sha256d(Buffer.concat([sib, cur]));
    idx = Math.floor(idx / 2);
  }
  return Buffer.from(cur).reverse().toString('hex') === expectedRootDisplay.toLowerCase();
}

/* ---------------- Route planner ---------------- */

// Format checks only — they catch typos, they do not prove an address is
// yours or funded. Ergo's real checksum validation lives in hub tool 2;
// Bitcoin bech32 checksums are validated by the wallet used at bridge time.
function looksLikeBtcAddress(address) {
  return (
    typeof address === 'string' &&
    (/^[13][1-9A-HJ-NP-Za-km-z]{25,39}$/.test(address) || /^bc1[0-9a-z]{25,64}$/.test(address))
  );
}
function looksLikeErgoAddress(address) {
  return (
    typeof address === 'string' &&
    address.length >= 30 &&
    address.length <= 60 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(address)
  );
}

function planBtcDefiRoute({ satoshis, btcAddress, ergoAddress } = {}) {
  if (typeof satoshis !== 'bigint' && !(typeof satoshis === 'number' && Number.isSafeInteger(satoshis))) {
    throw new Error('satoshis must be a BigInt or a safe integer');
  }
  const amount = BigInt(satoshis);
  if (amount <= 0n) throw new Error('satoshis must be positive');
  if (!looksLikeBtcAddress(btcAddress)) throw new Error('btcAddress failed the format check');
  if (!looksLikeErgoAddress(ergoAddress)) throw new Error('ergoAddress failed the format check');
  return {
    direction: 'btc->ergo-defi',
    amountSatoshis: amount.toString(),
    btcAddress,
    ergoAddress,
    status: 'mixed', // one live route, one design route — legs say which
    legs: [
      {
        leg: 1,
        from: 'BTC on Bitcoin',
        to: 'rsBTC on Ergo',
        via: 'Rosen Bridge',
        status: 'live',
        note: 'Live since 2024-06-14. BTC locks in Rosen\u2019s watcher/guard federation on Bitcoin; rsBTC is issued on Ergo. Federated, not trustless: the guard set is the security model. Bridge fee and minimums are Rosen\u2019s live schedule — the planner does not hardcode them; check at bridge time.',
      },
      {
        leg: 2,
        from: 'rsBTC on Ergo',
        to: 'Ergo DeFi',
        via: 'Ergo DEXes and contracts (e.g. Spectrum pools)',
        status: 'live-ecosystem',
        note: 'rsBTC can trade and sit in ErgoScript contracts today. Pool depth changes: check live liquidity for the pair and size before relying on a route.',
      },
      {
        leg: 3,
        from: 'BTC payment on Bitcoin',
        to: 'release inside an Ergo contract',
        via: 'SPV proof verified by the contract (this module\u2019s primitives)',
        status: 'design',
        note: 'One-way flows only: an Ergo contract can verify a Bitcoin header chain and a Merkle inclusion proof and release on that evidence. Bitcoin cannot verify Ergo back, so moving value out to BTC still needs a federation or threshold-signing set — no honest design skips that.',
      },
    ],
  };
}

module.exports = {
  parseHeader,
  powTarget,
  checkPow,
  merkleRoot,
  verifyInclusion,
  planBtcDefiRoute,
  looksLikeBtcAddress,
  looksLikeErgoAddress,
};
