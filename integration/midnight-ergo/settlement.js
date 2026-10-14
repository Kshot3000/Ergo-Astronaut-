'use strict';
/*
 * settlement.js — Phase 1, step 3 of the Midnight<->Ergo integration:
 * the settlement decision for an Ergo testnet intent box.
 *
 * Step 1 (intent-box.js) defined the box and its two guard paths —
 * settle by revealing the commitment's preimage before the timeout, or
 * refund to the sender at/after it. Step 2 (watcher.js) defined when a
 * watcher attests and how attestations fold into a quorum. This module
 * is the settler's single verdict, the layer that combines them:
 *
 *   settle      — every check passes: the box carries the plan's
 *                 commitment and value, is unspent, the settlement
 *                 window is still open, a watcher quorum attested to
 *                 THIS box under THIS plan's commitment, and the
 *                 settler's revealed fields reproduce the commitment
 *                 (so the guard's blake2b256(preimage) check will pass
 *                 on chain, not just in this module).
 *   wait        — the window is open and the box is the plan's, but the
 *                 quorum has not been reached and/or the revealed
 *                 fields do not (yet) verify. `reasons` names which.
 *   refund-only — the timeout has passed: the guard's settle branch
 *                 (HEIGHT < timeout) is dead whatever the quorum or
 *                 preimage says, and the refund branch is the only
 *                 path that can ever spend the box. Using it still
 *                 needs the sender's signature — this verdict is a
 *                 fact about the box, not a transaction.
 *   reject      — the box is not the plan's box (commitment register
 *                 or value does not match), so no verdict for this
 *                 plan can ever be drawn from it.
 *   spent       — the box already has a spending transaction; neither
 *                 path can spend it again.
 *
 * A settle verdict folds into a content-addressed decision record so a
 * quoted "settle" can be rechecked against exactly the attestation set
 * it rested on:
 *
 * Canonical settlement-record preimage v1 (pinned by an independent
 * Python oracle, hashlib.blake2b; see the tests):
 *   "EMS1" (4 ASCII bytes, domain tag)
 *   || commitment (32 raw bytes, from the plan)
 *   || boxId (32 raw bytes)
 *   || u32be(decision height)
 *   || u16be(number of counted attestations)
 *   || the counted attestation ids (32 raw bytes each, sorted ascending)
 * recordId = Blake2b-256(preimage), hex. Sorting makes the record
 * independent of the order attestations arrived in; binding the height
 * means a record minted in-window cannot be replayed as a fresh
 * decision at a later height.
 *
 * BOUNDS: a settlement record is untrusted input wherever it is
 * verified (claim.js and audit.js both call verifySettlementRecord on
 * records a caller hands them), so settlementRecordPreimage refuses
 * an attestation-id list beyond MAX_ATTESTATION_IDS — the same 10,000
 * bound watcher.js and audit.js impose on the same list, and the most
 * a quorum collection can ever count — BEFORE any element is copied,
 * deduplicated or sorted, and judges each id's size from its string
 * length before lowercasing it. The u16 encoding check below stays as
 * the encoding's own guard. (Before this, the u16 bound was only
 * checked after the whole list had been mapped, deduplicated and
 * sorted, so a hostile record bypassed every caller's cap.)
 *
 * HONEST SCOPE. Like the attestation records it rests on, a decision
 * record is UNSIGNED in Phase 1 — the id binds the decision's inputs,
 * not a decider. Nothing here builds a transaction, signs, or talks to
 * a chain: callers pass explorer-shaped boxes, attestation records and
 * heights in, exactly as in the earlier steps.
 *
 * Built by Kyle Cox (@kshot9000), independent builder.
 */

const { blake2b256, inspectIntentBox, verifyCommitment, settlementWindowOpen } = require('./intent-box');
const { collectAttestations } = require('./watcher');

const SETTLEMENT_DOMAIN = 'EMS1'; // Ergo-Midnight Settlement, encoding v1
const MAX_ATTESTATION_IDS = 10000; // same bound watcher.js/audit.js set on this list

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function isHex32(s) {
  // Length judged first, in O(1): an oversize string is refused from
  // its length alone, never regex-scanned.
  return typeof s === 'string' && s.length === 64 && /^[0-9a-fA-F]{64}$/.test(s);
}

/* ---------------- Decision record ---------------- */

