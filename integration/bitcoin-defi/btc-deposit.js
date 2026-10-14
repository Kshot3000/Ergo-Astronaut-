'use strict';
/*
 * btc-deposit.js — Bitcoin deposit EVIDENCE verification for the native
 * Bitcoin DeFi on Ergo workstream: Phase 2's offline core, combining
 * btc-spv.js (Phase 0 inclusion proofs) and btc-chain.js (Phase 1 header
 * chains) into the single verdict an Ergo contract (or the tooling that
 * prepares its inputs) actually needs: "this Bitcoin payment is real,
 * buried under enough work, and final enough to release against."
 *
 * Neither half suffices alone. An inclusion proof against one header's
 * Merkle root says nothing about how much work backs that header — an
 * attacker can grind a lone low-difficulty header around a fake root.
 * A strong header chain says nothing about whether a given payment is
 * in any of its blocks. This module requires BOTH, plus two policy
 * gates: a confirmation depth (the payment block counts as 1, the same
 * convention the Midnight<->Ergo watcher uses) and a cumulative-work
 * floor in Bitcoin Core GetBlockProof units. A retarget inside the
 * segment that the chain verifier could not check (its period start
 * lies before the segment and was not supplied) REFUSES the evidence
 * unless the caller explicitly allows it — unverified difficulty is
 * never silently treated as verified.
 *
 * Every refusal is named by the check that failed. Malformed input
 * shapes throw (programmer error); evidence that is well-formed but
 * does not verify returns { accept: false, refusals: [...] }.
 * The evidence's lists are bounded by the layers below before any
 * hashing: the header segment by btc-chain.js's MAX_HEADERS and the
 * inclusion branch by btc-spv.js's MAX_INCLUSION_BRANCH — oversize
 * evidence throws as a shape error, exactly like a malformed one.
 * Element sizes are bounded the same way: headers and hashes are
 * length-checked before they are scanned or decoded, here and in
 * btc-spv.js, so no single oversize element is decoded in full first.
 *
 * buildDepositRecord folds an ACCEPTED verdict into a content-addressed
 * record: sha256d over the canonical v1 preimage
 *   'EBD1' || txid (internal) || payment block hash (internal)
 *        || tip hash (internal) || u32be blockHeight
 *        || u32be confirmations || cumulative work as u256be
 * pinned by an independent Python oracle (hashlib). The id binds the
 * evidence as verified — the tx, its block, the tip it was judged
 * against, its depth and the work — so a record quoted for one chain
 * tip cannot be replayed against a weaker one.
 *
 * Read-only math only. Nothing here signs, broadcasts, or custodies
 * anything, and nothing moves funds: Phase 2's on-testnet flow still
 * needs a compiled guard and Kyle's signing for any box creation.
 * Built by Kyle Cox (@kshot9000), independent builder.
 */

const crypto = require('node:crypto');
const { parseHeader, verifyInclusion } = require('./btc-spv');
const { verifyHeaderChain } = require('./btc-chain');

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

// Display-order hash hex -> internal (wire) bytes. The 32-byte size is
// judged from the string length BEFORE hexToBuf scans or decodes
// anything — the same length-before-decode rule btc-spv.js applies —
// so an oversize "hash" refuses without a proportional allocation.
function internalBytes(displayHex, what) {
  if (typeof displayHex !== 'string' || displayHex.length !== 64) {
    throw new Error((what || 'hash') + ' must be 32 bytes');
  }
  return Buffer.from(hexToBuf(displayHex, what)).reverse();
}

function u32be(n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) throw new Error('value must be a u32');
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function parseWork(value, what) {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(what + ' must be non-negative');
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    if (value < 0) throw new Error(what + ' must be non-negative');
    return BigInt(value);
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new Error(what + ' must be a BigInt, a safe integer, or a decimal string');
}

/* ---------------- Evidence id ---------------- */

function depositEvidencePreimage({ txid, paymentBlockHash, tipHash, blockHeight, confirmations, cumulativeWork }) {
  const work = parseWork(cumulativeWork, 'cumulativeWork');
  if (work >= (1n << 256n)) throw new Error('cumulativeWork must fit in 256 bits');
  return Buffer.concat([
    Buffer.from('EBD1', 'ascii'),
    internalBytes(txid, 'txid'),
    internalBytes(paymentBlockHash, 'paymentBlockHash'),
    internalBytes(tipHash, 'tipHash'),
    u32be(blockHeight),
    u32be(confirmations),
    Buffer.from(work.toString(16).padStart(64, '0'), 'hex'),
  ]);
}

function computeEvidenceId(fields) {
  return sha256d(depositEvidencePreimage(fields)).toString('hex');
}

/* ---------------- Deposit evidence verification ---------------- */

