'use strict';
/*
 * intent-box.js — Phase 1, step 1 of the Midnight<->Ergo integration:
 * the recipient commitment and the Ergo testnet intent-box plan.
 *
 * The Phase 0 planner (dual-chain.js) names an intent off-chain. This module
 * defines what Phase 1 puts ON chain on Ergo testnet: a box whose R4 register
 * carries a Blake2b-256 commitment to the Midnight recipient, the amount and
 * a nonce — never the recipient itself — plus a timeout height in R5 after
 * which the sender refunds. Watchers verify a real box against a plan with
 * inspectIntentBox() before they attest to anything.
 *
 * Canonical commitment preimage v1 (pinned by an independent Python oracle,
 * hashlib.blake2b; see the tests):
 *   "EMI1" (4 ASCII bytes, domain tag)
 *   || u32be(byte length of the recipient's UTF-8 encoding)
 *   || recipient UTF-8 bytes
 *   || u64be(amount in nanoERG)
 *   || nonce (exactly 32 bytes)
 * commitment = Blake2b-256(preimage), hex.
 *
 * TESTNET ONLY. buildIntentBoxPlan refuses mainnet outright: Phase 1 moves
 * zero real value by design. Nothing here builds a real transaction, signs,
 * or deploys a contract — the ErgoScript guard below is DRAFT source, not
 * compiled and not deployed; compiling it against a testnet toolchain is
 * the next Phase 1 step and its result will be recorded honestly.
 *
 * Built by Kyle Cox (@kshot9000), independent builder.
 */

const { looksLikeErgoAddress, looksLikeMidnightAddress } = require('./dual-chain');

/* ---------- Blake2b-256 (RFC 7693, unkeyed) ----------
 * Same pure-JS implementation as the hub's app.js address checker, where it
 * is pinned against Python hashlib vectors; the commitment vectors in this
 * module's tests are pinned by a second, independent Python oracle. */
