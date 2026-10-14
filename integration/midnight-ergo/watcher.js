'use strict';
/*
 * watcher.js — Phase 1, step 2 of the Midnight<->Ergo integration:
 * watcher observation and attestation for Ergo testnet intent boxes.
 *
 * Step 1 (intent-box.js) defined the commitment and the box plan, and
 * inspectIntentBox() checks one box against one plan. This module is the
 * watcher layer the design doc calls for: a watcher only attests when the
 * box (a) carries the plan's commitment and value, (b) is still unspent,
 * (c) has reached an agreed confirmation depth, and (d) is still inside
 * its settlement window (before the refund timeout). Attestations are
 * content-addressed records so a claim can name exactly what was seen:
 *
 * Canonical attestation preimage v1 (pinned by an independent Python
 * oracle, hashlib.blake2b; see the tests):
 *   "EMA1" (4 ASCII bytes, domain tag)
 *   || commitment (32 raw bytes, from the plan)
 *   || boxId (32 raw bytes)
 *   || u32be(observedHeight)
 *   || u32be(confirmations = observedHeight - box.creationHeight + 1)
 * attestationId = Blake2b-256(preimage), hex.
 *
 * BOUNDS: the attestation list a quorum collection scans is untrusted
 * input, so collectAttestations caps it at MAX_ATTESTATIONS — the same
 * 10,000-entry bound audit.js imposes on the same list — and refuses
 * beyond it before hashing anything. (The later layers were hardened
 * first; this closes the same unbounded-scan hole at the layer they
 * all call into.) Scalar fields are bounded the same way:
 * verifyAttestation judges a record's id from its length before
 * lowercasing it for the comparison.
 *
 * HONEST SCOPE. An attestation here is an UNSIGNED record: it proves what
 * its fields claim only in the sense that the id recomputes from them, so
 * tampering with any field is detectable. It does not prove WHO made it —
 * watcher identity in Phase 1 is a plain id string. Cryptographic watcher
 * signatures and the guard-set federation are Phase 2 work (see README),
 * and nothing here moves funds, builds a transaction, or talks to a chain:
 * callers pass explorer-shaped boxes and heights in.
 *
 * Built by Kyle Cox (@kshot9000), independent builder.
 */

const { blake2b256, inspectIntentBox, settlementWindowOpen } = require('./intent-box');

const ATTESTATION_DOMAIN = 'EMA1'; // Ergo-Midnight Attestation, encoding v1
const DEFAULT_MIN_CONFIRMATIONS = 6;
const MAX_ATTESTATIONS = 10000; // same bound audit.js sets on this list

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

/* ---------------- Observation ---------------- */

/*
 * confirmationsFor(box, currentHeight): the depth of the box's creating
 * block at currentHeight, counting the creating block itself (a box seen
 * in the tip block has 1 confirmation). Returns 0 when the heights do not
 * describe a confirmed box (missing, non-integer, or created "in the
 * future" relative to the observed height).
 */
function confirmationsFor(box, currentHeight) {
  if (!box || !Number.isSafeInteger(box.creationHeight) || !Number.isSafeInteger(currentHeight)) return 0;
  if (currentHeight < box.creationHeight) return 0;
  return currentHeight - box.creationHeight + 1;
}

/*
 * evaluateObservation({ box, plan, currentHeight, minConfirmations }):
 * everything a watcher checks before attesting, as named checks so a
 * refusal says exactly which one failed. `attestable` is their AND.
 */
function evaluateObservation({ box, plan, currentHeight, minConfirmations = DEFAULT_MIN_CONFIRMATIONS } = {}) {
  if (!Number.isSafeInteger(minConfirmations) || minConfirmations < 1) {
    throw new Error('minConfirmations must be a positive integer');
  }
  const inspection = inspectIntentBox(box, plan);
  const confirmations = confirmationsFor(box, currentHeight);
  const checks = {
    boxMatchesPlan: inspection.matches,
    unspent: !!(box && typeof box === 'object' && !box.spentTransactionId),
    depthReached: confirmations >= minConfirmations,
    windowOpen: settlementWindowOpen(plan, currentHeight),
  };
  return {
    attestable: checks.boxMatchesPlan && checks.unspent && checks.depthReached && checks.windowOpen,
    checks,
    inspection,
    confirmations,
  };
}

/* ---------------- Attestation records ---------------- */

function attestationPreimage({ commitment, boxId, observedHeight, confirmations }) {
  if (!isHex32(commitment)) throw new Error('commitment must be 32 bytes of hex');
  if (!isHex32(boxId)) throw new Error('boxId must be 32 bytes of hex');
  if (!Number.isSafeInteger(observedHeight) || observedHeight < 0 || observedHeight > 0xffffffff) {
    throw new Error('observedHeight must be a u32 height');
  }
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 0xffffffff) {
    throw new Error('confirmations must be a positive u32');
  }
  const pre = new Uint8Array(4 + 32 + 32 + 4 + 4);
  let o = 0;
  pre.set(new TextEncoder().encode(ATTESTATION_DOMAIN), o); o += 4;
  pre.set(hexToBytes(commitment), o); o += 32;
  pre.set(hexToBytes(boxId), o); o += 32;
  const dv = new DataView(pre.buffer);
  dv.setUint32(o, observedHeight, false); o += 4;
  dv.setUint32(o, confirmations, false);
  return pre;
}