function verifyDepositEvidence(evidence, policy = {}) {
  if (!evidence || typeof evidence !== 'object') throw new Error('evidence must be an object');
  const { headersHex, startHeight = 0, periodStartTimestamp = null, payment } = evidence;
  if (!payment || typeof payment !== 'object') throw new Error('evidence.payment is required');
  const { txid, index, branch, blockHeight } = payment;
  if (typeof txid !== 'string') throw new Error('payment.txid must be a string');
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('payment.index must be a non-negative integer');
  if (!Array.isArray(branch)) throw new Error('payment.branch must be an array');
  if (!Number.isSafeInteger(blockHeight) || blockHeight < 0) {
    throw new Error('payment.blockHeight must be a non-negative integer');
  }
  const {
    minConfirmations = 1,
    minCumulativeWork = '0',
    allowUnverifiedRetargets = false,
  } = policy;
  if (!Number.isSafeInteger(minConfirmations) || minConfirmations < 1) {
    throw new Error('minConfirmations must be a positive integer');
  }
  const minWork = parseWork(minCumulativeWork, 'minCumulativeWork');
  if (typeof allowUnverifiedRetargets !== 'boolean') throw new Error('allowUnverifiedRetargets must be a boolean');

  // Throws on an empty/malformed header list — a shape error, not evidence.
  const chain = verifyHeaderChain(headersHex, { startHeight, periodStartTimestamp });
  const refusals = [];
  for (const e of chain.errors) {
    refusals.push({ check: e.check, message: 'header chain: ' + e.message });
  }
  if (!allowUnverifiedRetargets) {
    for (const h of chain.retargetsUnverified) {
      refusals.push({
        check: 'retarget-unverified',
        message: 'retarget at height ' + h + ' could not be verified (period start not supplied)',
      });
    }
  }
  const cumulativeWork = BigInt(chain.cumulativeWork);
  if (cumulativeWork < minWork) {
    refusals.push({
      check: 'cumulative-work',
      message: 'cumulative work ' + cumulativeWork.toString() + ' below required ' + minWork.toString(),
    });
  }

  let paymentBlockHash = null;
  let confirmations = null;
  const inChain = chain.tipHeight !== null && blockHeight >= startHeight && blockHeight <= chain.tipHeight;
  if (!inChain) {
    refusals.push({
      check: 'block-not-in-chain',
      message: 'payment block height ' + blockHeight + ' outside the segment ' + startHeight + '..' + chain.tipHeight,
    });
  } else {
    const header = parseHeader(headersHex[blockHeight - startHeight]);
    paymentBlockHash = header.hash;
    confirmations = chain.tipHeight - blockHeight + 1; // the payment block counts as 1
    let included = false;
    try {
      included = verifyInclusion(txid, index, branch, header.merkleRoot);
    } catch (e) {
      refusals.push({ check: 'inclusion', message: String(e.message) });
    }
    if (!included && !refusals.some((r) => r.check === 'inclusion')) {
      refusals.push({ check: 'inclusion', message: 'txid is not committed in the payment block Merkle root' });
    }
    if (confirmations < minConfirmations) {
      refusals.push({
        check: 'confirmations',
        message: 'confirmations ' + confirmations + ' below required ' + minConfirmations,
      });
    }
  }

  return {
    accept: refusals.length === 0,
    refusals,
    confirmations,
    cumulativeWork: cumulativeWork.toString(),
    tipHeight: chain.tipHeight,
    tipHash: chain.tipHash,
    paymentBlockHash,
    retargetsChecked: chain.retargetsChecked,
    retargetsUnverified: chain.retargetsUnverified,
    status: 'design', // verification math, exercised offline only; no flow is live
  };
}

function buildDepositRecord(evidence, policy = {}) {
  const verdict = verifyDepositEvidence(evidence, policy);
  if (!verdict.accept) {
    throw new Error('deposit evidence refused: ' + verdict.refusals.map((r) => r.check).join(', '));
  }
  const evidenceId = computeEvidenceId({
    txid: evidence.payment.txid,
    paymentBlockHash: verdict.paymentBlockHash,
    tipHash: verdict.tipHash,
    blockHeight: evidence.payment.blockHeight,
    confirmations: verdict.confirmations,
    cumulativeWork: verdict.cumulativeWork,
  });
  return {
    recordType: 'spv-deposit-evidence',
    evidenceId,
    txid: evidence.payment.txid.toLowerCase(),
    blockHeight: evidence.payment.blockHeight,
    paymentBlockHash: verdict.paymentBlockHash,
    tipHash: verdict.tipHash,
    confirmations: verdict.confirmations,
    cumulativeWork: verdict.cumulativeWork,
    status: 'design',
  };
}

module.exports = {
  verifyDepositEvidence,
  buildDepositRecord,
  computeEvidenceId,
  depositEvidencePreimage,
};
