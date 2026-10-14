'use strict';
/*
 * claim.js — Phase 1, step 4 of the Midnight<->Ergo integration: the
 * Midnight-side claim for a settled Ergo testnet intent box.
 *
 * Steps 1–3 built the Ergo side: a commitment in a testnet box
 * (intent-box.js), watcher attestations (watcher.js), and the
 * settler's single verdict with its content-addressed decision record
 * (settlement.js). This module is the other end of the route — what a
 * claimant presents on the Midnight side, and what the (future,
 * Preprod) claim contract will check before it marks an intent
 * claimed:
 *
 *   claimable       — the settlement record verifies from its own
 *                     fields, the claimant's revealed fields reproduce
 *                     the record's commitment (so the claim names
 *                     exactly the committed recipient, amount and
 *                     nonce — nobody can redirect a settled intent to
 *                     a different recipient), and this claim has not
 *                     already been made.
 *   reject          — the settlement record does not verify, or no
 *                     fields were revealed, or the revealed fields do
 *                     not reproduce the commitment. Named in `reasons`.
 *   already-claimed — everything verifies, but the claim id (or the
 *                     settlement record it rests on) is already in the
 *                     caller's claimed set: a settle decision funds
 *                     exactly ONE claim, so a replayed record can
 *                     never mint a second one.
 *
 * A claim folds into a content-addressed payload so both sides can
 * name exactly the claim they mean:
 *
 * Canonical claim preimage v1 (pinned by an independent Python
 * oracle, hashlib.blake2b; see the tests):
 *   "EMC1" (4 ASCII bytes, domain tag)
 *   || commitment (32 raw bytes, from the settlement record)
 *   || boxId (32 raw bytes, from the settlement record)
 *   || settlementRecordId (32 raw bytes)
 *   || u32be(byte length of the recipient's UTF-8 encoding)
 *   || recipient UTF-8 bytes
 *   || u64be(amount in nanoERG)
 *   || nonce (exactly 32 bytes)
 * claimId = Blake2b-256(preimage), hex. The recipient and amount are
 * bound twice over — once inside the commitment, once in plain fields
 * here — so a claim can be checked for "pays the committed recipient
 * the committed amount" without re-deriving the commitment first.
 *
 * BOUNDS (the claim path is exactly where untrusted records arrive,
 * so every input is bounded before it is hashed or scanned): the
 * recipient is a Bech32m string, so its UTF-8 length is capped at
 * 200 bytes (decodeBech32m's own bound); amounts are confined to the
 * u64 the encoding carries; the claimed set a verdict scans is capped
 * at MAX_CLAIMED_ENTRIES — an unbounded caller-supplied list is
 * refused, never scanned.
 *
 * HONEST SCOPE. Like the records beneath it, a claim payload is
 * UNSIGNED in Phase 1 — the id binds the claim's inputs, not a
 * claimant. Nothing here builds a Compact contract call, a
 * transaction, or talks to a chain: the compiled Preprod claim
 * contract that will consume this payload is the next Phase 1 step,
 * and until then the payload is the contract's checked input format,
 * verified offline. The claimed set is the CALLER's (the contract's
 * claimed-intent set on chain later); this module only defines how a
 * claim is checked against it.
 *
 * Built by Kyle Cox (@kshot9000), independent builder.
 */

const { blake2b256, verifyCommitment } = require('./intent-box');
const { verifySettlementRecord } = require('./settlement');

const CLAIM_DOMAIN = 'EMC1'; // Ergo-Midnight Claim, encoding v1
const MAX_RECIPIENT_BYTES = 200; // Bech32m bound (see dual-chain decodeBech32m)
const MAX_CLAIMED_ENTRIES = 10000;
const U64_MAX = (1n << 64n) - 1n;

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function isHex32(s) {
  return typeof s === 'string' && s.length === 64 && /^[0-9a-fA-F]{64}$/.test(s); // length first, O(1) refusal for oversize
}

