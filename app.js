"use strict";
/* Ergo Astronaut hub logic: project filtering, an exact ERG <-> nanoERG
   converter, and a fully local Ergo address checker.
   The address checker Base58-decodes the address and verifies the real
   Ergo checksum: the first 4 bytes of Blake2b-256(prefix byte + content),
   stored as the last 4 bytes of the decoded address. Blake2b is implemented
   here in pure JS (BigInt 64-bit words) so it runs identically in the
   browser and in Node for the tests. Everything runs locally. */

/* ---------- Blake2b-256 (RFC 7693, unkeyed) ---------- */
var MASK64 = (1n << 64n) - 1n;
var B2_IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n
];
var B2_SIGMA = [
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
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3]
];
function rotr64(x, n) {
  return ((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK64;
}
function blake2b256(bytes) {
  var outLen = 32;
  var h = B2_IV.slice();
  h[0] ^= 0x01010020n; /* param block: digest 32, key 0, fanout 1, depth 1 */
  function compress(block, count, isLast) {
    var m = new Array(16);
    for (var i = 0; i < 16; i++) {
      var w = 0n;
      for (var j = 7; j >= 0; j--) w = (w << 8n) | BigInt(block[i * 8 + j]);
      m[i] = w;
    }
    var v = h.concat(B2_IV);
    v[12] ^= BigInt(count) & MASK64;
    v[13] ^= (BigInt(count) >> 64n) & MASK64;
    if (isLast) v[14] ^= MASK64;
    function G(a, b, c, d, x, y) {
      v[a] = (v[a] + v[b] + x) & MASK64; v[d] = rotr64(v[d] ^ v[a], 32);
      v[c] = (v[c] + v[d]) & MASK64; v[b] = rotr64(v[b] ^ v[c], 24);
      v[a] = (v[a] + v[b] + y) & MASK64; v[d] = rotr64(v[d] ^ v[a], 16);
      v[c] = (v[c] + v[d]) & MASK64; v[b] = rotr64(v[b] ^ v[c], 63);
    }
    for (var r = 0; r < 12; r++) {
      var s = B2_SIGMA[r];
      G(0, 4, 8, 12, m[s[0]], m[s[1]]); G(1, 5, 9, 13, m[s[2]], m[s[3]]);
      G(2, 6, 10, 14, m[s[4]], m[s[5]]); G(3, 7, 11, 15, m[s[6]], m[s[7]]);
      G(0, 5, 10, 15, m[s[8]], m[s[9]]); G(1, 6, 11, 12, m[s[10]], m[s[11]]);
      G(2, 7, 8, 13, m[s[12]], m[s[13]]); G(3, 4, 9, 14, m[s[14]], m[s[15]]);
    }
    for (var k = 0; k < 8; k++) h[k] ^= v[k] ^ v[k + 8];
  }
  var input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  if (input.length === 0) {
    compress(new Uint8Array(128), 0, true);
  } else {
    var offset = 0;
    while (input.length - offset > 128) {
      compress(input.subarray(offset, offset + 128), offset + 128, false);
      offset += 128;
    }
    var last = new Uint8Array(128);
    last.set(input.subarray(offset));
    compress(last, input.length, true);
  }
  var out = new Uint8Array(outLen);
  for (var i = 0; i < 4; i++) {
    var word = h[i];
    for (var b = 0; b < 8; b++) { out[i * 8 + b] = Number(word & 0xffn); word >>= 8n; }
  }
  return out;
}

/* ---------- Base58 ---------- */
var B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(str) {
  if (typeof str !== "string" || str.length === 0) return null;
  var n = 0n;
  for (var i = 0; i < str.length; i++) {
    var idx = B58_ALPHABET.indexOf(str[i]);
    if (idx === -1) return null;
    n = n * 58n + BigInt(idx);
  }
  var bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  var leading = 0;
  while (leading < str.length && str[leading] === "1") leading++;
  var zeros = [];
  for (var z = 0; z < leading; z++) zeros.push(0);
  return Uint8Array.from(zeros.concat(bytes));
}

/* ---------- Ergo address checker ---------- */
/* Layout: [prefix byte][content][4-byte checksum]
   prefix = network (high nibble: 0x0 mainnet, 0x1 testnet) + type (low nibble:
   1 = P2PK, 2 = P2SH, 3 = P2S). Checksum = Blake2b-256(prefix + content)[0..4]. */
var ADDRESS_TYPES = { 1: "P2PK (pay to public key)", 2: "P2SH (pay to script hash)", 3: "P2S (pay to script)" };
function checkErgoAddress(raw) {
  var fail = function (reason) {
    return { valid: false, reason: reason, network: null, type: null, typeCode: null, prefix: null };
  };
  var addr = typeof raw === "string" ? raw.trim() : "";
  if (!addr) return fail("No address entered.");
  if (/\s/.test(addr)) return fail("Address contains spaces — an Ergo address is one unbroken string.");
  var decoded = base58Decode(addr);
  if (!decoded) return fail("Not valid Base58 — Ergo addresses never contain 0, O, I or l.");
  if (decoded.length < 6) return fail("Too short: decoded to " + decoded.length + " bytes; an Ergo address carries a prefix byte, content and a 4-byte checksum.");
  var prefix = decoded[0];
  var networkCode = prefix >> 4;
  var typeCode = prefix & 0x0f;
  var network = networkCode === 0 ? "Mainnet" : networkCode === 1 ? "Testnet" : null;
  if (!network) return fail("Unknown network nibble 0x" + networkCode.toString(16) + " in prefix byte 0x" + prefix.toString(16) + " — Ergo uses 0x0 for mainnet and 0x1 for testnet.");
  if (!ADDRESS_TYPES[typeCode]) return fail("Unknown address type " + typeCode + " in prefix byte 0x" + prefix.toString(16) + " — Ergo types are 1 (P2PK), 2 (P2SH) and 3 (P2S).");
  var body = decoded.subarray(0, decoded.length - 4);
  var stored = decoded.subarray(decoded.length - 4);
  var digest = blake2b256(body);
  for (var i = 0; i < 4; i++) {
    if (digest[i] !== stored[i]) {
      return {
        valid: false,
        reason: "Checksum mismatch — this address was mistyped or altered. Do not send to it.",
        network: network, type: ADDRESS_TYPES[typeCode], typeCode: typeCode, prefix: prefix
      };
    }
  }
  return {
    valid: true,
    reason: "Checksum verified (Blake2b-256).",
    network: network, type: ADDRESS_TYPES[typeCode], typeCode: typeCode, prefix: prefix,
    contentBytes: body.length - 1
  };
}

/* ---------- ERG <-> nanoERG converter (exact BigInt) ---------- */
var NANO_PER_ERG = 1000000000n;
function ergToNano(ergStr) {
  var s = (ergStr == null ? "" : String(ergStr)).trim();
  if (!/^\d+(\.\d{1,9})?$/.test(s)) return null;
  var parts = s.split(".");
  var nano = BigInt(parts[0]) * NANO_PER_ERG + BigInt(((parts[1] || "") + "000000000").slice(0, 9));
  return nano.toString();
}
function nanoToErg(nanoStr) {
  var s = (nanoStr == null ? "" : String(nanoStr)).trim();
  if (!/^\d+$/.test(s)) return null;
  var nano = BigInt(s);
  var whole = nano / NANO_PER_ERG;
  var frac = (nano % NANO_PER_ERG).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? whole.toString() + "." + frac : whole.toString();
}

/* ---------- Storage rent estimator ---------- */
/* Protocol rule (sigma-rust, ergo-lib storage_rent.rs): once a box has sat
   unspent for STORAGE_PERIOD blocks, a miner may deduct
   fee = serialized box size in bytes * storage_fee_factor, recreating the
   box with what is left. If the box value is <= the fee, the miner may
   spend the whole box (ERG and any tokens in it). The factor is a votable
   chain parameter: 1,250,000 nanoERG per byte, confirmed against live
   mainnet epoch params (api.ergoplatform.com) on 2026-10-06. */
var STORAGE_FEE_FACTOR_NANO_PER_BYTE = 1250000n;
var STORAGE_PERIOD_BLOCKS = 1051200;
function storageRentNano(sizeStr) {
  var s = (sizeStr == null ? "" : String(sizeStr)).trim();
  if (!/^\d+$/.test(s)) return null;
  var bytes = BigInt(s);
  if (bytes <= 0n) return null;
  return (bytes * STORAGE_FEE_FACTOR_NANO_PER_BYTE).toString();
}
function analyzeStorageRent(sizeStr, ergStr) {
  var rentStr = storageRentNano(sizeStr);
  var valueStr = ergToNano(ergStr);
  if (rentStr === null || valueStr === null) return null;
  var rent = BigInt(rentStr);
  var value = BigInt(valueStr);
  /* Full rent payments the box can make: it pays while its value is
     strictly greater than one fee, and is consumable once value <= fee. */
  var payments = value > rent ? (value - 1n) / rent : 0n;
  return {
    rentNano: rentStr,
    rentErg: nanoToErg(rentStr),
    payments: payments.toString(),
    approxYears: (payments * 4n).toString(),
    consumableAtFirstRent: value <= rent
  };
}

/* ---------- Minimum box value checker ---------- */
/* Protocol rule: a box's value must be at least its serialized size in
   bytes times the chain's minimum value per byte. That rate was set at
   360 nanoERG per byte at launch (sigma-rust BoxValue) and the live
   mainnet epoch parameter still reads 360 (api.ergoplatform.com
   /api/v1/info, checked 2026-10-07); it is votable, so re-check it
   before citing it again. sigma-rust's recommended safe user minimum
   is 1,000,000 nanoERG (0.001 ERG), which covers boxes up to 2,777
   bytes at the current rate. Exact BigInt maths throughout. */
var MIN_VALUE_PER_BYTE_NANO = 360n;
var SAFE_USER_MIN_BOX_NANO = 1000000n;
function minBoxValueNano(sizeStr) {
  var s = (sizeStr == null ? "" : String(sizeStr)).trim();
  if (!/^\d+$/.test(s)) return null;
  var bytes = BigInt(s);
  if (bytes <= 0n) return null;
  return (bytes * MIN_VALUE_PER_BYTE_NANO).toString();
}
function analyzeMinBoxValue(sizeStr, ergStr) {
  var minStr = minBoxValueNano(sizeStr);
  var valueStr = ergToNano(ergStr);
  if (minStr === null || valueStr === null) return null;
  var min = BigInt(minStr);
  var value = BigInt(valueStr);
  var diff = value >= min ? value - min : min - value;
  return {
    minNano: minStr,
    minErg: nanoToErg(minStr),
    meetsMinimum: value >= min,
    differenceNano: diff.toString(),
    differenceErg: nanoToErg(diff.toString()),
    meetsSafeUserMin: value >= SAFE_USER_MIN_BOX_NANO
  };
}

/* ---------- Autolykos mining-share estimator ---------- */
/* Ergo targets a 2-minute block interval, so ~720 blocks/day. A miner's
   expected share of those blocks equals their share of total network
   hashrate. This is an expectation estimate from user-supplied figures
   only — it fetches nothing and claims no live network data: real
   earnings vary with difficulty changes, pool fees, tx fees and luck. */
var BLOCKS_PER_DAY = 720;
var HASHRATE_UNITS = { "H/s": 1, "kH/s": 1e3, "MH/s": 1e6, "GH/s": 1e9, "TH/s": 1e12, "PH/s": 1e15 };
function hashrateToHps(amountStr, unit) {
  var s = (amountStr == null ? "" : String(amountStr)).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  if (!Object.prototype.hasOwnProperty.call(HASHRATE_UNITS, unit)) return null;
  var hps = Number(s) * HASHRATE_UNITS[unit];
  return isFinite(hps) && hps > 0 ? hps : null;
}
function estimateMining(myHps, netHps, rewardErgStr) {
  if (!isFinite(myHps) || !isFinite(netHps) || myHps <= 0 || netHps <= 0) return null;
  if (myHps > netHps) return null;
  var rewardNano = ergToNano(rewardErgStr);
  if (rewardNano === null || BigInt(rewardNano) <= 0n) return null;
  var share = myHps / netHps;
  var blocksPerDay = share * BLOCKS_PER_DAY;
  return {
    sharePercent: share * 100,
    blocksPerDay: blocksPerDay,
    ergPerDay: blocksPerDay * (Number(rewardNano) / 1e9),
    daysPerBlock: 1 / blocksPerDay
  };
}
function fmtEstimate(x) {
  if (x >= 100) return x.toFixed(2).replace(/\.?0+$/, "");
  if (x >= 1) return x.toFixed(4).replace(/\.?0+$/, "");
  return x.toPrecision(3);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { blake2b256, base58Decode, checkErgoAddress, ergToNano, nanoToErg, NANO_PER_ERG, ADDRESS_TYPES, storageRentNano, analyzeStorageRent, STORAGE_FEE_FACTOR_NANO_PER_BYTE, STORAGE_PERIOD_BLOCKS, minBoxValueNano, analyzeMinBoxValue, MIN_VALUE_PER_BYTE_NANO, SAFE_USER_MIN_BOX_NANO, BLOCKS_PER_DAY, HASHRATE_UNITS, hashrateToHps, estimateMining, fmtEstimate };
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", function () {
    /* --- project filtering --- */
    var cards = Array.prototype.slice.call(document.querySelectorAll("#cards .card"));
    var q = document.getElementById("q");
    var status = document.getElementById("filter-status");
    var noResults = document.getElementById("no-results");
    var activeFilter = "all";
    function applyFilter() {
      var needle = (q.value || "").toLowerCase();
      var shown = 0;
      cards.forEach(function (card) {
        var catOk = activeFilter === "all" || (card.getAttribute("data-cat") || "").split(" ").indexOf(activeFilter) !== -1;
        var textOk = !needle || (card.getAttribute("data-name") + " " + card.textContent).toLowerCase().indexOf(needle) !== -1;
        var show = catOk && textOk;
        card.hidden = !show;
        if (show) shown++;
      });
      noResults.hidden = shown !== 0;
      status.textContent = shown + (shown === 1 ? " project shown" : " projects shown");
    }
    q.addEventListener("input", applyFilter);
    document.querySelectorAll(".chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll(".chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        activeFilter = chip.getAttribute("data-filter");
        applyFilter();
      });
    });
    applyFilter();

    /* --- converter --- */
    document.getElementById("converter").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var ergVal = document.getElementById("erg").value;
      var nanoVal = document.getElementById("nanoerg").value;
      var result = document.getElementById("convert-result");
      if (ergVal.trim() !== "") {
        var nano = ergToNano(ergVal);
        result.textContent = nano === null
          ? "Enter an ERG amount (a whole number, or up to 9 decimal places — 1 nanoERG is the smallest unit)."
          : ergVal.trim() + " ERG = " + nano + " nanoERG. Exact BigInt maths, done locally.";
        if (nano !== null) document.getElementById("nanoerg").value = nano;
      } else if (nanoVal.trim() !== "") {
        var erg = nanoToErg(nanoVal);
        result.textContent = erg === null
          ? "Enter a nanoERG amount as a whole number (no decimals — nanoERG does not subdivide)."
          : nanoVal.trim() + " nanoERG = " + erg + " ERG. Exact BigInt maths, done locally.";
        if (erg !== null) document.getElementById("erg").value = erg;
      } else {
        result.textContent = "Fill in one side — ERG or nanoERG — and I will convert the other.";
      }
    });

    /* --- address checker --- */
    document.getElementById("address-checker").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var res = checkErgoAddress(document.getElementById("addr-in").value);
      var out = document.getElementById("addr-result");
      if (res.valid) {
        out.textContent = "✓ Valid Ergo address — " + res.network + ", " + res.type +
          " (prefix byte 0x" + res.prefix.toString(16).padStart(2, "0") + ", " + res.contentBytes +
          " content bytes). " + res.reason + " A format check only: it proves the address is well-formed, not who owns it.";
      } else {
        out.textContent = "✗ " + (res.network ? res.network + ", " + res.type + " — but: " : "") + res.reason;
      }
    });

    /* --- storage rent estimator --- */
    document.getElementById("rent-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var res = analyzeStorageRent(document.getElementById("rent-bytes").value, document.getElementById("rent-erg").value);
      var out = document.getElementById("rent-result");
      if (res === null) {
        out.textContent = "Enter a box size in whole bytes (above zero) and the box's ERG value (up to 9 decimal places).";
        return;
      }
      var msg = "Storage rent for this box: " + res.rentErg + " ERG (" + res.rentNano + " nanoERG) per 4-year cycle — its serialized size × 1,250,000 nanoERG per byte, the current mainnet storage fee factor (a votable chain parameter). ";
      if (res.consumableAtFirstRent) {
        msg += "⚠ This box's ERG does not cover even one rent payment: once it has sat unspent for 1,051,200 blocks (~4 years), a miner may spend the whole box — including any tokens or NFTs inside it. Top it up or move it before then.";
      } else {
        msg += "Left untouched, it covers " + res.payments + (res.payments === "1" ? " full rent payment" : " full rent payments") + " — roughly " + res.approxYears + " years of inactivity — before a miner could consume what remains, tokens included. Moving the box resets the 4-year clock. Estimate only: the fee factor can change by miner vote.";
      }
      out.textContent = msg;
    });

    /* --- minimum box value checker --- */
    document.getElementById("minbox-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var res = analyzeMinBoxValue(document.getElementById("minbox-bytes").value, document.getElementById("minbox-erg").value);
      var out = document.getElementById("minbox-result");
      if (res === null) {
        out.textContent = "Enter a box size in whole bytes (above zero) and the box's ERG value (up to 9 decimal places).";
        return;
      }
      var msg = "Minimum allowed value for this box: " + res.minErg + " ERG (" + res.minNano + " nanoERG) — its serialized size × 360 nanoERG per byte, the minimum-value-per-byte rate set at launch and still the live mainnet parameter (a votable chain parameter). ";
      if (res.meetsMinimum) {
        msg += "✓ This box clears the minimum by " + res.differenceErg + " ERG (" + res.differenceNano + " nanoERG). ";
      } else {
        msg += "✗ This box is " + res.differenceErg + " ERG (" + res.differenceNano + " nanoERG) below the minimum — a transaction creating it would be rejected. Add at least that much ERG. ";
      }
      msg += res.meetsSafeUserMin
        ? "It also clears the recommended safe user minimum of 0.001 ERG (1,000,000 nanoERG), which covers boxes up to 2,777 bytes at the current rate."
        : "Note: wallets usually require the recommended safe user minimum of 0.001 ERG (1,000,000 nanoERG) per box when the exact size is not known — this box is below that, even if it clears its exact size-based minimum.";
      out.textContent = msg;
    });

    /* --- mining-share estimator --- */
    document.getElementById("mining-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("mine-result");
      var myHps = hashrateToHps(document.getElementById("mine-hash").value, document.getElementById("mine-unit").value);
      var netHps = hashrateToHps(document.getElementById("net-hash").value, document.getElementById("net-unit").value);
      var res = estimateMining(myHps, netHps, document.getElementById("mine-reward").value);
      if (res === null) {
        out.textContent = "Enter your hashrate, the total network hashrate (yours cannot exceed the network's), and the current block reward in ERG — check a block explorer for today's reward, it steps down over time.";
        return;
      }
      out.textContent = "Your share of network hashrate: ~" + fmtEstimate(res.sharePercent) + "%. " +
        "At Ergo's 2-minute block target (~720 blocks/day) that is an expected ~" + fmtEstimate(res.blocksPerDay) +
        " blocks/day, or ~" + fmtEstimate(res.ergPerDay) + " ERG/day at the reward you entered — about one block every " +
        fmtEstimate(res.daysPerBlock) + " days if you solo-mine. Estimate only: it assumes both hashrates and the reward stay constant, and ignores pool fees, transaction fees, difficulty drift and luck.";
    });

    /* --- copy donation address --- */
    document.getElementById("copy-address").addEventListener("click", function () {
      var addr = document.getElementById("donation-address").textContent.trim();
      var done = function () { document.getElementById("copy-status").textContent = "ERG address copied."; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(addr).then(done, function () {
          document.getElementById("copy-status").textContent = "Copy failed — select the address text manually.";
        });
      } else {
        document.getElementById("copy-status").textContent = "Select the address text to copy it.";
      }
    });
  });
}
