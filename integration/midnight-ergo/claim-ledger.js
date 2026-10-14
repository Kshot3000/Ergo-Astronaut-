'use strict';
/*
 * claim-ledger.js — Phase 1, step 5 of the Midnight<->Ergo
 * integration: the tamper-evident claim ledger for settled intents.
 *
 * Step 4 (claim.js) defined a claim payload and a verdict judged
 * against "the caller's claimed set" — but a bare array is not a set
 * anyone can trust: drop one entry from it and the same settlement
 * can be claimed a second time, with nothing in the array itself
 * showing that anything was removed. This module is the claimed set
 * as the future Preprod claim contract will hold it: an append-only,
 * hash-chained ledger where every entry commits to the whole history
 * before it.
 *
 * Canonical ledger-entry preimage v1 (pinned by an independent Python
 * oracle, hashlib.blake2b; see the tests):
 *   "EML1" (4 ASCII bytes, domain tag)
 *   || prevHead (32 raw bytes; the previous entry's id, or 32 zero
 *      bytes — the genesis head — for entry 0)
 *   || claimId (32 raw bytes, from the claim payload)
 *   || settlementRecordId (32 raw bytes, from the claim payload)
 *   || u32be(seq, the entry's index in the ledger)
 * entryId = Blake2b-256(preimage), hex. The ledger HEAD is the last
 * entry's id (the genesis head when empty): because each entry binds
 * its predecessor, the head is a content-addressed snapshot of the
 * entire ordered history — quoting one head commits to every claim
 * in it, in order. Deleting a middle entry, reordering two entries,
 * or editing any carried id breaks the chain at a named check.
 *
 * The chain alone is not enough: an attacker who recomputes a fresh,
 * correctly-chained entry for an ALREADY-claimed settlement produces
 * a chain that verifies link-by-link, so verification also enforces
 * the step-4 rule structurally — no claimId repeats, and no
 * settlementRecordId repeats (one settle funds exactly one claim).
 *
 * GATES AND BOUNDS (this ledger is exactly where untrusted claim
 * records arrive, so every input is bounded before it is hashed or
 * scanned): appendClaim refuses to extend a ledger that does not
 * itself verify, refuses any payload verifyClaimPayload rejects, and
 * refuses duplicates; the ledger is capped at MAX_LEDGER_ENTRIES —
 * an over-bound ledger is refused, never scanned or extended.
 *
 * HONEST SCOPE. Like every record beneath it, a ledger entry is
 * UNSIGNED in Phase 1 — the id binds the entry's position and inputs,
 * not a writer. Nothing here builds a Compact contract call, a
 * transaction, or talks to a chain: this is the checked model of the
 * contract's claimed-set state, verified offline, that the Preprod
 * contract's transitions will mirror.
 *
 * Built by Kyle Cox (@kshot9000), independent builder.
 */

const { blake2b256 } = require('./intent-box');
const { verifyClaimPayload } = require('./claim');

const LEDGER_DOMAIN = 'EML1'; // Ergo-Midnight Ledger, encoding v1
const GENESIS_HEAD = '00'.repeat(32);
const MAX_LEDGER_ENTRIES = 10000;

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function isHex32(s) {
  return typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);
}

/* ---------------- Ledger entry ---------------- */

function ledgerEntryPreimage({ prevHead, claimId, settlementRecordId, seq }) {
  if (!isHex32(prevHead)) throw new Error('prevHead must be 32 bytes of hex');
  if (!isHex32(claimId)) throw new Error('claimId must be 32 bytes of hex');
  if (!isHex32(settlementRecordId)) throw new Error('settlementRecordId must be 32 bytes of hex');
  if (!Number.isSafeInteger(seq) || seq < 0 || seq > 0xffffffff) {
    throw new Error('seq must be a u32 entry index');
  }
  const pre = new Uint8Array(4 + 32 + 32 + 32 + 4);
  let o = 0;
  pre.set(new TextEncoder().encode(LEDGER_DOMAIN), o); o += 4;
  pre.set(hexToBytes(prevHead), o); o += 32;
  pre.set(hexToBytes(claimId), o); o += 32;
  pre.set(hexToBytes(settlementRecordId), o); o += 32;
  new DataView(pre.buffer).setUint32(o, seq, false);
  return pre;
}

function computeLedgerEntryId(fields) {
  return bytesToHex(blake2b256(ledgerEntryPreimage(fields)));
}

/*
 * buildLedgerEntry({ prevHead, seq, claim }): the pure mint — folds a
 * claim payload's ids into the next entry. It does NOT check the
 * payload or the chain (appendClaim and verifyLedger are the gates);
 * it exists so a verifier can recompute exactly what a minter made.
 */
function buildLedgerEntry({ prevHead, seq, claim } = {}) {
  if (!claim || typeof claim !== 'object') throw new Error('claim payload is required');
  const fields = {
    prevHead: String(prevHead).toLowerCase(),
    claimId: String(claim.claimId || '').toLowerCase(),
    settlementRecordId: String(claim.settlementRecordId || '').toLowerCase(),
    seq,
  };
  return {
    version: 1,
    status: 'unsigned-phase1-ledger-entry', // identity/signature layer is Phase 2
    ...fields,
    entryId: computeLedgerEntryId(fields),
  };
}

/* ---------------- Verification ---------------- */

/*
 * verifyLedger(entries): the whole chain, judged entry by entry.
 * Returns { valid, head, count, failures } — failures names each
 * broken check ('seq-mismatch', 'prev-head-mismatch',
 * 'entry-id-mismatch', 'duplicate-claim', 'duplicate-settlement',
 * 'malformed-entry'); head is the last entry's id when the chain is
 * intact up to that point, and the genesis head for an empty ledger.
 * An over-bound ledger is reported, never scanned entry-by-entry
 * beyond the bound check itself.
 */