const MASK64 = (1n << 64n) - 1n;
const B2_IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const B2_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];
function rotr64(x, n) {
  return ((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK64;
}
function blake2b256(bytes) {
  const outLen = 32;
  const h = B2_IV.slice();
  h[0] ^= 0x01010020n; /* param block: digest 32, key 0, fanout 1, depth 1 */
  function compress(block, count, isLast) {
    const m = new Array(16);
    for (let i = 0; i < 16; i++) {
      let w = 0n;
      for (let j = 7; j >= 0; j--) w = (w << 8n) | BigInt(block[i * 8 + j]);
      m[i] = w;
    }
    const v = h.concat(B2_IV);
    v[12] ^= BigInt(count) & MASK64;
    v[13] ^= (BigInt(count) >> 64n) & MASK64;
    if (isLast) v[14] ^= MASK64;
    function G(a, b, c, d, x, y) {
      v[a] = (v[a] + v[b] + x) & MASK64; v[d] = rotr64(v[d] ^ v[a], 32);
      v[c] = (v[c] + v[d]) & MASK64; v[b] = rotr64(v[b] ^ v[c], 24);
      v[a] = (v[a] + v[b] + y) & MASK64; v[d] = rotr64(v[d] ^ v[a], 16);
      v[c] = (v[c] + v[d]) & MASK64; v[b] = rotr64(v[b] ^ v[c], 63);
    }
    for (let r = 0; r < 12; r++) {
      const s = B2_SIGMA[r];
      G(0, 4, 8, 12, m[s[0]], m[s[1]]); G(1, 5, 9, 13, m[s[2]], m[s[3]]);
      G(2, 6, 10, 14, m[s[4]], m[s[5]]); G(3, 7, 11, 15, m[s[6]], m[s[7]]);
      G(0, 5, 10, 15, m[s[8]], m[s[9]]); G(1, 6, 11, 12, m[s[10]], m[s[11]]);
      G(2, 7, 8, 13, m[s[12]], m[s[13]]); G(3, 4, 9, 14, m[s[14]], m[s[15]]);
    }
    for (let k = 0; k < 8; k++) h[k] ^= v[k] ^ v[k + 8];
  }
  const input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  if (input.length === 0) {
    compress(new Uint8Array(128), 0, true);
  } else {
    let offset = 0;
    while (input.length - offset > 128) {
      compress(input.subarray(offset, offset + 128), offset + 128, false);
      offset += 128;
    }
    const last = new Uint8Array(128);
    last.set(input.subarray(offset));
    compress(last, input.length, true);
  }
  const out = new Uint8Array(outLen);
  for (let i = 0; i < 4; i++) {
    let word = h[i];
    for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(word & 0xffn); word >>= 8n; }
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* ---------------- Commitment ---------------- */

const COMMITMENT_DOMAIN = 'EMI1'; // Ergo-Midnight Intent, encoding v1
const U64_MAX = (1n << 64n) - 1n;

function validateIntentFields({ midnightRecipient, amountNanoErg, nonceHex }) {
  if (!looksLikeMidnightAddress(midnightRecipient)) {
    throw new Error('midnightRecipient is not a Midnight address (Bech32m checksum check)');
  }
  if (typeof amountNanoErg !== 'bigint' && !(typeof amountNanoErg === 'number' && Number.isSafeInteger(amountNanoErg))) {
    throw new Error('amountNanoErg must be a BigInt or a safe integer');
  }
  const amount = BigInt(amountNanoErg);
  if (amount <= 0n) throw new Error('amountNanoErg must be positive');
  if (amount > U64_MAX) throw new Error('amountNanoErg exceeds the u64 the commitment encoding carries');
  if (typeof nonceHex !== 'string' || nonceHex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(nonceHex)) {
    throw new Error('nonceHex must be exactly 32 bytes of hex (64 characters)');
  }
  return amount;
}

function commitmentPreimage({ midnightRecipient, amountNanoErg, nonceHex }) {
  const amount = validateIntentFields({ midnightRecipient, amountNanoErg, nonceHex });
  const recipientBytes = new TextEncoder().encode(midnightRecipient);
  const pre = new Uint8Array(4 + 4 + recipientBytes.length + 8 + 32);
  let o = 0;
  pre.set(new TextEncoder().encode(COMMITMENT_DOMAIN), o); o += 4;
  new DataView(pre.buffer).setUint32(o, recipientBytes.length, false); o += 4;
  pre.set(recipientBytes, o); o += recipientBytes.length;
  new DataView(pre.buffer).setBigUint64(o, amount, false); o += 8;
  pre.set(hexToBytes(nonceHex), o);
  return pre;
}

function computeCommitment(fields) {
  return bytesToHex(blake2b256(commitmentPreimage(fields)));
}

function verifyCommitment(commitmentHex, fields) {
  if (typeof commitmentHex !== 'string' || commitmentHex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(commitmentHex)) return false;
  try {
    return computeCommitment(fields) === commitmentHex.toLowerCase();
  } catch {
    return false;
  }
}

/* ---------------- Intent box plan (Ergo testnet) ---------------- */

/*
 * Draft ErgoScript guard for the intent box — SOURCE ONLY, not compiled,
 * not deployed. Settlement path: before the timeout, spend by revealing
 * the commitment's canonical preimage (context variable 1); the guard
 * hashes exactly those bytes and compares to R4, so the on-chain check
 * can never drift from the v1 encoding above — decoding the preimage
 * into recipient/amount/nonce is the watchers' off-chain job (they run
 * verifyCommitment before attesting). Refund path: at or after the
 * timeout height in R5, the sender's key (R6, a SigmaProp) spends the
 * box back. Compiling and testing this on testnet is the next Phase 1
 * step, and any compiler-driven change to it gets recorded there.
 */
const INTENT_GUARD_ERGOSCRIPT_DRAFT = `{
  val commitment = SELF.R4[Coll[Byte]].get
  val timeoutHeight = SELF.R5[Int].get
  val sender = SELF.R6[SigmaProp].get
  val preimage = getVar[Coll[Byte]](1).get
  val settle = HEIGHT < timeoutHeight && blake2b256(preimage) == commitment
  val refund = HEIGHT >= timeoutHeight && sender
  settle || refund
}`;

function buildIntentBoxPlan({ network, ergoSender, midnightRecipient, amountNanoErg, nonceHex, creationHeight, timeoutHeight } = {}) {
  if (network !== 'testnet') {
    throw new Error('intent boxes are testnet-only in Phase 1 (zero real value by design)');
  }
  if (!looksLikeErgoAddress(ergoSender)) throw new Error('ergoSender is not an Ergo address (format check)');
  const amount = validateIntentFields({ midnightRecipient, amountNanoErg, nonceHex });
  if (!Number.isSafeInteger(creationHeight) || creationHeight < 0) throw new Error('creationHeight must be a non-negative integer');
  if (!Number.isSafeInteger(timeoutHeight) || timeoutHeight <= creationHeight) {
    throw new Error('timeoutHeight must be an integer after creationHeight (the refund path needs a settlement window)');
  }
  const commitment = computeCommitment({ midnightRecipient, amountNanoErg: amount, nonceHex });
  return {
    phase: 1,
    status: 'plan', // no box exists until a testnet transaction creates one
    network,
    valueNanoErg: amount.toString(),
    ergoSender,
    timeoutHeight,
    creationHeight,
    commitment,
    registers: {
      // Explorer serialized form for a Coll[Byte] constant: 0e + VLQ length (0x20 = 32) + bytes.
      R4: { type: 'Coll[Byte]', meaning: 'Blake2b-256 commitment to (recipient, amount, nonce)', valueHex: commitment, serializedValue: '0e20' + commitment },
      R5: { type: 'Int', meaning: 'refund timeout height', value: timeoutHeight },
      R6: { type: 'SigmaProp', meaning: 'sender key allowed to refund after the timeout', value: 'sender proposition (bound when the box is built on testnet)' },
    },
    guard: { status: 'draft-source-not-compiled', source: INTENT_GUARD_ERGOSCRIPT_DRAFT },
  };
}

function refundEligible(plan, currentHeight) {
  return Number.isSafeInteger(currentHeight) && currentHeight >= plan.timeoutHeight;
}
function settlementWindowOpen(plan, currentHeight) {
  return Number.isSafeInteger(currentHeight) && currentHeight < plan.timeoutHeight;
}

/* ---------------- Watcher-side box inspection ---------------- */

/*
 * inspectIntentBox(box, plan): does an explorer-shaped box actually carry
 * this plan's commitment and at least the planned value? This is the check
 * a watcher runs before attesting. It trusts nothing about the box except
 * what it reads: R4's serialized value must equal the plan's exactly and
 * the value must cover the planned amount.
 */
function inspectIntentBox(box, plan) {
  const checks = { shape: false, commitmentRegister: false, valueCovers: false };
  if (box && typeof box === 'object' && box.additionalRegisters && typeof box.additionalRegisters === 'object') {
    checks.shape = true;
    const r4 = box.additionalRegisters.R4;
    const serialized = r4 && (r4.serializedValue || r4.serialized_value);
    checks.commitmentRegister = serialized === plan.registers.R4.serializedValue;
    try {
      checks.valueCovers = BigInt(box.value) >= BigInt(plan.valueNanoErg);
    } catch {
      checks.valueCovers = false;
    }
  }
  return { matches: checks.shape && checks.commitmentRegister && checks.valueCovers, checks };
}

module.exports = {
  COMMITMENT_DOMAIN,
  INTENT_GUARD_ERGOSCRIPT_DRAFT,
  blake2b256,
  commitmentPreimage,
  computeCommitment,
  verifyCommitment,
  buildIntentBoxPlan,
  refundEligible,
  settlementWindowOpen,
  inspectIntentBox,
};