/* Validate the revealed fields once; returns the amount as BigInt. */
function validateReveal(reveal) {
  if (!reveal || typeof reveal !== 'object') throw new Error('reveal fields are required');
  const { midnightRecipient, amountNanoErg, nonceHex } = reveal;
  if (typeof midnightRecipient !== 'string' || midnightRecipient.length === 0) {
    throw new Error('midnightRecipient must be a non-empty string');
  }
  if (new TextEncoder().encode(midnightRecipient).length > MAX_RECIPIENT_BYTES) {
    throw new Error('midnightRecipient exceeds the 200-byte Bech32m bound');
  }
  if (typeof amountNanoErg !== 'bigint' && !(typeof amountNanoErg === 'number' && Number.isSafeInteger(amountNanoErg))) {
    throw new Error('amountNanoErg must be a BigInt or a safe integer');
  }
  const amount = BigInt(amountNanoErg);
  if (amount <= 0n) throw new Error('amountNanoErg must be positive');
  if (amount > U64_MAX) throw new Error('amountNanoErg exceeds the u64 the claim encoding carries');
  if (typeof nonceHex !== 'string' || nonceHex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(nonceHex)) {
    throw new Error('nonceHex must be exactly 32 bytes of hex (64 characters)');
  }
  return amount;
}

/* ---------------- Claim payload ---------------- */

function claimPreimage({ commitment, boxId, settlementRecordId, midnightRecipient, amountNanoErg, nonceHex }) {
  if (!isHex32(commitment)) throw new Error('commitment must be 32 bytes of hex');
  if (!isHex32(boxId)) throw new Error('boxId must be 32 bytes of hex');
  if (!isHex32(settlementRecordId)) throw new Error('settlementRecordId must be 32 bytes of hex');
  const amount = validateReveal({ midnightRecipient, amountNanoErg, nonceHex });
  const recipientBytes = new TextEncoder().encode(midnightRecipient);
  const pre = new Uint8Array(4 + 32 + 32 + 32 + 4 + recipientBytes.length + 8 + 32);
  let o = 0;
  pre.set(new TextEncoder().encode(CLAIM_DOMAIN), o); o += 4;
  pre.set(hexToBytes(commitment), o); o += 32;
  pre.set(hexToBytes(boxId), o); o += 32;
  pre.set(hexToBytes(settlementRecordId), o); o += 32;
  const dv = new DataView(pre.buffer);
  dv.setUint32(o, recipientBytes.length, false); o += 4;
  pre.set(recipientBytes, o); o += recipientBytes.length;
  dv.setBigUint64(o, amount, false); o += 8;
  pre.set(hexToBytes(nonceHex), o);
  return pre;
}

function computeClaimId(fields) {
  return bytesToHex(blake2b256(claimPreimage(fields)));
}

/*
 * buildClaimPayload({ record, reveal }): mint the payload, but only
 * for a claim that could actually be made — a settlement record that
 * verifies AND a reveal that reproduces its commitment. Throws with
 * the failed check named otherwise (mirrors buildAttestation: the
 * layer below must never mint a record it could not verify).
 */
function buildClaimPayload({ record, reveal } = {}) {
  if (!verifySettlementRecord(record)) {
    throw new Error('settlement record does not verify: settlement-record-invalid');
  }
  if (!reveal) throw new Error('no fields revealed: preimage-not-revealed');
  if (!verifyCommitment(record.commitment, reveal)) {
    throw new Error('revealed fields do not reproduce the commitment: preimage-does-not-verify');
  }
  const amount = validateReveal(reveal);
  const fields = {
    commitment: String(record.commitment).toLowerCase(),
    boxId: String(record.boxId).toLowerCase(),
    settlementRecordId: String(record.recordId).toLowerCase(),
    midnightRecipient: reveal.midnightRecipient,
    amountNanoErg: amount.toString(),
    nonceHex: String(reveal.nonceHex).toLowerCase(),
  };
  return {
    version: 1,
    status: 'unsigned-phase1-claim', // identity/signature layer is Phase 2
    ...fields,
    claimId: computeClaimId({ ...fields, amountNanoErg: amount }),
  };
}

