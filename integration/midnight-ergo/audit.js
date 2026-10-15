'use strict';
/*
 * audit.js — Phase 1, step 6 of the Midnight<->Ergo integration:
 * the independent end-to-end audit of one settled-and-claimed intent.
 *
 * Steps 1–5 each verify their own layer, but every layer's verdict
 * rests on artifacts the caller hands it — a settler could be shown
 * a claim that verifies (step 4) against a settlement record that
 * verifies (step 3), while the record was minted for a DIFFERENT box
 * than the one the watchers attested, or the ledger quietly omits
 * the claim the bundle presents. Nobody re-checked the whole chain
 * as one history. This module is that check — the audit a third
 * party (a guard-set member, a recipient, a reviewer) runs over a
 * complete bundle before trusting that a claim was earned:
 *
 *   plan -> box -> attestations -> settlement record -> claim -> ledger
 *
 * The audit TRUSTS NOTHING in the bundle. It recomputes every link
 * from the raw artifacts underneath it:
 *   1. the reveal reproduces the plan's commitment (step 1's check),
 *      and the plan is a testnet plan (Phase 1 moves zero real value);
 *   2. the box really carries the plan's commitment and at least the
 *      planned value, and is unspent (the watchers' own inspection);
 *   3. every attestation recomputes from its own fields, all of them
 *      name THIS box under THIS commitment, and a quorum of distinct
 *      watchers is reached (step 2's collection — duplicates and
 *      tampered records never count);
 *   4. the settlement record recomputes from its own fields, names
 *      this plan's commitment and this box, was decided strictly
 *      inside the settlement window, binds EXACTLY the attestation
 *      set the audit itself counted in (3), and re-running the
 *      settler's decision from the raw artifacts at the record's own
 *      decision height reproduces the same settle verdict and the
 *      same record id — a record cannot rest on a verdict the
 *      settler would not reach again;
 *   5. the claim payload recomputes from its own fields, its revealed
 *      fields reproduce the commitment, and it is EXACTLY the payload
 *      the claim layer mints for this record and reveal — not a
 *      near-miss quoting the settlement under other fields;
 *   6. the ledger verifies end-to-end (step 5's chained history) and
 *      actually contains this claim resting on this settlement — a
 *      claim absent from the chained history was never recorded,
 *      however well it verifies alone.
 * Every failed link is named in `failures`; the audit reports ALL
 * broken links it can still check, not just the first, so a bundle
 * cannot be repaired one refusal at a time by trial and error.
 *
 * A passing audit folds into a content-addressed audit id — the
 * fingerprint anyone can quote for exactly this history:
 *   "EAU1" (4 ASCII bytes, domain tag)
 *   || commitment (32 raw bytes) || boxId (32 raw bytes)
 *   || settlementRecordId (32 raw bytes) || claimId (32 raw bytes)
 *   || ledgerHead (32 raw bytes)
 * auditId = Blake2b-256(preimage), hex — pinned by an independent
 * Python oracle (hashlib.blake2b; see the tests), whose recomputation
 * of the whole EMI1->EMA1->EMS1->EMC1->EML1 chain agrees with the
 * values pinned in the earlier steps' tests. The ledger head is
 * inside the fingerprint, so the same claim audited against a longer
 * (or different) history is a different audit.
 *
 * BOUNDS: the bundle is untrusted input, so the attestation list is
 * capped at MAX_ATTESTATIONS and refused beyond it (never scanned
 * without limit); the ledger carries step 5's own bound; and the
 * claim/record ids the ledger scan compares are length-judged and
 * lowercased once, before the scan, never once per ledger entry.
 *
 * HONEST SCOPE. Like every record beneath it, an audit is UNSIGNED
 * in Phase 1 — the audit id binds the history audited, not an
 * auditor. Nothing here builds a contract call, a transaction, or
 * talks to a chain: it is an offline recomputation over artifacts
 * the caller supplies, and its verdict is only as good as the
 * artifacts' provenance — where the box and attestations actually
 * came from (a real explorer, real watchers) is the caller's chain
 * of custody, not something a hash can prove.
 *
 * Built by Kyle Cox (@kshot9000), independent builder.
 */

const { blake2b256, verifyCommitment, inspectIntentBox } = require('./intent-box');
const { verifyAttestation, collectAttestations } = require('./watcher');
const { decideSettlement, verifySettlementRecord } = require('./settlement');
const { buildClaimPayload, verifyClaimPayload } = require('./claim');
const { verifyLedger } = require('./claim-ledger');

const AUDIT_DOMAIN = 'EAU1'; // Ergo-Midnight aUdit, encoding v1
const MAX_ATTESTATIONS = 10000;

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
/*
 * An id in the shape the ledger scan compares: lowercased only when
 * it is a string of exactly 64 characters — the length of every
 * verified ledger entry id, so any other length can never match one
 * and is a plain miss (null), judged from its length instead of
 * being copied in full by toLowerCase(). The value is never coerced
 * with String() first: an id that is not a string is a miss by its
 * type, and coercing an arbitrary hostile value can itself throw
 * (a null-prototype object, an object with a throwing toString) —
 * which would crash the one function in this layer that promises
 * never to throw on a malformed bundle.
 */
