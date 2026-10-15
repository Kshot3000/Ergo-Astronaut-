'use strict';
/*
 * btc-chain.js — Bitcoin header-CHAIN verification for the native Bitcoin
 * DeFi on Ergo workstream: Phase 1 on top of btc-spv.js (Phase 0).
 *
 * Phase 0 checks one header at a time. That is not enough for an Ergo
 * contract to trust a Bitcoin payment: an attacker can grind a single
 * low-difficulty header. What makes SPV evidence strong is the CHAIN —
 * headers linked by prev-hash, every header meeting its stated target,
 * the difficulty following Bitcoin's 2016-block retarget rules exactly,
 * and enough CUMULATIVE work that redoing it is infeasible. This module
 * is that check, dependency-free and exact (BigInt throughout).
 *
 * Retarget semantics follow Bitcoin Core's CalculateNextWorkRequired:
 * every 2016 blocks the target is scaled by the previous period's actual
 * timespan over the two-week target timespan, with the actual timespan
 * clamped to [target/4, target*4] and the result capped at the proof-of-
 * work limit. Off a retarget boundary the bits may not change at all.
 * Per-block work is Core's GetBlockProof: floor(2^256 / (target + 1)).
 *
 * Pinned by tests against REAL Bitcoin headers (genesis through block 3,
 * and the retargets at heights 2016 and 32256 — the first difficulty
 * increase in Bitcoin's history) and an independent Python oracle
 * implementing the same consensus rules from the spec. Read-only math
 * only. Nothing here signs, broadcasts, or custodies anything.
 * Built by Kyle Cox (@kshot9000), independent builder.
 */

const { parseHeader, powTarget } = require('./btc-spv');

const MAX_HEADERS = 10000; // segment bound: ~5 retarget periods; longer
// chains verify as consecutive segments (each verdict's tip hash and
// cumulative work carry into the next segment's judgement by the caller)
const RETARGET_INTERVAL = 2016;
const TARGET_TIMESPAN = 14 * 24 * 60 * 60; // 1209600 seconds, two weeks
const POW_LIMIT_BITS = 0x1d00ffff;
const POW_LIMIT_TARGET = powTarget(POW_LIMIT_BITS);

/* ---------------- Compact target codec (Bitcoin SetCompact/GetCompact) --- */

// powTarget in btc-spv.js decodes the full 0xffffff mantissa; the chain
// rules need Core's exact codec: a 23-bit mantissa, a sign bit that makes
// the value invalid, and overflow rejection. Kept separate so Phase 0's
// pinned behaviour does not move.
function targetFromBits(bits) {
  if (!Number.isSafeInteger(bits) || bits < 0 || bits > 0xffffffff) throw new Error('bits must be a u32');
  if (bits & 0x00800000) throw new Error('bits encode a negative target');
  const exponent = bits >>> 24;
  const mantissa = BigInt(bits & 0x007fffff);
  const target = exponent <= 3 ? mantissa >> BigInt(8 * (3 - exponent)) : mantissa << BigInt(8 * (exponent - 3));
  if (target >> 256n !== 0n) throw new Error('bits encode a target above 2^256');
  return target;
}

function bitsFromTarget(target) {
  if (typeof target !== 'bigint' || target < 0n) throw new Error('target must be a non-negative BigInt');
  if (target === 0n) return 0;
  let size = 0;
  for (let t = target; t > 0n; t >>= 8n) size += 1;
  let compact;
  if (size <= 3) compact = target << BigInt(8 * (3 - size));
  else compact = target >> BigInt(8 * (size - 3));
  if (compact & 0x800000n) {
    compact >>= 8n;
    size += 1;
  }
  return ((size << 24) | Number(compact & 0x7fffffn)) >>> 0;
}

/* ---------------- Work ---------------- */

function workFromBits(bits) {
  const target = targetFromBits(bits);
  if (target <= 0n) throw new Error('a non-positive target has no defined work');
  // GetBlockProof: (~target / (target + 1)) + 1 over 256-bit integers,
  // which equals floor(2^256 / (target + 1)) for 0 < target < 2^256.
  return (1n << 256n) / (target + 1n);
}

/* ---------------- Retarget ---------------- */

function expectedRetargetBits(prevBits, periodFirstTimestamp, periodLastTimestamp) {
  if (!Number.isSafeInteger(periodFirstTimestamp) || !Number.isSafeInteger(periodLastTimestamp)) {
    throw new Error('period timestamps must be integer seconds');
  }
  let actual = periodLastTimestamp - periodFirstTimestamp;
  if (actual < TARGET_TIMESPAN / 4) actual = TARGET_TIMESPAN / 4;
  if (actual > TARGET_TIMESPAN * 4) actual = TARGET_TIMESPAN * 4;
  let newTarget = (targetFromBits(prevBits) * BigInt(actual)) / BigInt(TARGET_TIMESPAN);
  if (newTarget > POW_LIMIT_TARGET) newTarget = POW_LIMIT_TARGET;
  return bitsFromTarget(newTarget);
}

/* ---------------- Chain verification ---------------- */