/*
 * verifyClaimPayload(payload): the id recomputes from the payload's
 * own fields AND the payload's revealed fields reproduce its
 * commitment. Either check alone is weaker: the id alone would let a
 * payload carry a recipient the commitment never named, and the
 * commitment alone would let the id be quoted for other fields.
 */
function verifyClaimPayload(payload) {
  try {
    if (!payload || typeof payload !== 'object' || payload.version !== 1) return false;
    const amount = validateReveal({
      midnightRecipient: payload.midnightRecipient,
      amountNanoErg: BigInt(payload.amountNanoErg),
      nonceHex: payload.nonceHex,
    });
    if (amount.toString() !== String(payload.amountNanoErg)) return false;
    const idOk = computeClaimId({ ...payload, amountNanoErg: amount }) === String(payload.claimId).toLowerCase();
    const commitmentOk = verifyCommitment(payload.commitment, {
      midnightRecipient: payload.midnightRecipient,
      amountNanoErg: amount,
      nonceHex: payload.nonceHex,
    });
    return idOk && commitmentOk;
  } catch {
    return false;
  }
}

/* ---------------- The claim verdict ---------------- */

/*
 * evaluateClaim({ record, reveal, claimed }): the claim contract's
 * single verdict, judged exactly as verifyClaimPayload judges.
 * `claimed` is the caller's set of claims already made — an array of
 * claim payloads and/or bare claim ids; a claim is a replay when its
 * claimId is present OR when any prior claim rests on the same
 * settlement record (one settle funds one claim, so a second payload
 * quoting the same record is a replay even if its id differed).
 */
function evaluateClaim({ record, reveal, claimed = [] } = {}) {
  if (!Array.isArray(claimed)) throw new Error('claimed must be an array');
  if (claimed.length > MAX_CLAIMED_ENTRIES) {
    throw new Error('claimed set exceeds the ' + MAX_CLAIMED_ENTRIES + '-entry bound; refusing to scan an unbounded set');
  }
  const recordValid = verifySettlementRecord(record);
  const revealed = !!reveal;
  const preimageVerified = recordValid && revealed ? verifyCommitment(record.commitment, reveal) : false;
  let claim = null;
  if (recordValid && preimageVerified) {
    claim = buildClaimPayload({ record, reveal });
  }
  let alreadyClaimed = false;
  if (claim) {
    for (const entry of claimed) {
      if (!entry) continue;
      if (typeof entry === 'string') {
        if (entry.toLowerCase() === claim.claimId) { alreadyClaimed = true; break; }
      } else if (typeof entry === 'object') {
        if (String(entry.claimId || '').toLowerCase() === claim.claimId) { alreadyClaimed = true; break; }
        if (String(entry.settlementRecordId || '').toLowerCase() === claim.settlementRecordId) { alreadyClaimed = true; break; }
      }
    }
  }
  const checks = {
    settlementRecordValid: recordValid,
    preimageVerified,
    notAlreadyClaimed: claim !== null && !alreadyClaimed,
  };
  const reasons = [];
  let verdict;
  if (!recordValid) {
    verdict = 'reject';
    reasons.push('settlement-record-invalid');
  } else if (!preimageVerified) {
    verdict = 'reject';
    reasons.push(revealed ? 'preimage-does-not-verify' : 'preimage-not-revealed');
  } else if (alreadyClaimed) {
    verdict = 'already-claimed';
    reasons.push('settlement-already-claimed');
  } else {
    verdict = 'claimable';
  }
  return { verdict, checks, reasons, claim: verdict === 'claimable' ? claim : null, candidateClaimId: claim ? claim.claimId : null };
}

module.exports = {
  CLAIM_DOMAIN,
  MAX_RECIPIENT_BYTES,
  MAX_CLAIMED_ENTRIES,
  claimPreimage,
  computeClaimId,
  buildClaimPayload,
  verifyClaimPayload,
  evaluateClaim,
};