function computeAttestationId(fields) {
  return bytesToHex(blake2b256(attestationPreimage(fields)));
}

function validateWatcherId(watcherId) {
  if (typeof watcherId !== 'string' || watcherId.length === 0 || watcherId.length > 64) {
    throw new Error('watcherId must be a non-empty string of at most 64 characters');
  }
  return watcherId;
}

/*
 * buildAttestation({ watcherId, box, plan, currentHeight, minConfirmations }):
 * run the observation and, only if it is attestable, mint the record.
 * Throws with the failed check names otherwise — a watcher must never be
 * able to attest a box it could not verify.
 */
function buildAttestation({ watcherId, box, plan, currentHeight, minConfirmations = DEFAULT_MIN_CONFIRMATIONS } = {}) {
  validateWatcherId(watcherId);
  const obs = evaluateObservation({ box, plan, currentHeight, minConfirmations });
  if (!obs.attestable) {
    const failed = Object.keys(obs.checks).filter((k) => !obs.checks[k]).join(', ');
    throw new Error('box is not attestable: ' + failed);
  }
  const fields = {
    commitment: plan.commitment,
    boxId: String(box.boxId).toLowerCase(),
    observedHeight: currentHeight,
    confirmations: obs.confirmations,
  };
  return {
    version: 1,
    status: 'unsigned-phase1-record', // identity/signature layer is Phase 2
    watcherId,
    ...fields,
    attestationId: computeAttestationId(fields),
  };
}

/*
 * verifyAttestation(att): the id recomputes from the record's own fields.
 * Detects tampering with any field; says nothing about the watcher (see
 * the scope note above).
 */
function verifyAttestation(att) {
  try {
    if (!att || typeof att !== 'object' || att.version !== 1) return false;
    validateWatcherId(att.watcherId);
    // The id is judged from its length BEFORE it is lowercased for the
    // comparison: a valid id is exactly 64 hex characters, so any other
    // length can never match the recomputed id — a hostile oversize
    // "id" is refused from its length, never copied in full first
    // (a 20 MB id burned ~25 ms of lowercasing before refusing).
    if (typeof att.attestationId !== 'string' || att.attestationId.length !== 64) return false;
    return computeAttestationId(att) === att.attestationId.toLowerCase();
  } catch {
    return false;
  }
}

/* ---------------- Quorum ---------------- */

/*
 * collectAttestations(attestations, { quorum, commitment, boxId }):
 * fold a set of records into a quorum verdict for ONE intent box.
 * Records that fail verification, or that name a different commitment or
 * box than the set's first valid record (or the expected values, when
 * given), are excluded and reported in `invalid` — never silently
 * counted. A watcher attesting twice counts once; repeats are reported
 * in `duplicates`.
 */
function collectAttestations(attestations, { quorum, commitment, boxId } = {}) {
  if (!Number.isSafeInteger(quorum) || quorum < 1) throw new Error('quorum must be a positive integer');
  if (!Array.isArray(attestations)) throw new Error('attestations must be an array');
  if (attestations.length > MAX_ATTESTATIONS) {
    throw new Error('attestations exceed the ' + MAX_ATTESTATIONS + '-entry bound; refusing to scan an unbounded set');
  }
  if (commitment !== undefined && !isHex32(commitment)) throw new Error('expected commitment must be 32 bytes of hex');
  if (boxId !== undefined && !isHex32(boxId)) throw new Error('expected boxId must be 32 bytes of hex');
  const wantCommitment = commitment ? commitment.toLowerCase() : null;
  const wantBoxId = boxId ? boxId.toLowerCase() : null;
  const seen = new Set();
  const countedIds = [];
  const duplicates = [];
  const invalid = [];
  let targetCommitment = wantCommitment;
  let targetBoxId = wantBoxId;
  attestations.forEach((att, i) => {
    if (!verifyAttestation(att)) {
      invalid.push({ index: i, reason: 'attestation id does not recompute from its fields' });
      return;
    }
    const c = att.commitment.toLowerCase();
    const b = att.boxId.toLowerCase();
    if (targetCommitment === null) targetCommitment = c;
    if (targetBoxId === null) targetBoxId = b;
    if (c !== targetCommitment || b !== targetBoxId) {
      invalid.push({ index: i, reason: 'attestation names a different commitment or box' });
      return;
    }
    if (seen.has(att.watcherId)) {
      duplicates.push(att.watcherId);
      return;
    }
    seen.add(att.watcherId);
    countedIds.push(String(att.attestationId).toLowerCase());
  });
  return {
    quorumReached: seen.size >= quorum,
    distinctWatchers: seen.size,
    countedAttestationIds: countedIds.sort(),
    quorum,
    commitment: targetCommitment,
    boxId: targetBoxId,
    duplicates,
    invalid,
  };
}

module.exports = {
  ATTESTATION_DOMAIN,
  DEFAULT_MIN_CONFIRMATIONS,
  MAX_ATTESTATIONS,
  confirmationsFor,
  evaluateObservation,
  attestationPreimage,
  computeAttestationId,
  buildAttestation,
  verifyAttestation,
  collectAttestations,
};