function settlementRecordPreimage({ commitment, boxId, decisionHeight, attestationIds }) {
  if (!isHex32(commitment)) throw new Error('commitment must be 32 bytes of hex');
  if (!isHex32(boxId)) throw new Error('boxId must be 32 bytes of hex');
  if (!Number.isSafeInteger(decisionHeight) || decisionHeight < 0 || decisionHeight > 0xffffffff) {
    throw new Error('decisionHeight must be a u32 height');
  }
  if (!Array.isArray(attestationIds) || attestationIds.length === 0) {
    throw new Error('attestationIds must be a non-empty array');
  }
  if (attestationIds.length > MAX_ATTESTATION_IDS) {
    throw new Error('attestationIds exceed the ' + MAX_ATTESTATION_IDS + '-entry bound; refusing to process an unbounded set');
  }
  for (const id of attestationIds) {
    if (typeof id !== 'string' || id.length !== 64) {
      throw new Error('attestation ids must be 32 bytes of hex');
    }
  }
  const ids = [...new Set(attestationIds.map((id) => id.toLowerCase()))].sort();
  if (ids.length > 0xffff) throw new Error('too many attestations for the u16 count');
  for (const id of ids) {
    if (!isHex32(id)) throw new Error('attestation ids must be 32 bytes of hex');
  }
  const pre = new Uint8Array(4 + 32 + 32 + 4 + 2 + ids.length * 32);
  let o = 0;
  pre.set(new TextEncoder().encode(SETTLEMENT_DOMAIN), o); o += 4;
  pre.set(hexToBytes(commitment), o); o += 32;
  pre.set(hexToBytes(boxId), o); o += 32;
  const dv = new DataView(pre.buffer);
  dv.setUint32(o, decisionHeight, false); o += 4;
  dv.setUint16(o, ids.length, false); o += 2;
  for (const id of ids) {
    pre.set(hexToBytes(id), o); o += 32;
  }
  return pre;
}

function computeSettlementRecordId(fields) {
  return bytesToHex(blake2b256(settlementRecordPreimage(fields)));
}

/* ---------------- The decision ---------------- */

/*
 * decideSettlement({ box, plan, attestations, quorum, reveal, currentHeight }):
 * `reveal` is the settler's { midnightRecipient, amountNanoErg, nonceHex }
 * — the fields whose canonical preimage the guard will hash. The verdict
 * is 'settle' only when verifyCommitment reproduces the plan's
 * commitment from them; a settler who cannot reveal the preimage can
 * never settle, whatever the quorum says, so that check is not optional.
 */
function decideSettlement({ box, plan, attestations, quorum, reveal, currentHeight } = {}) {
  if (!Number.isSafeInteger(quorum) || quorum < 1) throw new Error('quorum must be a positive integer');
  if (!Number.isSafeInteger(currentHeight) || currentHeight < 0) {
    throw new Error('currentHeight must be a non-negative integer');
  }
  if (!plan || typeof plan !== 'object' || !isHex32(plan.commitment)) {
    throw new Error('plan must be an intent-box plan (with a commitment)');
  }
  const boxIsObject = !!(box && typeof box === 'object');
  const inspection = inspectIntentBox(box, plan);
  const spent = boxIsObject && !!box.spentTransactionId;
  const windowOpen = settlementWindowOpen(plan, currentHeight);
  let quorumResult = null;
  if (boxIsObject && isHex32(box.boxId)) {
    quorumResult = collectAttestations(Array.isArray(attestations) ? attestations : [], {
      quorum, commitment: plan.commitment, boxId: box.boxId,
    });
  }
  const preimageVerified = reveal ? verifyCommitment(plan.commitment, reveal) : false;
  const checks = {
    boxMatchesPlan: inspection.matches,
    unspent: boxIsObject && !spent,
    windowOpen,
    quorumReached: !!(quorumResult && quorumResult.quorumReached),
    preimageVerified,
  };
  const reasons = [];
  let verdict;
  if (spent) {
    verdict = 'spent';
    reasons.push('box-spent');
  } else if (!checks.boxMatchesPlan) {
    verdict = 'reject';
    reasons.push('box-does-not-match-plan');
  } else if (!windowOpen) {
    verdict = 'refund-only';
    reasons.push('settlement-window-closed');
  } else if (!checks.quorumReached || !checks.preimageVerified) {
    verdict = 'wait';
    if (!checks.quorumReached) reasons.push('quorum-not-reached');
    if (!checks.preimageVerified) reasons.push(reveal ? 'preimage-does-not-verify' : 'preimage-not-revealed');
  } else {
    verdict = 'settle';
  }
  let record = null;
  if (verdict === 'settle') {
    const fields = {
      commitment: plan.commitment,
      boxId: String(box.boxId).toLowerCase(),
      decisionHeight: currentHeight,
      attestationIds: quorumResult.countedAttestationIds,
    };
    record = {
      version: 1,
      status: 'unsigned-phase1-record', // identity/signature layer is Phase 2
      ...fields,
      recordId: computeSettlementRecordId(fields),
    };
  }
  return { verdict, checks, reasons, inspection, quorum: quorumResult, record };
}

/*
 * verifySettlementRecord(record): the id recomputes from the record's
 * own fields. Detects tampering with any field; says nothing about who
 * made the decision (see the scope note above).
 */
function verifySettlementRecord(record) {
  try {
    if (!record || typeof record !== 'object' || record.version !== 1) return false;
    return computeSettlementRecordId(record) === String(record.recordId).toLowerCase();
  } catch {
    return false;
  }
}

module.exports = {
  SETTLEMENT_DOMAIN,
  MAX_ATTESTATION_IDS,
  settlementRecordPreimage,
  computeSettlementRecordId,
  decideSettlement,
  verifySettlementRecord,
};