function verifyLedger(entries) {
  if (!Array.isArray(entries)) {
    return { valid: false, head: GENESIS_HEAD, count: 0, failures: ['ledger-not-an-array'] };
  }
  if (entries.length > MAX_LEDGER_ENTRIES) {
    return { valid: false, head: GENESIS_HEAD, count: entries.length, failures: ['ledger-exceeds-bound'] };
  }
  const failures = [];
  const seenClaims = new Set();
  const seenSettlements = new Set();
  let expectedPrev = GENESIS_HEAD;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== 'object' || e.version !== 1 || !isHex32(e.prevHead) ||
        !isHex32(e.claimId) || !isHex32(e.settlementRecordId) || !isHex32(e.entryId)) {
      failures.push('malformed-entry');
      break; // nothing past a malformed entry can be chained to
    }
    if (e.seq !== i) failures.push('seq-mismatch');
    if (String(e.prevHead).toLowerCase() !== expectedPrev) failures.push('prev-head-mismatch');
    let recomputed = null;
    try {
      recomputed = computeLedgerEntryId(e);
    } catch {
      recomputed = null;
    }
    if (recomputed !== String(e.entryId).toLowerCase()) failures.push('entry-id-mismatch');
    const cid = String(e.claimId).toLowerCase();
    const sid = String(e.settlementRecordId).toLowerCase();
    if (seenClaims.has(cid)) failures.push('duplicate-claim');
    if (seenSettlements.has(sid)) failures.push('duplicate-settlement');
    seenClaims.add(cid);
    seenSettlements.add(sid);
    expectedPrev = String(e.entryId).toLowerCase();
  }
  return {
    valid: failures.length === 0,
    head: entries.length === 0 ? GENESIS_HEAD : expectedPrev,
    count: entries.length,
    failures,
  };
}

function ledgerHead(entries) {
  const v = verifyLedger(entries);
  if (!v.valid) throw new Error('ledger does not verify: ' + v.failures[0]);
  return v.head;
}

/* ---------------- The append gate ---------------- */

/*
 * appendClaim(entries, claim): the only way a claim enters the
 * ledger. Refuses, with the failed check named, when the existing
 * ledger does not verify, when the ledger is already at the bound,
 * when the payload does not verify under step 4's own checks, or
 * when the claim — or ANY claim resting on the same settlement —
 * is already in the ledger. Returns the new entry; the caller adds
 * it (this module never mutates the caller's array).
 */
function appendClaim(entries, claim) {
  if (!Array.isArray(entries)) throw new Error('entries must be an array');
  if (entries.length >= MAX_LEDGER_ENTRIES) {
    throw new Error('ledger is at the ' + MAX_LEDGER_ENTRIES + '-entry bound; refusing to extend it');
  }
  const v = verifyLedger(entries);
  if (!v.valid) throw new Error('ledger does not verify: ' + v.failures[0]);
  if (!verifyClaimPayload(claim)) {
    throw new Error('claim payload does not verify: claim-payload-invalid');
  }
  const cid = String(claim.claimId).toLowerCase();
  const sid = String(claim.settlementRecordId).toLowerCase();
  for (const e of entries) {
    if (String(e.claimId).toLowerCase() === cid) {
      throw new Error('claim is already in the ledger: duplicate-claim');
    }
    if (String(e.settlementRecordId).toLowerCase() === sid) {
      throw new Error('settlement is already claimed in the ledger: duplicate-settlement');
    }
  }
  return buildLedgerEntry({ prevHead: v.head, seq: entries.length, claim });
}

/* ---------------- Reads against the ledger ---------------- */

/*
 * isClaimedInLedger(entries, { claimId, settlementRecordId }): the
 * replay question, answered from a ledger that must itself verify —
 * a broken ledger answers nothing (it throws), because a "not
 * claimed" read from a tampered history is exactly the replay this
 * module exists to stop.
 */
function isClaimedInLedger(entries, query = {}) {
  const head = ledgerHead(entries); // throws when the ledger does not verify
  void head;
  const cid = query.claimId ? String(query.claimId).toLowerCase() : null;
  const sid = query.settlementRecordId ? String(query.settlementRecordId).toLowerCase() : null;
  if (!cid && !sid) throw new Error('query must name a claimId or a settlementRecordId');
  return entries.some((e) =>
    (cid && String(e.claimId).toLowerCase() === cid) ||
    (sid && String(e.settlementRecordId).toLowerCase() === sid));
}

/*
 * claimedSetFromLedger(entries): the ledger in the shape claim.js's
 * evaluateClaim scans — so a claim verdict can be judged against the
 * chained history instead of a bare caller array, and anything the
 * ledger proves was claimed stays claimed.
 */
function claimedSetFromLedger(entries) {
  ledgerHead(entries); // throws when the ledger does not verify
  return entries.map((e) => ({
    claimId: String(e.claimId).toLowerCase(),
    settlementRecordId: String(e.settlementRecordId).toLowerCase(),
  }));
}

module.exports = {
  LEDGER_DOMAIN,
  GENESIS_HEAD,
  MAX_LEDGER_ENTRIES,
  ledgerEntryPreimage,
  computeLedgerEntryId,
  buildLedgerEntry,
  verifyLedger,
  ledgerHead,
  appendClaim,
  isClaimedInLedger,
  claimedSetFromLedger,
};