function idForCompare(v) {
  return typeof v === 'string' && v.length === 64 ? v.toLowerCase() : null;
}
function sameIdSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sa = a.map((x) => String(x).toLowerCase()).sort();
  const sb = b.map((x) => String(x).toLowerCase()).sort();
  return sa.every((x, i) => x === sb[i]);
}

/* ---------------- Audit id ---------------- */

function auditPreimage({ commitment, boxId, settlementRecordId, claimId, ledgerHead }) {
  for (const [name, v] of Object.entries({ commitment, boxId, settlementRecordId, claimId, ledgerHead })) {
    if (!isHex32(v)) throw new Error(name + ' must be 32 bytes of hex');
  }
  const pre = new Uint8Array(4 + 32 * 5);
  let o = 0;
  pre.set(new TextEncoder().encode(AUDIT_DOMAIN), o); o += 4;
  for (const v of [commitment, boxId, settlementRecordId, claimId, ledgerHead]) {
    pre.set(hexToBytes(v), o); o += 32;
  }
  return pre;
}

function computeAuditId(fields) {
  return bytesToHex(blake2b256(auditPreimage(fields)));
}

/* ---------------- The audit ---------------- */

/*
 * auditBundle({ plan, box, attestations, quorum, reveal,
 *               settlementRecord, claim, ledger }):
 * the third party's single verdict over one claimed intent.
 * Returns { verdict: 'audited' | 'failed', failures, checks,
 *           auditId, ledgerHead, claimId, settlementRecordId } —
 * auditId is null unless every link held; checks names each link's
 * outcome so a reader can see how far the history got. Malformed
 * input is a failed audit with the shape named, never a throw: an
 * auditor is handed hostile bundles and must answer, not crash.
 */