// headersHex: array of 80-byte header hex strings, oldest first.
// options.startHeight: height of the first header (default 0).
// options.periodStartTimestamp: timestamp of the FIRST header of the
//   2016-block period that a retarget boundary inside the segment closes
//   — needed only when that boundary's period start lies before the
//   segment. Without it the boundary is reported in retargetsUnverified
//   instead of being silently assumed correct.
function verifyHeaderChain(headersHex, options = {}) {
  const { startHeight = 0, periodStartTimestamp = null } = options;
  if (!Array.isArray(headersHex) || headersHex.length === 0) throw new Error('at least one header is required');
  if (headersHex.length > MAX_HEADERS) {
    throw new Error('header list exceeds the ' + MAX_HEADERS + '-entry bound; refusing to verify an unbounded segment');
  }
  if (!Number.isSafeInteger(startHeight) || startHeight < 0) throw new Error('startHeight must be a non-negative integer');
  if (periodStartTimestamp !== null && !Number.isSafeInteger(periodStartTimestamp)) {
    throw new Error('periodStartTimestamp must be integer seconds or null');
  }
  const errors = [];
  const retargetsChecked = [];
  const retargetsUnverified = [];
  const parsed = [];
  let cumulativeWork = 0n;
  for (let i = 0; i < headersHex.length; i += 1) {
    const height = startHeight + i;
    let h;
    try {
      h = parseHeader(headersHex[i]);
    } catch (e) {
      errors.push({ height, check: 'parse', message: String(e.message) });
      break; // linkage and work past a broken header are meaningless
    }
    parsed.push(h);
    let target;
    try {
      target = targetFromBits(h.bits);
    } catch (e) {
      errors.push({ height, check: 'bits', message: String(e.message) });
      continue;
    }
    if (target <= 0n || target > POW_LIMIT_TARGET) {
      errors.push({ height, check: 'bits', message: 'target outside (0, pow-limit]' });
      continue;
    }
    if (BigInt('0x' + h.hash) > target) {
      errors.push({ height, check: 'pow', message: 'block hash above target' });
    }
    cumulativeWork += workFromBits(h.bits);
    if (i === 0) continue;
    const prev = parsed[i - 1];
    if (h.prevHash !== prev.hash) {
      errors.push({ height, check: 'link', message: 'prevHash does not match the previous header hash' });
    }
    if (height % RETARGET_INTERVAL === 0) {
      let firstTs = null;
      if (i >= RETARGET_INTERVAL) firstTs = parsed[i - RETARGET_INTERVAL].timestamp;
      else if (periodStartTimestamp !== null) firstTs = periodStartTimestamp;
      if (firstTs === null) {
        retargetsUnverified.push(height);
      } else {
        // The previous header's bits may themselves be undecodable
        // (sign bit set, or a target above 2^256): that header was
        // already named as a 'bits' error above and the loop
        // continued, so re-decoding its bits here must not throw out
        // of the verdict — the retarget simply cannot be computed,
        // which is a retarget failure at this height, named like
        // every other failure this function returns.
        let expected = null;
        try {
          expected = expectedRetargetBits(prev.bits, firstTs, prev.timestamp);
        } catch (e) {
          errors.push({
            height,
            check: 'retarget',
            message: 'retarget cannot be computed from the previous header bits: ' + String(e.message),
          });
        }
        if (expected !== null && h.bits !== expected) {
          errors.push({
            height,
            check: 'retarget',
            message: 'bits ' + h.bits.toString(16) + ' != retarget-expected ' + expected.toString(16),
          });
        } else if (expected !== null) {
          retargetsChecked.push(height);
        }
      }
    } else if (h.bits !== prev.bits) {
      errors.push({ height, check: 'bits-continuity', message: 'bits changed off a retarget boundary' });
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    startHeight,
    tipHeight: parsed.length ? startHeight + parsed.length - 1 : null,
    tipHash: parsed.length ? parsed[parsed.length - 1].hash : null,
    cumulativeWork: cumulativeWork.toString(),
    retargetsChecked,
    retargetsUnverified,
    status: 'design', // module label: verification math, exercised offline only
  };
}

/* ---------------- ErgoScript guard sketch (DRAFT) ---------------- */

// DRAFT source — not compiled, not deployed, moves nothing. It shows the
// on-chain shape this module specifies: the contract trusts NO oracle —
// the spending transaction itself carries the header chain as data
// inputs, and the guard re-checks linkage, per-header targets and the
// cumulative-work threshold before releasing. ErgoScript's sha256 makes
// Bitcoin's double-SHA256 expressible; the compact-target comparison and
// the retarget rule are the parts a real implementation must port with
// the same care (and the same oracle pinning) as the code above.
const SPV_GUARD_ERGOSCRIPT_DRAFT = `{
  // DRAFT — SPV release guard (not compiled; see btc-chain.js for the spec)
  // Data inputs: header chain boxes, each carrying one 80-byte BTC header
  // in R4, oldest first; the tip box carries cumulative work in R5.
  // Registers on SELF: R4 = required cumulative work (Coll[Byte] big-int),
  // R5 = payment txid that must be proven included (Coll[Byte]).
  val headers = CONTEXT.dataInputs
  val linked = headers.zip(headers.tail).forall { (pair: (Box, Box)) =>
    // prev-hash linkage + per-header PoW-vs-nBits checks happen here in
    // the full implementation, mirroring verifyHeaderChain step for step
    pair._2.R4[Coll[Byte]].get == pair._1.R4[Coll[Byte]].get // placeholder shape
  }
  val enoughWork = headers.last.R5[Long].get >= SELF.R4[Long].get
  sigmaProp(linked && enoughWork)
}`;

module.exports = {
  MAX_HEADERS,
  RETARGET_INTERVAL,
  TARGET_TIMESPAN,
  POW_LIMIT_BITS,
  POW_LIMIT_TARGET,
  targetFromBits,
  bitsFromTarget,
  workFromBits,
  expectedRetargetBits,
  verifyHeaderChain,
  SPV_GUARD_ERGOSCRIPT_DRAFT,
};