function auditBundle(bundle = {}) {
  const failures = [];
  const checks = {
    planTestnet: false,
    commitmentReproduced: false,
    boxMatchesPlan: false,
    boxUnspent: false,
    attestationsVerify: false,
    quorumReached: false,
    settlementRecordValid: false,
    settlementBindsBoxAndPlan: false,
    settlementInWindow: false,
    settlementBindsCountedAttestations: false,
    settlementReproduced: false,
    claimPayloadValid: false,
    claimBindsSettlement: false,
    claimIsCanonical: false,
    ledgerValid: false,
    claimInLedger: false,
  };
  const fail = (name) => { if (!failures.includes(name)) failures.push(name); };
  const done = (extra = {}) => ({
    verdict: failures.length === 0 ? 'audited' : 'failed',
    status: 'unsigned-phase1-audit', // identity/signature layer is Phase 2
    failures,
    checks,
    auditId: null,
    ledgerHead: null,
    claimId: null,
    settlementRecordId: null,
    ...extra,
  });

  if (!bundle || typeof bundle !== 'object') { fail('bundle-malformed'); return done(); }
  const { plan, box, attestations, quorum, reveal, settlementRecord, claim, ledger } = bundle;

  /* Link 1 — the plan and its commitment */
  const planOk = !!(plan && typeof plan === 'object' && isHex32(plan.commitment) &&
    plan.registers && plan.registers.R4 && typeof plan.timeoutHeight === 'number');
  if (!planOk) { fail('plan-malformed'); return done(); }
  checks.planTestnet = plan.network === 'testnet';
  if (!checks.planTestnet) fail('plan-not-testnet');
  if (!reveal) fail('reveal-missing');
  else {
    checks.commitmentReproduced = verifyCommitment(plan.commitment, reveal);
    if (!checks.commitmentReproduced) fail('commitment-mismatch');
  }

  /* Link 2 — the box */
  const boxOk = !!(box && typeof box === 'object' && isHex32(box.boxId));
  if (!boxOk) { fail('box-malformed'); return done(); }
  const inspection = inspectIntentBox(box, plan);
  checks.boxMatchesPlan = inspection.matches;
  if (!checks.boxMatchesPlan) fail('box-does-not-match-plan');
  checks.boxUnspent = !box.spentTransactionId;
  if (!checks.boxUnspent) fail('box-spent');

  /* Link 3 — the attestations and their quorum */
  if (!Array.isArray(attestations)) { fail('attestations-malformed'); return done(); }
  if (attestations.length > MAX_ATTESTATIONS) { fail('attestations-exceed-bound'); return done(); }
  if (!Number.isSafeInteger(quorum) || quorum < 1) { fail('quorum-malformed'); return done(); }
  checks.attestationsVerify = attestations.every((a) => verifyAttestation(a));
  if (!checks.attestationsVerify) fail('attestation-invalid');
  let collection = null;
  try {
    collection = collectAttestations(attestations, {
      quorum, commitment: plan.commitment, boxId: box.boxId,
    });
  } catch {
    collection = null;
  }
  checks.quorumReached = !!(collection && collection.quorumReached);
  if (collection && collection.invalid.length > 0 && checks.attestationsVerify) {
    fail('attestation-names-other-box-or-commitment');
  }
  if (!checks.quorumReached) fail('quorum-not-reached');

  /* Link 4 — the settlement record, and the decision re-run */
  const recordOk = !!(settlementRecord && typeof settlementRecord === 'object');
  if (!recordOk) { fail('settlement-record-missing'); return done({}); }
  checks.settlementRecordValid = verifySettlementRecord(settlementRecord);
  if (!checks.settlementRecordValid) fail('settlement-record-invalid');
  if (checks.settlementRecordValid) {
    checks.settlementBindsBoxAndPlan =
      String(settlementRecord.commitment).toLowerCase() === String(plan.commitment).toLowerCase() &&
      String(settlementRecord.boxId).toLowerCase() === String(box.boxId).toLowerCase();
    if (!checks.settlementBindsBoxAndPlan) fail('settlement-binds-other-box-or-plan');
    checks.settlementInWindow = Number.isSafeInteger(settlementRecord.decisionHeight) &&
      settlementRecord.decisionHeight < plan.timeoutHeight;
    if (!checks.settlementInWindow) fail('settlement-outside-window');
    if (collection) {
      checks.settlementBindsCountedAttestations =
        sameIdSet(settlementRecord.attestationIds, collection.countedAttestationIds);
      if (!checks.settlementBindsCountedAttestations) fail('settlement-attestations-mismatch');
    }
    if (reveal && Number.isSafeInteger(settlementRecord.decisionHeight)) {
      try {
        const rerun = decideSettlement({
          box, plan, attestations, quorum, reveal,
          currentHeight: settlementRecord.decisionHeight,
        });
        checks.settlementReproduced = rerun.verdict === 'settle' && !!rerun.record &&
          rerun.record.recordId === String(settlementRecord.recordId).toLowerCase();
      } catch {
        checks.settlementReproduced = false;
      }
      if (!checks.settlementReproduced) fail('settlement-not-reproduced');
    }
  }

  /* Link 5 — the claim payload */
  const claimOk = !!(claim && typeof claim === 'object');
  if (!claimOk) { fail('claim-missing'); return done(); }
  checks.claimPayloadValid = verifyClaimPayload(claim);
  if (!checks.claimPayloadValid) fail('claim-payload-invalid');
  if (checks.claimPayloadValid && checks.settlementRecordValid) {
    checks.claimBindsSettlement =
      String(claim.settlementRecordId).toLowerCase() === String(settlementRecord.recordId).toLowerCase() &&
      String(claim.commitment).toLowerCase() === String(plan.commitment).toLowerCase() &&
      String(claim.boxId).toLowerCase() === String(box.boxId).toLowerCase();
    if (!checks.claimBindsSettlement) fail('claim-binds-other-settlement-box-or-plan');
    if (reveal) {
      try {
        const canonical = buildClaimPayload({ record: settlementRecord, reveal });
        checks.claimIsCanonical = canonical.claimId === String(claim.claimId).toLowerCase();
      } catch {
        checks.claimIsCanonical = false;
      }
      if (!checks.claimIsCanonical) fail('claim-not-canonical');
    }
  }

  /* Link 6 — the ledger actually recorded this claim */
  const lv = verifyLedger(Array.isArray(ledger) ? ledger : null);
  checks.ledgerValid = lv.valid;
  if (!lv.valid) fail('ledger-invalid');
  let ledgerHead = null;
  if (lv.valid) {
    ledgerHead = lv.head;
    // The claim and record ids are judged ONCE, from their length,
    // before the scan — not lowercased inside it: the scan's
    // predicate runs per ledger entry, so an oversize id was copied
    // in full once for every entry (a 20 MB "claim id" against a
    // 50-entry ledger burned ~0.6 s of lowercasing, and the ledger
    // bound is 10,000 entries). Every verdict is unchanged: a
    // verified entry's ids are exactly 64 characters, so an id of
    // any other length could never have matched one.
    const wantClaimId = idForCompare(claim.claimId);
    const wantRecordId = idForCompare(settlementRecord.recordId);
    checks.claimInLedger = wantClaimId !== null && wantRecordId !== null &&
      (ledger || []).some((e) =>
        String(e.claimId).toLowerCase() === wantClaimId &&
        String(e.settlementRecordId).toLowerCase() === wantRecordId);
    if (!checks.claimInLedger) fail('claim-not-in-ledger');
  }

  if (failures.length > 0) return done({ ledgerHead });
  return done({
    ledgerHead,
    claimId: String(claim.claimId).toLowerCase(),
    settlementRecordId: String(settlementRecord.recordId).toLowerCase(),
    auditId: computeAuditId({
      commitment: plan.commitment,
      boxId: box.boxId,
      settlementRecordId: settlementRecord.recordId,
      claimId: claim.claimId,
      ledgerHead,
    }),
  });
}

module.exports = {
  AUDIT_DOMAIN,
  MAX_ATTESTATIONS,
  auditPreimage,
  computeAuditId,
  auditBundle,
};
