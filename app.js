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

/* ---------- Base58 encode ---------- */
function base58Encode(bytes) {
  if (!bytes || bytes.length === 0) return "";
  var n = 0n;
  for (var i = 0; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]);
  var out = "";
  while (n > 0n) { out = B58_ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  for (var z = 0; z < bytes.length && bytes[z] === 0; z++) out = "1" + out;
  return out;
}

/* ---------- P2PK address builder (public key -> address) ---------- */
/* The inverse of the checker above, for P2PK (type 1) addresses only:
   address bytes = [prefix byte][33-byte compressed public key][checksum],
   where the prefix is 0x01 on mainnet and 0x11 on testnet (network nibble
   + type 1) and the checksum is the first 4 bytes of Blake2b-256 over
   prefix + key — the exact construction sigmastate's ErgoAddress uses.
   Compressed secp256k1 public keys are 33 bytes starting 0x02 or 0x03.
   Verified against the documented mainnet/testnet P2PK vectors in the
   tests, cross-checked with an independent Python (hashlib) build.
   This builds an address from a PUBLIC key only — never a private key
   or seed phrase; construction proves nothing about who owns the key. */
function p2pkAddressFromPublicKey(pubkeyHex, networkStr) {
  var s = (pubkeyHex == null ? "" : String(pubkeyHex)).trim().toLowerCase();
  var net = (networkStr == null ? "" : String(networkStr)).trim().toLowerCase();
  if (net !== "mainnet" && net !== "testnet") return null;
  if (!/^[0-9a-f]{66}$/.test(s)) return null;
  if (s.slice(0, 2) !== "02" && s.slice(0, 2) !== "03") return null;
  var body = [net === "mainnet" ? 0x01 : 0x11];
  for (var i = 0; i < s.length; i += 2) body.push(parseInt(s.slice(i, i + 2), 16));
  var digest = blake2b256(Uint8Array.from(body));
  for (var c = 0; c < 4; c++) body.push(digest[c]);
  return base58Encode(Uint8Array.from(body));
}

/* ---------- P2PK ErgoTree builder (public key -> ErgoTree) ---------- */
/* The one encode direction the hub was missing: tools 8/10/11/16 go
   key -> address, tree -> address, address -> tree and tree -> P2S,
   but nothing turned a public key into the ErgoTree itself — the hex
   explorers and SDKs show for every P2PK box, and the input tools
   15/16/17 expect. The standard P2PK tree is header 0x00 (version 0,
   no size field, no constant segregation) followed by the ProveDlog
   proposition 0x08 0xcd plus the 33-byte compressed public key —
   exactly the construction sigmastate builds for a P2PK script and
   the one tool 11's decoder reverses. The tree carries no network;
   the network only picks which addresses are derived alongside it.
   The built tree is round-tripped through tool 10's parser and the
   P2PK address through tool 11's decoder before anything is shown:
   both must read back this exact key, tree and address. Verified
   against the documented P2PK vectors and the fleet-sdk/fleet#219
   reference P2SH addresses in the tests. Public keys only — never a
   private key or seed phrase; a tree proves nothing about who can
   spend a box it guards beyond the script itself. */
function buildP2PKTree(pubkeyHex, networkStr) {
  var fail = function (reason) {
    return { valid: false, reason: reason, treeHex: null, publicKey: null, network: null, address: null, p2shAddress: null };
  };
  var net = (networkStr == null ? "" : String(networkStr)).trim().toLowerCase();
  if (net !== "mainnet" && net !== "testnet") return fail("Unknown network — pick mainnet or testnet. The ErgoTree itself is the same on both; only the addresses derived from it differ.");
  var s = (pubkeyHex == null ? "" : String(pubkeyHex)).trim().toLowerCase();
  if (s.indexOf("0x") === 0) s = s.slice(2);
  if (!/^[0-9a-f]{66}$/.test(s)) return fail("Enter a compressed public key as 66 hex characters (33 bytes) starting 02 or 03 — public keys only: never enter a private key or seed phrase anywhere, including here.");
  if (s.slice(0, 2) !== "02" && s.slice(0, 2) !== "03") return fail("That is not a compressed public key: a compressed secp256k1 key is 33 bytes and starts 02 or 03 (this starts " + s.slice(0, 2) + "). An uncompressed key (65 bytes, starting 04) is not what Ergo P2PK scripts carry.");
  var treeHex = "0008cd" + s;
  var network = net === "mainnet" ? "Mainnet" : "Testnet";
  var info = analyzeErgoTree(treeHex, net);
  if (!info.valid || !info.isP2PK || info.publicKey !== s || !info.address || !info.p2shAddress) {
    return fail("Internal round-trip check failed: tool 10's parser does not read the built tree back as this key's P2PK script — refusing to show it rather than risk a mismatched tree.");
  }
  var dec = decodeErgoAddress(info.address);
  if (!dec.valid || dec.ergoTree !== treeHex || dec.publicKey !== s) {
    return fail("Internal round-trip check failed: tool 11's decoder does not read the built address back to this tree and key — refusing to show it rather than risk a mismatched tree.");
  }
  return { valid: true, reason: null, treeHex: treeHex, publicKey: s, network: network, address: info.address, p2shAddress: info.p2shAddress };
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

/* ---------- Token amount converter (raw <-> display, exact) ---------- */
/* Ergo boxes store token amounts as whole integers — there are no decimals
   on-chain. Each token's metadata declares how many decimal places its
   display amount has (the same idea as ERG's 9: nanoERG is the raw unit).
   Wallets and explorers divide the raw integer by 10^decimals to display
   it, and multiply back when building a transaction. Getting this wrong
   by the decimals factor is a classic costly mistake, so both directions
   here are exact BigInt/string maths — no floating point. The user
   supplies the decimals from the token's explorer listing; the sanity
   cap of 18 covers every real token and catches typos. */
var TOKEN_MAX_DECIMALS = 18;
function parseTokenDecimals(decStr) {
  var s = (decStr == null ? "" : String(decStr)).trim();
  if (!/^\d{1,2}$/.test(s)) return null;
  var d = Number(s);
  return d <= TOKEN_MAX_DECIMALS ? d : null;
}
function tokenRawToDisplay(rawStr, decStr) {
  var d = parseTokenDecimals(decStr);
  var s = (rawStr == null ? "" : String(rawStr)).trim();
  if (d === null || !/^\d+$/.test(s)) return null;
  var raw = BigInt(s);
  if (d === 0) return raw.toString();
  var scale = 10n ** BigInt(d);
  var whole = raw / scale;
  var frac = (raw % scale).toString().padStart(d, "0").replace(/0+$/, "");
  return frac ? whole.toString() + "." + frac : whole.toString();
}
function tokenDisplayToRaw(displayStr, decStr) {
  var d = parseTokenDecimals(decStr);
  var s = (displayStr == null ? "" : String(displayStr)).trim();
  if (d === null || !/^\d+(\.\d+)?$/.test(s)) return null;
  var parts = s.split(".");
  var fracPart = parts[1] || "";
  if (fracPart.length > d) return null; /* smaller than one raw unit */
  var scale = 10n ** BigInt(d);
  var raw = BigInt(parts[0]) * scale + BigInt((fracPart + "0".repeat(d)).slice(0, d) || "0");
  return raw.toString();
}

/* ---------- Storage rent countdown ---------- */
/* A box becomes eligible for storage rent once the chain height reaches
   its creation height + STORAGE_PERIOD_BLOCKS (1,051,200 blocks, about
   4 years at the 2-minute block target) — the same period tool 3 uses
   for the fee itself. Both heights are user-supplied (read them off a
   block explorer: a box's creation height is on its explorer page);
   this tool fetches nothing and claims no live chain data. Exact
   BigInt maths for the heights; the days figure is an approximation
   from the block target, because real block intervals vary. */
function parseChainHeight(heightStr) {
  var s = (heightStr == null ? "" : String(heightStr)).trim();
  if (!/^\d+$/.test(s)) return null;
  return s;
}
function analyzeRentCountdown(creationStr, currentStr) {
  var creation = parseChainHeight(creationStr);
  var current = parseChainHeight(currentStr);
  if (creation === null || current === null) return null;
  var created = BigInt(creation);
  var now = BigInt(current);
  if (now < created) return null;
  var eligibility = created + BigInt(STORAGE_PERIOD_BLOCKS);
  var eligible = now >= eligibility;
  var remaining = eligible ? 0n : eligibility - now;
  return {
    ageBlocks: (now - created).toString(),
    eligibilityHeight: eligibility.toString(),
    eligible: eligible,
    blocksRemaining: remaining.toString(),
    approxDaysRemaining: Number(remaining) / BLOCKS_PER_DAY
  };
}

/* ---------- UTXO payment planner ---------- */
/* Ergo's eUTXO model spends boxes whole: to pay an amount plus the
   transaction fee, a wallet selects input boxes (in some order) until
   their total covers payment + fee, and the leftover comes back as a
   change box. This planner walks the boxes in the order listed — the
   simplest deterministic strategy — with exact BigInt maths. All
   figures are user-supplied; it fetches nothing and signs nothing.
   A change amount above zero but below the recommended safe user
   minimum (SAFE_USER_MIN_BOX_NANO, tool 5) is dust: a wallet would
   normally fold it into the fee or select differently, because a
   change box that small is impractical and may fail size-based
   minimums for its serialized size. */
function parseBoxList(boxesStr) {
  var s = (boxesStr == null ? "" : String(boxesStr)).trim();
  if (!s) return null;
  var parts = s.split(/[\s,]+/).filter(function (p) { return p !== ""; });
  if (parts.length === 0 || parts.length > 1000) return null;
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var nano = ergToNano(parts[i]);
    if (nano === null || BigInt(nano) <= 0n) return null;
    out.push(nano);
  }
  return out;
}
function planPayment(boxesStr, paymentStr, feeStr) {
  var boxes = parseBoxList(boxesStr);
  var payment = ergToNano(paymentStr);
  var fee = ergToNano(feeStr);
  if (boxes === null || payment === null || fee === null) return null;
  var payNano = BigInt(payment);
  var feeNano = BigInt(fee);
  if (payNano <= 0n || feeNano < 0n) return null;
  var needed = payNano + feeNano;
  var totalAll = 0n;
  for (var a = 0; a < boxes.length; a++) totalAll += BigInt(boxes[a]);
  var selected = 0;
  var totalSelected = 0n;
  while (selected < boxes.length && totalSelected < needed) {
    totalSelected += BigInt(boxes[selected]);
    selected++;
  }
  if (totalSelected < needed) {
    return {
      sufficient: false,
      neededNano: needed.toString(),
      neededErg: nanoToErg(needed.toString()),
      totalNano: totalAll.toString(),
      totalErg: nanoToErg(totalAll.toString()),
      shortfallNano: (needed - totalAll).toString(),
      shortfallErg: nanoToErg((needed - totalAll).toString()),
      boxCount: boxes.length
    };
  }
  var change = totalSelected - needed;
  return {
    sufficient: true,
    neededNano: needed.toString(),
    neededErg: nanoToErg(needed.toString()),
    selectedCount: selected,
    boxCount: boxes.length,
    unselectedCount: boxes.length - selected,
    totalSelectedNano: totalSelected.toString(),
    totalSelectedErg: nanoToErg(totalSelected.toString()),
    changeNano: change.toString(),
    changeErg: nanoToErg(change.toString()),
    changeIsDust: change > 0n && change < SAFE_USER_MIN_BOX_NANO
  };
}

/* ---------- ErgoTree inspector (script hex -> address) ---------- */
/* An ErgoTree serializes as [header byte][optional VLQ size]
   [proposition bytes][optional segregated constants]. In the header,
   the low 3 bits are the version, 0x08 means a VLQ-encoded proposition
   size follows the header, and 0x10 means constants are segregated
   into a section at the end of the tree; the remaining header bits are
   reserved and must be zero in version-0 trees. An address commits to
   the proposition, not to the whole tree bytes:
   - the standard P2PK proposition is 08 cd + a 33-byte compressed
     public key (a ProveDlog), and a box guarded by it has that key's
     P2PK address (tool 8);
   - any non-segregated script also has a P2SH address: prefix byte
     (type 2) + the first 24 bytes of Blake2b-256 over the proposition
     bytes (the 192-bit script hash) + the usual checksum. Hashing the
     full tree bytes instead of the proposition is a real funds-at-risk
     bug — fleet-sdk/fleet#219, fixed by fleet-sdk/fleet#220 — because
     the header and size bytes are not part of the proposition.
   For constant-segregated trees the reference hashes the proposition
   with the constants substituted back into it, which cannot be
   reconstructed from the raw tree bytes alone, so this tool reports
   the header honestly and declines to invent an address. Verified
   against the reference P2SH vectors executed against
   sigmastate-interpreter (the fleet-sdk issue #219 record: testnet
   qQqAgn6N…, mainnet 7HP8obUp…) and matched with an independent
   Python (hashlib) build on 2026-10-07. */
var ERGOTREE_SIZE_FLAG = 0x08;
var ERGOTREE_SEGREGATION_FLAG = 0x10;
var P2SH_HASH_BYTES = 24;
function hexToBytes(hexStr) {
  var s = (hexStr == null ? "" : String(hexStr)).trim().toLowerCase();
  if (s.indexOf("0x") === 0) s = s.slice(2);
  if (s.length === 0 || s.length % 2 !== 0 || !/^[0-9a-f]+$/.test(s)) return null;
  var out = new Uint8Array(s.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes) {
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
/* Sigma VLQ for unsigned ints: 7 bits per byte, little-endian groups,
   high bit set means another byte follows (fleet-sdk readVLQ). */
function readVlqSize(bytes, offset) {
  var value = 0;
  var shift = 0;
  var i = offset;
  while (i < bytes.length && i - offset < 5) {
    var b = bytes[i];
    value += (b & 0x7f) * Math.pow(2, shift);
    shift += 7;
    i++;
    if ((b & 0x80) === 0) return { value: value, length: i - offset };
  }
  return null;
}
function addressFromContent(prefix, content) {
  var body = [prefix];
  for (var i = 0; i < content.length; i++) body.push(content[i]);
  var digest = blake2b256(Uint8Array.from(body));
  for (var c = 0; c < 4; c++) body.push(digest[c]);
  return base58Encode(Uint8Array.from(body));
}
function analyzeErgoTree(treeHex, networkStr) {
  var fail = function (reason) {
    return { valid: false, reason: reason, header: null, version: null, sizeFlag: false, segregated: false, declaredSize: null, propositionLength: null, isP2PK: false, publicKey: null, address: null, p2shAddress: null, network: null };
  };
  var net = (networkStr == null ? "" : String(networkStr)).trim().toLowerCase();
  if (net !== "mainnet" && net !== "testnet") return fail("Unknown network — an ErgoTree carries no network of its own, so pick mainnet or testnet; the same script has a different address on each.");
  var network = net === "mainnet" ? "Mainnet" : "Testnet";
  var bytes = hexToBytes(treeHex);
  if (!bytes) return fail("Enter the ErgoTree as hex (an even number of 0-9/a-f characters, with or without a 0x prefix) — a box's ErgoTree hex is on its explorer page.");
  if (bytes.length < 2) return fail("Too short: an ErgoTree is at least a header byte plus one proposition byte; this is " + bytes.length + " byte(s).");
  var header = bytes[0];
  if ((header & 0xe0) !== 0) return fail("Header byte 0x" + header.toString(16).padStart(2, "0") + " sets reserved bits — version-0 ErgoTree headers only use the low 5 bits (version, size flag, segregation flag).");
  var sizeFlag = (header & ERGOTREE_SIZE_FLAG) !== 0;
  var segregated = (header & ERGOTREE_SEGREGATION_FLAG) !== 0;
  var base = { valid: true, reason: null, header: header, version: header & 0x07, sizeFlag: sizeFlag, segregated: segregated, declaredSize: null, propositionLength: null, isP2PK: false, publicKey: null, address: null, p2shAddress: null, network: network };
  var offset = 1;
  if (sizeFlag) {
    var vlq = readVlqSize(bytes, offset);
    if (vlq === null) return fail("The header promises a VLQ-encoded proposition size, but the size field is truncated or overlong.");
    base.declaredSize = vlq.value;
    offset += vlq.length;
    if (offset >= bytes.length) return fail("The tree ends right after the size field — there is no proposition.");
    if (!segregated && vlq.value !== bytes.length - offset) return fail("The declared proposition size (" + vlq.value + " bytes) does not match the " + (bytes.length - offset) + " bytes that follow it — this tree hex is truncated or has extra bytes.");
    if (segregated) base.propositionLength = vlq.value;
  }
  if (segregated) {
    base.reason = "Constant-segregated tree: the reference script hash is taken over the proposition with its constants substituted back in, which cannot be reconstructed from the raw tree bytes alone — so no address is derived here rather than risk a wrong one. A full Ergo node or SDK parses these trees properly.";
    return base;
  }
  var proposition = bytes.subarray(offset);
  base.propositionLength = proposition.length;
  var hash = blake2b256(proposition);
  var scriptHash = hash.subarray(0, P2SH_HASH_BYTES);
  base.p2shAddress = addressFromContent(net === "mainnet" ? 0x02 : 0x12, scriptHash);
  if (proposition.length === 35 && proposition[0] === 0x08 && proposition[1] === 0xcd &&
      (proposition[2] === 0x02 || proposition[2] === 0x03)) {
    base.isP2PK = true;
    base.publicKey = bytesToHex(proposition.subarray(2));
    base.address = p2pkAddressFromPublicKey(base.publicKey, net);
  }
  return base;
}

/* ---------- Address -> ErgoTree decoder ---------- */
/* The inverse direction of tools 8 and 10: an address is
   [prefix byte][content][4-byte checksum] (tool 2 verifies the
   checksum), and what the content IS depends on the type nibble —
   this is exactly how sigmastate's ErgoAddress and fleet-sdk's
   ErgoAddress.unpack/encode treat it:
   - P2PK (type 1): the content is the 33-byte compressed public key,
     and the guarding ErgoTree is 00 08 cd + that key (header 0x00, then
     the ProveDlog proposition) — the same construction tools 8/10 use.
   - P2SH (type 2): the content is only the 24-byte script hash (the
     first 24 bytes of Blake2b-256 over the proposition, tool 10). A
     hash is one-way: the script cannot be recovered from it, so no
     ErgoTree is derived for P2SH — reported honestly instead.
   - P2S (type 3): the content is the script's full ErgoTree bytes
     themselves, so the tree is the content verbatim; it is also run
     through tool 10's parser (segregated trees get the same honest
     no-P2SH treatment there).
   Decoding only: nothing here proves who can spend a box guarded by
   the decoded script. Verified in the tests against Kyle's P2PK
   address, the fleet #219 P2SH reference addresses (both networks),
   and the fleet-sdk fee-contract P2S address whose content is the
   segregated FEE_CONTRACT tree. */
function decodeErgoAddress(raw) {
  var out = { valid: false, reason: null, network: null, type: null, typeCode: null, prefix: null, contentHex: null, contentBytes: null, publicKey: null, scriptHash: null, ergoTree: null, treeInfo: null, note: null };
  var check = checkErgoAddress(raw);
  out.network = check.network; out.type = check.type; out.typeCode = check.typeCode; out.prefix = check.prefix;
  if (!check.valid) { out.reason = check.reason; return out; }
  var decoded = base58Decode(String(raw).trim());
  var content = decoded.subarray(1, decoded.length - 4);
  out.valid = true;
  out.reason = check.reason;
  out.contentHex = bytesToHex(content);
  out.contentBytes = content.length;
  if (check.typeCode === 1) {
    if (content.length === 33 && (content[0] === 0x02 || content[0] === 0x03)) {
      out.publicKey = out.contentHex;
      out.ergoTree = "0008cd" + out.contentHex;
    } else {
      out.note = "This address claims P2PK but its content is " + content.length + " byte(s) not starting with a compressed-key prefix (02/03) — not a standard 33-byte public key, so no ErgoTree is derived rather than guess one.";
    }
  } else if (check.typeCode === 2) {
    out.scriptHash = out.contentHex;
    out.note = "A P2SH address carries only the script hash — the first 24 bytes of Blake2b-256 over the script's proposition. The script itself cannot be recovered from its hash; that one-way step is the point of pay-to-script-hash.";
    if (content.length !== P2SH_HASH_BYTES) out.note = "Unusual P2SH content: " + content.length + " bytes instead of the standard 24-byte script hash. " + out.note;
  } else {
    out.ergoTree = out.contentHex;
    out.treeInfo = analyzeErgoTree(out.ergoTree, check.network);
    if (!out.treeInfo.valid) out.note = "The content is the script's ErgoTree bytes verbatim, but they do not parse as a version-0 tree: " + out.treeInfo.reason;
  }
  return out;
}

/* ---------- P2S address builder ---------- */
/* The encode-side inverse of tool 11: a P2S (pay-to-script) address
   carries the script itself — its content is the full ErgoTree bytes
   verbatim, under prefix byte 0x03 on mainnet / 0x13 on testnet, plus
   the usual 4-byte Blake2b-256 checksum (tool 2), Base58-encoded. That
   is exactly sigmastate's Pay2SAddress construction and fleet-sdk's
   ErgoAddress encode for type 3. It is the opposite trade from P2SH
   (tool 10), whose content is only the proposition's 24-byte hash: a
   P2S address is exactly as long as the script and reveals it to
   anyone who sees the address, while a P2SH address stays short and
   hides the script until a box is spent. P2S also carries trees the
   P2SH derivation here honestly declines — a constant-segregated
   tree's bytes are unambiguous as content even though its reference
   script hash cannot be reconstructed from raw bytes alone. The tree
   is parsed with tool 10's parser first and anything unparseable is
   refused, and the built address is round-tripped through tool 11's
   decoder before it is shown. Verified in the tests against the
   fleet-sdk fee-contract P2S address on both networks and the
   fleet #219 P2PK tree, cross-checked with an independent Python
   (hashlib) build. Building an address proves nothing about who can
   spend a box it guards — that depends on the script itself. */
function buildP2SAddress(treeHex, networkStr) {
  var out = { valid: false, reason: null, address: null, network: null, ergoTree: null, byteLength: null, isP2PK: false, segregated: false };
  var info = analyzeErgoTree(treeHex, networkStr);
  if (!info.valid) { out.reason = info.reason; return out; }
  var bytes = hexToBytes(treeHex);
  out.network = info.network;
  out.ergoTree = bytesToHex(bytes);
  out.byteLength = bytes.length;
  out.isP2PK = info.isP2PK;
  out.segregated = info.segregated;
  out.address = addressFromContent(info.network === "Mainnet" ? 0x03 : 0x13, bytes);
  var back = decodeErgoAddress(out.address);
  if (!back.valid || back.ergoTree !== out.ergoTree) {
    out.address = null;
    out.reason = "Internal round-trip check failed — refusing to show an address that does not decode back to this exact script.";
    return out;
  }
  out.valid = true;
  return out;
}

/* ---------- P2SH address builder ---------- */
/* The dedicated encode-side form of tool 10's derivation: a P2SH
   (pay-to-script-hash) address carries only the script hash — prefix
   byte 0x02 on mainnet / 0x12 on testnet + the first 24 bytes of
   Blake2b-256 over the script's PROPOSITION + the usual 4-byte
   checksum (tool 2), Base58-encoded. The proposition is the ErgoTree
   without its header byte (and without the VLQ size field when the
   header's size flag is set) — hashing the full tree bytes instead
   was fleet-sdk/fleet#219, a funds-at-risk bug: boxes sent to such
   an address can never be spent, because the node re-derives the
   hash from the proposition when it checks a spend. That is exactly
   sigmastate's Pay2SHAddress construction, and the fix in fleet
   PR #220. Constant-segregated trees are refused, not hashed: the
   reference hash is taken over the proposition with its constants
   substituted back in, which cannot be reconstructed from raw tree
   bytes alone — tool 16's P2S form carries those trees exactly
   instead. The built address is round-tripped through tool 11's
   decoder before it is shown: it must decode back to this exact
   24-byte script hash. Verified in the tests against the fleet #219
   sigmastate reference addresses on both networks, a size-flagged
   tree, and a generic script, cross-checked with an independent
   Python (hashlib) build. Building an address proves nothing about
   who can spend a box it guards — that depends on the script. */
function buildP2SHAddress(treeHex, networkStr) {
  var out = { valid: false, reason: null, address: null, network: null, ergoTree: null, propositionHex: null, scriptHash: null, isP2PK: false, segregated: false };
  var info = analyzeErgoTree(treeHex, networkStr);
  if (!info.valid) { out.reason = info.reason; return out; }
  out.network = info.network;
  out.isP2PK = info.isP2PK;
  out.segregated = info.segregated;
  var bytes = hexToBytes(treeHex);
  out.ergoTree = bytesToHex(bytes);
  if (info.segregated) {
    out.reason = "Constant-segregated tree: the reference P2SH hash is taken over the proposition with its constants substituted back in, which cannot be reconstructed from the raw tree bytes alone — so no P2SH address is built here rather than risk an address whose boxes could never be spent. Tool 16's P2S builder carries this exact tree as its content instead.";
    return out;
  }
  if (!info.p2shAddress) { out.reason = "Tool 10's parser derived no P2SH address for this tree — refusing to invent one."; return out; }
  var offset = 1;
  if (info.sizeFlag) {
    var vlq = readVlqSize(bytes, offset);
    if (vlq === null) { out.reason = "The header promises a VLQ-encoded proposition size, but the size field is truncated or overlong."; return out; }
    offset += vlq.length;
  }
  var proposition = bytes.subarray(offset);
  out.propositionHex = bytesToHex(proposition);
  out.scriptHash = bytesToHex(blake2b256(proposition).subarray(0, P2SH_HASH_BYTES));
  out.address = info.p2shAddress;
  var back = decodeErgoAddress(out.address);
  if (!back.valid || back.typeCode !== 2 || back.scriptHash !== out.scriptHash) {
    out.address = null;
    out.reason = "Internal round-trip check failed — refusing to show an address that does not decode back to this exact script hash.";
    return out;
  }
  out.valid = true;
  return out;
}

/* ---------- Address network converter ---------- */
/* The same address on the other network: an Ergo address is
   [prefix byte][content][4-byte checksum] (tool 2), and the prefix
   byte is the network in its high nibble (0x0 mainnet, 0x1 testnet)
   plus the type in its low nibble (1 P2PK, 2 P2SH, 3 P2S). Nothing
   else about an address is network-specific — the content bytes are
   identical on both networks — so the equivalent address on the other
   network is the same content under the other network nibble, with
   the checksum recomputed over the new prefix + content. That is
   exactly how sigmastate's ErgoAddress re-derives an address when the
   network type changes. Converting changes no ownership and moves no
   funds: a testnet address guards testnet boxes only, and sending
   mainnet ERG to a testnet address (or vice versa) loses it — wallets
   and explorers treat the two networks as separate worlds. The input
   checksum is verified first (tool 2), so a mistyped address is
   refused rather than converted into a plausible wrong one. Verified
   in the tests against the fleet #219 key/address pairs, which are
   published on both networks, Kyle's address, and the fleet-sdk
   fee-contract P2S address, cross-checked with an independent Python
   (hashlib) build. */
function convertAddressNetwork(raw) {
  var check = checkErgoAddress(raw);
  var out = { valid: false, reason: null, network: null, type: null, typeCode: null, converted: null, convertedNetwork: null, contentHex: null };
  out.network = check.network; out.type = check.type; out.typeCode = check.typeCode;
  if (!check.valid) { out.reason = check.reason; return out; }
  var decoded = base58Decode(String(raw).trim());
  var content = decoded.subarray(1, decoded.length - 4);
  var newPrefix = (check.network === "Mainnet" ? 0x10 : 0x00) | check.typeCode;
  out.converted = addressFromContent(newPrefix, content);
  out.convertedNetwork = check.network === "Mainnet" ? "Testnet" : "Mainnet";
  out.contentHex = bytesToHex(content);
  out.valid = true;
  out.reason = check.reason;
  return out;
}

/* ---------- Babel fee calculator ---------- */
/* Babel fees let a transaction pay its fee in a native token instead of
   ERG: a babel box holds ERG and its contract swaps tokens for that ERG
   at a fixed price. In the standard babel-box layout that price is
   stored in the box's R5 register as an integer count of nanoERG per
   raw token unit — the raw unit, so a token's decimals (tool 6) only
   affect how the resulting token count is displayed, never the swap
   maths. Covering a fee therefore takes a ceiling division: the
   smallest whole number of raw tokens whose price total is at least
   the ERG needed. One token fewer would come up short; any overhang
   above the fee stays in the transaction as ERG. All figures are
   user-supplied from the babel box's explorer page — this tool fetches
   nothing, and it does not check that the box actually holds enough
   ERG to pay out, which the explorer page also shows. Exact BigInt
   maths throughout. */
function parseBabelPrice(priceStr) {
  var s = (priceStr == null ? "" : String(priceStr)).trim();
  if (!/^\d+$/.test(s)) return null;
  return BigInt(s) > 0n ? s : null;
}
function analyzeBabelFee(feeStr, priceStr, decStr) {
  var feeNanoStr = ergToNano(feeStr);
  var priceNanoStr = parseBabelPrice(priceStr);
  var d = parseTokenDecimals(decStr);
  if (feeNanoStr === null || priceNanoStr === null || d === null) return null;
  var fee = BigInt(feeNanoStr);
  if (fee <= 0n) return null;
  var price = BigInt(priceNanoStr);
  var tokensRaw = (fee + price - 1n) / price; /* ceiling division */
  var covered = tokensRaw * price;
  var excess = covered - fee;
  return {
    feeNano: feeNanoStr,
    feeErg: nanoToErg(feeNanoStr),
    priceNano: priceNanoStr,
    decimals: d,
    tokensRaw: tokensRaw.toString(),
    tokensDisplay: tokenRawToDisplay(tokensRaw.toString(), decStr),
    coveredNano: covered.toString(),
    coveredErg: nanoToErg(covered.toString()),
    excessNano: excess.toString(),
    excessErg: nanoToErg(excess.toString())
  };
}

/* ---------- Box ID calculator ---------- */
/* A box's ID is the Blake2b-256 of the box's serialized bytes — the
   full ErgoBox serialization: the candidate (value, ErgoTree, creation
   height, tokens, registers) followed by the creating transaction's
   32-byte ID and the box's output index. That is exactly how the
   reference implementations derive it (fleet-sdk's ErgoBox.boxId is
   hex(blake2b256(serializeBox(box))), and ErgoBox.validate recomputes
   it the same way). Two consequences worth knowing: the candidate
   bytes alone hash to something else, so only the full serialization
   gives the ID; and a token minted in a transaction takes its token
   ID from the box ID of that transaction's first input. Verified
   against the fleet-sdk serializer's published box test vectors —
   three real boxes whose serialized bytes reproduce their recorded
   box IDs exactly under this page's own Blake2b-256 — and cross-checked
   with an independent Python (hashlib) build on 2026-10-07. */
function analyzeBoxId(boxHex, expectedStr) {
  var cleaned = boxHex == null ? "" : String(boxHex).replace(/\s+/g, "");
  var bytes = hexToBytes(cleaned);
  if (!bytes) return null;
  var expected = expectedStr == null ? "" : String(expectedStr).trim().toLowerCase();
  if (expected.indexOf("0x") === 0) expected = expected.slice(2);
  if (expected !== "" && !/^[0-9a-f]{64}$/.test(expected)) return null;
  var id = bytesToHex(blake2b256(bytes));
  return {
    boxId: id,
    byteLength: bytes.length,
    expected: expected === "" ? null : expected,
    matches: expected === "" ? null : id === expected
  };
}

/* ---------- Blake2b-256 hash calculator ---------- */
/* Blake2b-256 is the one hash behind almost everything on this hub:
   a box ID is the Blake2b-256 of the box bytes (tool 14), an address
   checksum is its first 4 bytes over prefix + content (tools 2/8),
   and a P2SH script hash is its first 24 bytes over the proposition
   (tools 10/20). This tool exposes that primitive directly: hex
   bytes or UTF-8 text in, the 32-byte digest out, plus the truncated
   hash192 form P2SH addresses carry. Empty input is hashed, not
   rejected — the digest of zero bytes is well-defined. Verified
   against Python hashlib (blake2b, digest_size=32) vectors before
   coding, including the empty input and the fleet #219 proposition
   whose full digest must start with the known script hash. */
function utf8Bytes(str) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
  var s = unescape(encodeURIComponent(str));
  var out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
function analyzeBlake2b(inputStr, modeStr, expectedStr) {
  var mode = (modeStr == null ? "" : String(modeStr)).trim().toLowerCase();
  if (mode !== "hex" && mode !== "text") return null;
  var bytes;
  if (mode === "text") {
    bytes = utf8Bytes(inputStr == null ? "" : String(inputStr));
  } else {
    var cleaned = (inputStr == null ? "" : String(inputStr)).replace(/\s+/g, "");
    if (cleaned === "" || cleaned.toLowerCase() === "0x") {
      bytes = new Uint8Array(0);
    } else {
      bytes = hexToBytes(cleaned);
      if (!bytes) return null;
    }
  }
  var expected = expectedStr == null ? "" : String(expectedStr).trim().toLowerCase();
  if (expected.indexOf("0x") === 0) expected = expected.slice(2);
  if (expected !== "" && !/^[0-9a-f]{64}$/.test(expected)) return null;
  var digest = bytesToHex(blake2b256(bytes));
  return {
    digest: digest,
    hash192: digest.slice(0, 48),
    byteLength: bytes.length,
    mode: mode,
    expected: expected === "" ? null : expected,
    matches: expected === "" ? null : digest === expected
  };
}

/* ---------- Serialized box parser ---------- */
/* The field-by-field inverse of tool 14: a serialized ErgoBox is
   [value: BigInt VLQ][ErgoTree][creation height: VLQ][token count:
   VLQ, then per token a 32-byte ID + a VLQ amount][register count:
   VLQ, then that many Sigma constants for R4, R5, ...][creating
   transaction ID: 32 bytes][output index: VLQ] — exactly the layout
   fleet-sdk's serializeBox writes and deserializeBox reads, and the
   box ID is the Blake2b-256 of the whole thing (tool 14).
   The ErgoTree is delimited the same way fleet's reader delimits it:
   the miner fee contract is recognised by its exact bytes (fleet's
   FEE_CONTRACT constant), a P2PK tree is 0008cd + a 33-byte
   compressed key (fleet's validateEcPoint checks only the 02/03
   prefix and length), and any other tree must carry the 0x08 size
   flag, whose VLQ size says where it ends. A tree with no size flag
   that is neither of the two recognised forms cannot be delimited
   without parsing the full script — fleet's deserializer throws
   there, and this parser likewise declines plainly instead of
   guessing where the tree ends. Registers hold Sigma constants:
   a type byte (primitive codes 1-8; collection and tuple types are
   constructor-coded as constructor * 12 + embedded primitive code)
   followed by the constant's data (zigzag VLQ for Short/Int/Long,
   a VLQ length + bytes for BigInt, 33 bytes for a group element,
   a 0xcd ProveDlog opcode + 33 bytes for the SigmaProp form fleet
   implements, a VLQ length + elements for collections). Integer
   constants decode at fleet's widths: Short/Int through its 32-bit
   zigzag (fleet's readI16/readI32 both truncate the raw VLQ to
   32 bits first — load-bearing at the extremes, where fleet's own
   encoder emits a 64-bit-wide VLQ) and Long through its 64-bit
   zigzag. Constants of
   types outside that set (Option, Box, AvlTree) stop the parse with
   the reason stated: the fields after such a register cannot be
   located safely. Verified against fleet-sdk's published box test
   vectors (their recorded box IDs, values, trees, heights, tokens,
   transaction IDs and indexes all reproduce) and cross-checked with
   an independent Python build on 2026-10-07. */
var FEE_CONTRACT_HEX = "1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a701730073011001020402d19683030193a38cc7b2a57300000193c2b2a57301007473027303830108cdeeac93b1a57304";
var SIGMA_PRIMITIVE_NAMES = { 1: "SBoolean", 2: "SByte", 3: "SShort", 4: "SInt", 5: "SLong", 6: "SBigInt", 7: "SGroupElement", 8: "SSigmaProp" };
function readVlqBig(bytes, offset) {
  var value = 0n;
  var shift = 0n;
  var i = offset;
  while (i < bytes.length && i - offset < 10) {
    var b = bytes[i];
    value |= BigInt(b & 0x7f) << shift;
    shift += 7n;
    i++;
    if ((b & 0x80) === 0) return { value: value, length: i - offset };
  }
  return null;
}
/* fleet-sdk's zigZag64.decode (its readI64 path): decode, then wrap
   to a signed 64-bit result. The wrap is the identity for every
   canonical encoding; it only bites on over-wide crafted VLQs. */
function zigzagDecode(v) {
  var d = (v >> 1n) ^ (-(v & 1n));
  var wrapped = d & 18446744073709551615n;
  return wrapped >= 9223372036854775808n ? wrapped - 18446744073709551616n : wrapped;
}
/* fleet-sdk's zigZag32.decode (its readI16 AND readI32 paths): the
   raw VLQ is truncated to an unsigned 32-bit value BEFORE decoding.
   That truncation is load-bearing, not a detail: fleet encodes
   Short/Int in signed 32-bit zigzag space and writes a negative
   result as its unsigned 64-bit form (see sigmaIntZigzag), so an
   extreme SInt arrives as a 64-bit-wide VLQ (SInt max is
   feffffffffffffffff01) whose low 32 bits are the real zigzag.
   Decoding that VLQ in 64-bit space — as this parser originally
   did — returns a wrong huge number (9223372036854775807 for SInt
   max). Fixed 2026-10-07 to mirror fleet's reader exactly. */
function zigzagDecode32(v) {
  var u = v & 4294967295n;
  return (u >> 1n) ^ (-(u & 1n));
}
function sigmaTypeName(node) {
  if (node.kind === "prim") return SIGMA_PRIMITIVE_NAMES[node.code];
  if (node.kind === "coll") return "Coll[" + sigmaTypeName(node.elem) + "]";
  var names = [];
  for (var i = 0; i < node.elems.length; i++) names.push(sigmaTypeName(node.elems[i]));
  return "(" + names.join(", ") + ")";
}
function parseSigmaType(bytes, offset) {
  if (offset >= bytes.length) return null;
  var b = bytes[offset];
  if (b === 0) return null;
  var prim = function (code, len) {
    if (!SIGMA_PRIMITIVE_NAMES[code]) return null;
    return { node: { kind: "prim", code: code }, length: len };
  };
  if (b < 0x60) {
    var ctor = Math.floor(b / 12);
    var embd = b % 12;
    var sub, i;
    if (ctor === 0) return prim(embd, 1);
    if (ctor === 1) {
      if (embd !== 0) { var p1 = prim(embd, 1); return p1 ? { node: { kind: "coll", elem: p1.node }, length: 1 } : null; }
      sub = parseSigmaType(bytes, offset + 1);
      return sub ? { node: { kind: "coll", elem: sub.node }, length: 1 + sub.length } : null;
    }
    if (ctor === 2) {
      var p2 = prim(embd, 0);
      return p2 ? { node: { kind: "coll", elem: { kind: "coll", elem: p2.node } }, length: 1 } : null;
    }
    if (ctor === 3 || ctor === 4) return null; /* Option types: outside this parser's set */
    if (ctor === 5) {
      if (embd !== 0) {
        var p5 = prim(embd, 0);
        if (!p5) return null;
        sub = parseSigmaType(bytes, offset + 1);
        return sub ? { node: { kind: "tuple", elems: [p5.node, sub.node] }, length: 1 + sub.length } : null;
      }
      var l5 = parseSigmaType(bytes, offset + 1);
      if (!l5) return null;
      var r5 = parseSigmaType(bytes, offset + 1 + l5.length);
      return r5 ? { node: { kind: "tuple", elems: [l5.node, r5.node] }, length: 1 + l5.length + r5.length } : null;
    }
    if (ctor === 6) {
      if (embd !== 0) {
        var p6 = prim(embd, 0);
        if (!p6) return null;
        sub = parseSigmaType(bytes, offset + 1);
        return sub ? { node: { kind: "tuple", elems: [sub.node, p6.node] }, length: 1 + sub.length } : null;
      }
      var elems6 = [], used6 = 1;
      for (i = 0; i < 3; i++) { sub = parseSigmaType(bytes, offset + used6); if (!sub) return null; elems6.push(sub.node); used6 += sub.length; }
      return { node: { kind: "tuple", elems: elems6 }, length: used6 };
    }
    if (ctor === 7) {
      if (embd !== 0) {
        var p7 = prim(embd, 0);
        return p7 ? { node: { kind: "tuple", elems: [p7.node, p7.node] }, length: 1 } : null;
      }
      var elems7 = [], used7 = 1;
      for (i = 0; i < 4; i++) { sub = parseSigmaType(bytes, offset + used7); if (!sub) return null; elems7.push(sub.node); used7 += sub.length; }
      return { node: { kind: "tuple", elems: elems7 }, length: used7 };
    }
    return null;
  }
  if (b === 0x60) {
    var lenVlq = readVlqSize(bytes, offset + 1);
    if (!lenVlq || lenVlq.value < 2 || lenVlq.value > 255) return null;
    var elems = [], used = 1 + lenVlq.length;
    for (var k = 0; k < lenVlq.value; k++) {
      var st = parseSigmaType(bytes, offset + used);
      if (!st) return null;
      elems.push(st.node); used += st.length;
    }
    return { node: { kind: "tuple", elems: elems }, length: used };
  }
  return null; /* 0x62 SUnit / 0x63 SBox / 0x64 SAvlTree and beyond: outside this parser's set */
}
function parseSigmaData(node, bytes, offset) {
  var v, i, sub;
  if (node.kind === "prim") {
    if (node.code === 1) {
      if (offset + 1 > bytes.length) return null;
      return { value: bytes[offset] === 1 ? "true" : "false", length: 1 };
    }
    if (node.code === 2) {
      if (offset + 1 > bytes.length) return null;
      return { value: String(bytes[offset] > 127 ? bytes[offset] - 256 : bytes[offset]), length: 1 };
    }
    if (node.code === 3 || node.code === 4) {
      /* SShort/SInt: fleet reads both through its 32-bit zigzag —
         see zigzagDecode32 for why the width matters at extremes. */
      v = readVlqBig(bytes, offset);
      if (!v) return null;
      return { value: zigzagDecode32(v.value).toString(), length: v.length };
    }
    if (node.code === 5) {
      v = readVlqBig(bytes, offset);
      if (!v) return null;
      return { value: zigzagDecode(v.value).toString(), length: v.length };
    }
    if (node.code === 6) {
      v = readVlqBig(bytes, offset);
      if (!v) return null;
      var n = Number(v.value);
      if (offset + v.length + n > bytes.length) return null;
      return { value: "0x" + bytesToHex(bytes.subarray(offset + v.length, offset + v.length + n)), length: v.length + n };
    }
    if (node.code === 7) {
      if (offset + 33 > bytes.length) return null;
      return { value: bytesToHex(bytes.subarray(offset, offset + 33)), length: 33 };
    }
    /* SSigmaProp: only the ProveDlog form (0xcd + group element) that fleet implements */
    if (offset + 34 > bytes.length || bytes[offset] !== 0xcd) return null;
    return { value: "proveDlog(" + bytesToHex(bytes.subarray(offset + 1, offset + 34)) + ")", length: 34 };
  }
  if (node.kind === "coll") {
    v = readVlqBig(bytes, offset);
    if (!v) return null;
    var count = Number(v.value);
    if (count > 1000000) return null;
    var elem = node.elem;
    if (elem.kind === "prim" && elem.code === 2) {
      if (offset + v.length + count > bytes.length) return null;
      return { value: "0x" + bytesToHex(bytes.subarray(offset + v.length, offset + v.length + count)), length: v.length + count };
    }
    if (elem.kind === "prim" && elem.code === 1) {
      var nbytes = Math.ceil(count / 8);
      if (offset + v.length + nbytes > bytes.length) return null;
      return { value: count + (count === 1 ? " boolean" : " booleans"), length: v.length + nbytes };
    }
    var off = offset + v.length;
    var shown = [];
    for (i = 0; i < count; i++) {
      sub = parseSigmaData(elem, bytes, off);
      if (!sub) return null;
      if (i < 8) shown.push(sub.value);
      off += sub.length;
    }
    if (count > 8) shown.push("… +" + (count - 8) + " more");
    return { value: "[" + shown.join(", ") + "]", length: off - offset };
  }
  var parts = [], off2 = offset;
  for (i = 0; i < node.elems.length; i++) {
    sub = parseSigmaData(node.elems[i], bytes, off2);
    if (!sub) return null;
    parts.push(sub.value);
    off2 += sub.length;
  }
  return { value: "(" + parts.join(", ") + ")", length: off2 - offset };
}
function parseErgoBox(boxHex) {
  var fail = function (reason) {
    return { valid: false, reason: reason, boxId: null, byteLength: null, valueNano: null, valueErg: null, ergoTree: null, creationHeight: null, tokens: null, registers: null, transactionId: null, index: null };
  };
  var cleaned = boxHex == null ? "" : String(boxHex).replace(/\s+/g, "");
  var bytes = hexToBytes(cleaned);
  if (!bytes) return fail("Enter the box's full serialized bytes as hex (an even number of 0-9/a-f characters, with or without a 0x prefix) — SDKs and node APIs produce them, and explorers link them from a box's page.");
  var pos = 0;
  var step = function (what) { return fail("Truncated box: the bytes end in the middle of the " + what + ". A full serialized box carries its value, ErgoTree, creation height, tokens, registers, creating transaction ID and output index — check the hex is complete."); };
  var valVlq = readVlqBig(bytes, pos);
  if (!valVlq) return step("value");
  var valueNano = valVlq.value;
  pos += valVlq.length;
  /* ErgoTree, delimited exactly as fleet-sdk's box reader delimits it */
  var feeBytes = hexToBytes(FEE_CONTRACT_HEX);
  var isFee = bytes.length - pos >= feeBytes.length;
  if (isFee) { for (var f = 0; f < feeBytes.length; f++) { if (bytes[pos + f] !== feeBytes[f]) { isFee = false; break; } } }
  var treeEnd;
  if (isFee) {
    treeEnd = pos + feeBytes.length;
  } else if (bytes.length - pos >= 36 && bytes[pos] === 0 && bytes[pos + 1] === 0x08 && bytes[pos + 2] === 0xcd && (bytes[pos + 3] === 0x02 || bytes[pos + 3] === 0x03)) {
    treeEnd = pos + 36;
  } else {
    if (pos >= bytes.length) return step("ErgoTree");
    var headerByte = bytes[pos];
    if ((headerByte & ERGOTREE_SIZE_FLAG) === 0) return fail("This box's ErgoTree (header byte 0x" + headerByte.toString(16).padStart(2, "0") + ") carries no size field and is not the standard P2PK tree or the miner fee contract — like fleet-sdk's box deserializer, this parser cannot tell where such a tree ends without parsing the full script, so the box is not decoded rather than guessed at.");
    var sizeVlq = readVlqBig(bytes, pos + 1);
    if (!sizeVlq) return step("ErgoTree size");
    treeEnd = pos + 1 + sizeVlq.length + Number(sizeVlq.value);
    if (treeEnd > bytes.length) return step("ErgoTree");
  }
  var ergoTreeHex = bytesToHex(bytes.subarray(pos, treeEnd));
  pos = treeEnd;
  var heightVlq = readVlqBig(bytes, pos);
  if (!heightVlq) return step("creation height");
  var creationHeight = heightVlq.value;
  pos += heightVlq.length;
  var tokCountVlq = readVlqBig(bytes, pos);
  if (!tokCountVlq) return step("token count");
  pos += tokCountVlq.length;
  var tokenCount = Number(tokCountVlq.value);
  if (tokenCount > 10000) return fail("Implausible token count (" + tokCountVlq.value.toString() + ") — these bytes do not parse as a serialized box from the token count onward; check the hex is a full box serialization, not a transaction or a candidate fragment.");
  var tokens = [];
  for (var t = 0; t < tokenCount; t++) {
    if (pos + 32 > bytes.length) return step("token ID");
    var tokenId = bytesToHex(bytes.subarray(pos, pos + 32));
    pos += 32;
    var amtVlq = readVlqBig(bytes, pos);
    if (!amtVlq) return step("token amount");
    tokens.push({ tokenId: tokenId, amount: amtVlq.value.toString() });
    pos += amtVlq.length;
  }
  var regCountVlq = readVlqBig(bytes, pos);
  if (!regCountVlq) return step("register count");
  pos += regCountVlq.length;
  var regCount = Number(regCountVlq.value);
  if (regCount > 6) return fail("Implausible register count (" + regCountVlq.value.toString() + ") — a box carries at most the six non-mandatory registers R4–R9, so these bytes do not parse as a serialized box from the registers onward.");
  var registers = [];
  for (var r = 0; r < regCount; r++) {
    var regName = "R" + (4 + r);
    var regStart = pos;
    var typeParsed = parseSigmaType(bytes, pos);
    if (!typeParsed) return fail("Register " + regName + " holds a Sigma constant whose type is outside the set this parser decodes (the primitive, collection and tuple types — for example an Option, Box or AvlTree constant). Because a register's length comes from its type, the fields after it cannot be located safely, so the box is not decoded rather than guessed at.");
    pos += typeParsed.length;
    var dataParsed = parseSigmaData(typeParsed.node, bytes, pos);
    if (!dataParsed) return fail("Register " + regName + " (" + sigmaTypeName(typeParsed.node) + ") is truncated or holds a constant form this parser does not decode, so the fields after it cannot be located safely — the box is not decoded rather than guessed at.");
    pos += dataParsed.length;
    registers.push({ name: regName, type: sigmaTypeName(typeParsed.node), value: dataParsed.value, rawHex: bytesToHex(bytes.subarray(regStart, pos)) });
  }
  if (pos + 32 > bytes.length) return step("creating transaction ID");
  var transactionId = bytesToHex(bytes.subarray(pos, pos + 32));
  pos += 32;
  var indexVlq = readVlqBig(bytes, pos);
  if (!indexVlq) return step("output index");
  pos += indexVlq.length;
  if (pos !== bytes.length) return fail("There are " + (bytes.length - pos) + " extra byte(s) after the output index — a full serialized box ends exactly there, so this hex carries trailing data (it may be a whole transaction, or two boxes pasted together).");
  return {
    valid: true, reason: null,
    boxId: bytesToHex(blake2b256(bytes)),
    byteLength: bytes.length,
    valueNano: valueNano.toString(),
    valueErg: nanoToErg(valueNano.toString()),
    ergoTree: ergoTreeHex,
    creationHeight: Number(creationHeight),
    tokens: tokens,
    registers: registers,
    transactionId: transactionId,
    index: Number(indexVlq.value)
  };
}

/* ---------- Sigma constant inspector ---------- */
/* A single Sigma constant, standalone — the exact bytes a box's
   R4–R9 register holds, which is how explorers and node APIs display
   a register on its own (for example a babel box's R5 price, tool
   12). Until now the only way to read one on this hub was to embed
   it in a whole box for tool 15. This decodes one constant exactly
   as tool 15's register reader does — same type byte (primitive
   codes 1-8; collection and tuple types constructor-coded), same
   data readers, same integer widths (Short/Int through fleet-sdk's
   32-bit zigzag, Long through its 64-bit one, so the extremes read
   back correctly). The constant must consume the input exactly:
   trailing bytes mean the paste is not one constant (it may be two
   registers, or a whole box — tool 15 takes those), and a type
   outside the parser's set (an Option, Box or AvlTree constant, or
   a SigmaProp that is not the ProveDlog form fleet implements)
   stops the decode plainly rather than guessing a length. The
   encode direction is tool 17's encodeSigmaConstant, unchanged. */
function decodeSigmaConstant(constHex) {
  var fail = function (reason) {
    return { valid: false, reason: reason, type: null, value: null, byteLength: null, rawHex: null };
  };
  var cleaned = constHex == null ? "" : String(constHex).replace(/\s+/g, "");
  var bytes = hexToBytes(cleaned);
  if (!bytes) return fail("Enter one Sigma constant as hex (an even number of 0-9/a-f characters, with or without a 0x prefix) — explorers and node APIs show a box's registers in exactly this form.");
  var typeParsed = parseSigmaType(bytes, 0);
  if (!typeParsed) return fail("This constant's type byte (0x" + bytes[0].toString(16).padStart(2, "0") + ") is outside the set this inspector decodes (the primitive, collection and tuple types — for example an Option, Box or AvlTree constant). Because a constant's length comes from its type, it is not decoded rather than guessed at.");
  var dataParsed = parseSigmaData(typeParsed.node, bytes, typeParsed.length);
  if (!dataParsed) return fail("This " + sigmaTypeName(typeParsed.node) + " constant is truncated or holds a data form this inspector does not decode (a SigmaProp, for example, is only decoded in its ProveDlog form) — it is not decoded rather than guessed at.");
  var used = typeParsed.length + dataParsed.length;
  if (used !== bytes.length) return fail("There are " + (bytes.length - used) + " extra byte(s) after this " + sigmaTypeName(typeParsed.node) + " constant — one constant ends exactly there, so this hex carries more than one constant (it may be several registers pasted together, or a whole box, which tool 15 takes).");
  return {
    valid: true, reason: null,
    type: sigmaTypeName(typeParsed.node),
    value: dataParsed.value,
    byteLength: bytes.length,
    rawHex: bytesToHex(bytes)
  };
}

/* ---------- Serialized box builder ---------- */
/* The encode-side inverse of tool 15, in the exact layout fleet-sdk's
   serializeBox writes: [value: unsigned BigInt VLQ][ErgoTree bytes
   verbatim][creation height: VLQ][token count VLQ, then per token a
   32-byte ID + an unsigned VLQ amount][register count VLQ, then that
   many Sigma constants for R4, R5, ...][creating transaction ID:
   32 bytes][output index: VLQ], and the box ID is the Blake2b-256 of
   the whole thing (tool 14). Registers are entered as typed specs and
   encoded the way fleet-sdk's dataSerializer encodes constants: a
   type byte (primitive codes 1-8; a collection is constructor-coded
   12 + the element's primitive code), then the data — one byte for a
   boolean (01/00) or a byte, a zigzag VLQ for Short/Int/Long, a VLQ
   byte-length + minimal two's-complement big-endian bytes for BigInt,
   33 bytes for a group element, the 0xcd ProveDlog opcode + 33 bytes
   for a SigmaProp, a VLQ length + elements for collections. One
   reference quirk is mirrored deliberately, because fleet's published
   constant vectors are the compatibility target: SInt (and SShort,
   which shares the code path) zigzag in signed 32-bit space and a
   negative 32-bit result is then written as its unsigned 64-bit form,
   so SInt 2147483647 serializes as 04feffffffffffffffff01 — exactly
   fleet's vector — and not as the shorter clean zigzag. The built
   bytes are round-tripped through tool 15's parser before they are
   shown, and every field (including each register's type and raw
   bytes) must read back exactly, so a tree the parser cannot delimit
   (tool 15's stated limits) is refused rather than emitted
   unverified. Verified in the tests by rebuilding fleet-sdk's
   published box vectors byte-for-byte from their recorded fields and
   fleet's published Sigma constant vectors for every register type,
   cross-checked with an independent Python build on 2026-10-07. A
   built box is just bytes: it exists on no chain until a signed
   transaction creating it is accepted, and this tool signs nothing. */
function writeVlqBig(value) {
  var v = value;
  var out = [];
  do {
    var b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return out;
}
function zigzagEncode(v) {
  return v >= 0n ? (v << 1n) : ((-v << 1n) - 1n);
}
/* fleet-sdk writeI16/writeI32: zigzag in signed 32-bit space, then a
   negative result is written as its unsigned 64-bit form. */
function sigmaIntZigzag(v) {
  var z = (v << 1) ^ (v >> 31);
  return z >= 0 ? BigInt(z) : BigInt(z) + 18446744073709551616n;
}
/* Minimal two's-complement big-endian bytes (fleet-sdk bigIntToHex). */
function bigIntToSigmaBytes(v) {
  var n = 1;
  while (n <= 64) {
    var lo = -(1n << BigInt(8 * n - 1));
    var hi = (1n << BigInt(8 * n - 1)) - 1n;
    if (v >= lo && v <= hi) break;
    n++;
  }
  var u = v < 0n ? (1n << BigInt(8 * n)) + v : v;
  var out = [];
  for (var i = n - 1; i >= 0; i--) out.push(Number((u >> BigInt(8 * i)) & 0xffn));
  return out;
}
var SIGMA_SPEC_KINDS = "bool:true|false, byte:<-128..127>, short:<-32768..32767>, int:<-2147483648..2147483647>, long:<integer>, bigint:<integer>, group:<66 hex chars>, dlog:<66 hex chars>, bytes:<hex>, ints:<n,n,...>, longs:<n,n,...>";
function encodeSigmaConstant(spec) {
  var fail = function (reason) { return { valid: false, reason: reason }; };
  var s = spec == null ? "" : String(spec).trim();
  var colon = s.indexOf(":");
  if (colon < 1) return fail("Register spec \"" + s + "\" is not in kind:value form — use one of: " + SIGMA_SPEC_KINDS + ".");
  var kind = s.slice(0, colon).trim().toLowerCase();
  var val = s.slice(colon + 1).trim();
  var intStr = function (x) { return /^-?\d+$/.test(x); };
  var ranged = function (x, lo, hi) { return intStr(x) && BigInt(x) >= lo && BigInt(x) <= hi; };
  var done = function (typeByte, data, typeName, value) {
    return { valid: true, typeName: typeName, value: value, bytes: [typeByte].concat(data), rawHex: bytesToHex(Uint8Array.from([typeByte].concat(data))) };
  };
  if (kind === "bool") {
    if (val !== "true" && val !== "false") return fail("A bool register is bool:true or bool:false — got \"" + s + "\".");
    return done(1, [val === "true" ? 1 : 0], "SBoolean", val);
  }
  if (kind === "byte") {
    if (!ranged(val, -128n, 127n)) return fail("A byte register is a signed byte, -128 to 127 — got \"" + s + "\".");
    return done(2, [Number(BigInt(val)) & 0xff], "SByte", String(Number(BigInt(val))));
  }
  if (kind === "short") {
    if (!ranged(val, -32768n, 32767n)) return fail("A short register is a signed 16-bit integer — got \"" + s + "\".");
    return done(3, writeVlqBig(sigmaIntZigzag(Number(val))), "SShort", String(Number(val)));
  }
  if (kind === "int") {
    if (!ranged(val, -2147483648n, 2147483647n)) return fail("An int register is a signed 32-bit integer — got \"" + s + "\".");
    return done(4, writeVlqBig(sigmaIntZigzag(Number(val))), "SInt", String(Number(val)));
  }
  if (kind === "long") {
    if (!ranged(val, -9223372036854775808n, 9223372036854775807n)) return fail("A long register is a signed 64-bit integer — got \"" + s + "\".");
    return done(5, writeVlqBig(zigzagEncode(BigInt(val))), "SLong", BigInt(val).toString());
  }
  if (kind === "bigint") {
    if (!intStr(val)) return fail("A bigint register is a decimal integer of any size (up to a 256-bit value) — got \"" + s + "\".");
    var bb = bigIntToSigmaBytes(BigInt(val));
    if (bb.length > 32) return fail("That bigint needs " + bb.length + " bytes — a Sigma BigInt constant holds at most a 256-bit value (32 bytes).");
    return done(6, writeVlqBig(BigInt(bb.length)).concat(bb), "SBigInt", "0x" + bytesToHex(Uint8Array.from(bb)));
  }
  if (kind === "group" || kind === "dlog") {
    var gb = hexToBytes(val.toLowerCase());
    if (!gb || gb.length !== 33 || (gb[0] !== 0x02 && gb[0] !== 0x03)) return fail("A " + kind + " register is a compressed group element: 33 bytes, 66 hex characters, starting 02 or 03 — got \"" + s + "\".");
    if (kind === "group") return done(7, Array.from(gb), "SGroupElement", bytesToHex(gb));
    return done(8, [0xcd].concat(Array.from(gb)), "SSigmaProp", "proveDlog(" + bytesToHex(gb) + ")");
  }
  if (kind === "bytes") {
    var cb = val === "" ? new Uint8Array(0) : hexToBytes(val.toLowerCase());
    if (!cb) return fail("A bytes register is Coll[SByte] given as hex (possibly empty) — got \"" + s + "\".");
    return done(14, writeVlqBig(BigInt(cb.length)).concat(Array.from(cb)), "Coll[SByte]", "0x" + bytesToHex(cb));
  }
  if (kind === "ints" || kind === "longs") {
    var parts = val === "" ? [] : val.split(",").map(function (p) { return p.trim(); });
    var isInt = kind === "ints";
    var lo = isInt ? -2147483648n : -9223372036854775808n;
    var hi = isInt ? 2147483647n : 9223372036854775807n;
    for (var i = 0; i < parts.length; i++) {
      if (!ranged(parts[i], lo, hi)) return fail("Each element of " + kind + ": must be a signed " + (isInt ? "32" : "64") + "-bit integer — got \"" + parts[i] + "\" in \"" + s + "\".");
    }
    var data = writeVlqBig(BigInt(parts.length));
    var shown = [];
    for (var j = 0; j < parts.length; j++) {
      data = data.concat(writeVlqBig(isInt ? sigmaIntZigzag(Number(parts[j])) : zigzagEncode(BigInt(parts[j]))));
      if (j < 8) shown.push(BigInt(parts[j]).toString());
    }
    if (parts.length > 8) shown.push("… +" + (parts.length - 8) + " more");
    return done(isInt ? 16 : 17, data, isInt ? "Coll[SInt]" : "Coll[SLong]", "[" + shown.join(", ") + "]");
  }
  return fail("Unknown register kind \"" + kind + "\" — use one of: " + SIGMA_SPEC_KINDS + ".");
}
function buildErgoBox(fields) {
  var fail = function (reason) {
    return { valid: false, reason: reason, boxHex: null, boxId: null, byteLength: null, registers: null };
  };
  if (!fields) return fail("No fields supplied.");
  var digits = function (x) { return typeof x === "string" && /^\d+$/.test(x.trim()); };
  if (!digits(fields.valueNano)) return fail("Enter the box value as a whole number of nanoERG (digits only — tool 1 converts ERG to nanoERG).");
  var value = BigInt(fields.valueNano.trim());
  if (value < 1n || value > 9223372036854775807n) return fail("A box value is a positive signed 64-bit amount of nanoERG (1 to 9,223,372,036,854,775,807) — and a spendable box must also clear the minimum-value rule in tool 5.");
  var treeBytes = hexToBytes(fields.ergoTree);
  if (!treeBytes) return fail("Enter the guarding script's ErgoTree as hex (an even number of 0-9/a-f characters, with or without a 0x prefix) — tool 15 shows the tree of any existing box, and tools 8 and 11 produce trees from keys and addresses.");
  if (!digits(fields.creationHeight)) return fail("Enter the creation height as a whole block number (digits only). It is normally the height of the block the creating transaction is mined in.");
  var height = Number(fields.creationHeight.trim());
  if (!Number.isSafeInteger(height) || height > 4294967295) return fail("A creation height is an unsigned 32-bit block number (0 to 4,294,967,295).");
  var tokens = fields.tokens || [];
  var tokenBytes = [];
  for (var t = 0; t < tokens.length; t++) {
    var idBytes = hexToBytes(tokens[t] && tokens[t].tokenId);
    if (!idBytes || idBytes.length !== 32) return fail("Token " + (t + 1) + ": a token ID is 32 bytes, 64 hex characters — got \"" + (tokens[t] && tokens[t].tokenId) + "\".");
    if (!digits(tokens[t].amount)) return fail("Token " + (t + 1) + ": enter the amount as a whole raw integer (digits only — tool 6 converts display amounts to raw).");
    var amt = BigInt(tokens[t].amount.trim());
    if (amt < 1n || amt > 9223372036854775807n) return fail("Token " + (t + 1) + ": a token amount is a positive signed 64-bit raw integer.");
    tokenBytes.push({ id: idBytes, amount: amt });
  }
  var regSpecs = fields.registers || [];
  if (regSpecs.length > 6) return fail("A box carries at most the six non-mandatory registers R4–R9 — " + regSpecs.length + " were given.");
  var regBytes = [];
  for (var r = 0; r < regSpecs.length; r++) {
    var enc = encodeSigmaConstant(regSpecs[r]);
    if (!enc.valid) return fail("Register R" + (4 + r) + ": " + enc.reason);
    regBytes.push(enc);
  }
  var txBytes = hexToBytes(fields.transactionId);
  if (!txBytes || txBytes.length !== 32) return fail("Enter the creating transaction's ID as 32 bytes, 64 hex characters. It is part of the serialization — a different ID makes a different box with a different box ID.");
  if (!digits(fields.index)) return fail("Enter the output index as a whole number (the box's position among the creating transaction's outputs, starting at 0).");
  var index = Number(fields.index.trim());
  if (!Number.isSafeInteger(index) || index > 65535) return fail("An output index is an unsigned 16-bit number (0 to 65,535).");
  var bytes = [];
  var push = function (arr) { for (var i = 0; i < arr.length; i++) bytes.push(arr[i]); };
  push(writeVlqBig(value));
  push(Array.from(treeBytes));
  push(writeVlqBig(BigInt(height)));
  push(writeVlqBig(BigInt(tokenBytes.length)));
  tokenBytes.forEach(function (tk) { push(Array.from(tk.id)); push(writeVlqBig(tk.amount)); });
  push(writeVlqBig(BigInt(regBytes.length)));
  regBytes.forEach(function (rg) { push(rg.bytes); });
  push(Array.from(txBytes));
  push(writeVlqBig(BigInt(index)));
  var boxHex = bytesToHex(Uint8Array.from(bytes));
  var parsed = parseErgoBox(boxHex);
  if (!parsed.valid) return fail("These fields assemble, but the result does not read back through the box parser (tool 15): " + parsed.reason + " The bytes are refused rather than shown unverified.");
  var roundTripped = parsed.valueNano === value.toString() &&
    parsed.ergoTree === bytesToHex(treeBytes) &&
    parsed.creationHeight === height &&
    parsed.transactionId === bytesToHex(txBytes) &&
    parsed.index === index &&
    parsed.tokens.length === tokenBytes.length &&
    parsed.registers.length === regBytes.length &&
    parsed.tokens.every(function (tk, i) { return tk.tokenId === bytesToHex(tokenBytes[i].id) && tk.amount === tokenBytes[i].amount.toString(); }) &&
    parsed.registers.every(function (rg, i) { return rg.type === regBytes[i].typeName && rg.value === regBytes[i].value && rg.rawHex === regBytes[i].rawHex; });
  if (!roundTripped) return fail("Internal round-trip check failed: the assembled bytes do not parse back to exactly these fields — refusing to show them rather than risk a mismatched box.");
  return {
    valid: true, reason: null,
    boxHex: boxHex,
    boxId: parsed.boxId,
    byteLength: bytes.length,
    registers: regBytes.map(function (rg, i) { return { name: "R" + (4 + i), type: rg.typeName, value: rg.value, rawHex: rg.rawHex }; })
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { blake2b256, base58Decode, base58Encode, p2pkAddressFromPublicKey, checkErgoAddress, ergToNano, nanoToErg, NANO_PER_ERG, ADDRESS_TYPES, storageRentNano, analyzeStorageRent, STORAGE_FEE_FACTOR_NANO_PER_BYTE, STORAGE_PERIOD_BLOCKS, minBoxValueNano, analyzeMinBoxValue, MIN_VALUE_PER_BYTE_NANO, SAFE_USER_MIN_BOX_NANO, BLOCKS_PER_DAY, HASHRATE_UNITS, hashrateToHps, estimateMining, fmtEstimate, TOKEN_MAX_DECIMALS, parseTokenDecimals, tokenRawToDisplay, tokenDisplayToRaw, parseChainHeight, analyzeRentCountdown, parseBoxList, planPayment, hexToBytes, bytesToHex, readVlqSize, addressFromContent, analyzeErgoTree, decodeErgoAddress, buildP2SAddress, convertAddressNetwork, ERGOTREE_SIZE_FLAG, ERGOTREE_SEGREGATION_FLAG, P2SH_HASH_BYTES, parseBabelPrice, analyzeBabelFee, analyzeBoxId, FEE_CONTRACT_HEX, SIGMA_PRIMITIVE_NAMES, readVlqBig, zigzagDecode, zigzagDecode32, sigmaTypeName, parseSigmaType, parseSigmaData, parseErgoBox, writeVlqBig, zigzagEncode, sigmaIntZigzag, bigIntToSigmaBytes, encodeSigmaConstant, buildErgoBox, decodeSigmaConstant, buildP2PKTree, buildP2SHAddress, utf8Bytes, analyzeBlake2b };
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

    /* --- token amount converter --- */
    document.getElementById("token-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("token-result");
      var decVal = document.getElementById("token-decimals").value;
      var rawVal = document.getElementById("token-raw").value;
      var dispVal = document.getElementById("token-display").value;
      if (parseTokenDecimals(decVal) === null) {
        out.textContent = "Enter the token's decimals first — a whole number from 0 to 18, exactly as listed for the token on the explorer. The conversion depends on it entirely.";
        return;
      }
      if (rawVal.trim() !== "") {
        var disp = tokenRawToDisplay(rawVal, decVal);
        out.textContent = disp === null
          ? "Enter the raw amount as a whole number — on-chain token amounts are integers, with no decimal point."
          : rawVal.trim() + " raw = " + disp + " displayed, at " + decVal.trim() + " decimals. Exact maths, done locally.";
        if (disp !== null) document.getElementById("token-display").value = disp;
      } else if (dispVal.trim() !== "") {
        var raw = tokenDisplayToRaw(dispVal, decVal);
        out.textContent = raw === null
          ? "Enter a display amount with no more decimal places than the token's decimals — anything smaller than one raw unit cannot exist on-chain."
          : dispVal.trim() + " displayed = " + raw + " raw, at " + decVal.trim() + " decimals. Exact maths, done locally.";
        if (raw !== null) document.getElementById("token-raw").value = raw;
      } else {
        out.textContent = "Fill in one side — the raw on-chain amount or the display amount — and I will convert the other.";
      }
    });

    /* --- storage rent countdown --- */
    document.getElementById("rent-clock-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("rent-clock-result");
      var res = analyzeRentCountdown(document.getElementById("rentclock-created").value, document.getElementById("rentclock-current").value);
      if (res === null) {
        out.textContent = "Enter both heights as whole block numbers, with the current height at or above the box's creation height — both are on the box's and the chain's explorer pages.";
        return;
      }
      var msg = "This box is " + res.ageBlocks + " blocks old. It becomes eligible for storage rent at height " + res.eligibilityHeight + " (its creation height + 1,051,200 blocks). ";
      if (res.eligible) {
        msg += "⚠ It is already past that height: a miner may now deduct storage rent from it (tool 3 estimates the fee), or spend it whole if its ERG does not cover the rent. Move it to a fresh box to reset the clock.";
      } else {
        msg += "That is " + res.blocksRemaining + " blocks away — roughly " + fmtEstimate(res.approxDaysRemaining) + " days at the 2-minute block target (an approximation: real block intervals vary). Spending the box before then resets the clock, because the replacement box gets a new creation height.";
      }
      out.textContent = msg;
    });

    /* --- P2PK address builder --- */
    document.getElementById("p2pk-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("p2pk-result");
      var netLabel = document.getElementById("p2pk-network").value;
      var addr = p2pkAddressFromPublicKey(document.getElementById("p2pk-pubkey").value, netLabel);
      if (addr === null) {
        out.textContent = "Enter a compressed public key as 66 hex characters starting 02 or 03 — public keys only: never enter a private key or seed phrase anywhere, including here.";
        return;
      }
      var check = checkErgoAddress(addr);
      out.textContent = "Your " + netLabel + " P2PK address: " + addr + " — built locally as prefix byte + your key + the Blake2b-256 checksum, and it passes the checker in tool 2 (" + (check.valid ? check.network + ", " + check.type : "verification failed") + "). Construction only: it proves the address is well-formed for that key, not who owns the key.";
    });

    /* --- UTXO payment planner --- */
    document.getElementById("payplan-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("payplan-result");
      var res = planPayment(document.getElementById("payplan-boxes").value, document.getElementById("payplan-amount").value, document.getElementById("payplan-fee").value);
      if (res === null) {
        out.textContent = "List your box values in ERG (comma or space separated, each above zero), a payment above zero, and the transaction fee in ERG (0 or more — 0.001 ERG is the usual minimum fee wallets charge).";
        return;
      }
      if (!res.sufficient) {
        out.textContent = "✗ Not enough: paying " + res.neededErg + " ERG including the fee needs " + res.neededNano + " nanoERG, but all " + res.boxCount + (res.boxCount === 1 ? " box holds" : " boxes hold") + " only " + res.totalErg + " ERG (" + res.totalNano + " nanoERG) — short by " + res.shortfallErg + " ERG (" + res.shortfallNano + " nanoERG). Planning only: nothing was signed or sent.";
        return;
      }
      var msg = "✓ Covered: the first " + res.selectedCount + " of your " + res.boxCount + (res.boxCount === 1 ? " box" : " boxes") + " (in the order listed) total " + res.totalSelectedErg + " ERG (" + res.totalSelectedNano + " nanoERG), covering the " + res.neededErg + " ERG payment + fee. ";
      if (res.changeNano === "0") {
        msg += "That is an exact spend — no change box comes back. ";
      } else if (res.changeIsDust) {
        msg += "⚠ The change would be only " + res.changeErg + " ERG (" + res.changeNano + " nanoERG) — dust below the recommended 0.001 ERG safe minimum per box (tool 5). A real wallet would usually fold dust like this into the fee or pick different boxes rather than create a near-worthless change box. ";
      } else {
        msg += "Change coming back to you in a new box: " + res.changeErg + " ERG (" + res.changeNano + " nanoERG). ";
      }
      if (res.unselectedCount > 0) msg += res.unselectedCount + (res.unselectedCount === 1 ? " box stays" : " boxes stay") + " unspent. ";
      msg += "Planning only, done locally: box selection order differs between wallets, and nothing was signed or sent.";
      out.textContent = msg;
    });

    /* --- ErgoTree inspector --- */
    document.getElementById("tree-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("tree-result");
      var netLabel = document.getElementById("tree-network").value;
      var res = analyzeErgoTree(document.getElementById("tree-hex").value, netLabel);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var head = "Header byte 0x" + res.header.toString(16).padStart(2, "0") + " — version " + res.version +
        (res.sizeFlag ? ", with a VLQ proposition size (" + res.declaredSize + " bytes)" : ", no size field") +
        (res.segregated ? ", constants segregated" : ", constants inline") + ". ";
      if (res.segregated) {
        out.textContent = head + res.reason;
        return;
      }
      var msg = head + "Proposition: " + res.propositionLength + " bytes. ";
      if (res.isP2PK) {
        msg += "This is the standard P2PK script (ProveDlog) for public key " + res.publicKey + ". A box guarded by it has the " + res.network + " P2PK address " + res.address + " — it passes tool 2's checksum, and tool 8 builds the same address from the key alone. ";
      }
      msg += "The script's " + res.network + " P2SH (pay-to-script-hash) address is " + res.p2shAddress + " — prefix byte + the first 24 bytes of Blake2b-256 over the proposition bytes (not the whole tree: hashing the header in is the fleet-sdk #219 bug that made unspendable addresses). Inspection only, done locally: deriving an address proves nothing about who can spend the box.";
      out.textContent = msg;
    });

    /* --- address -> ErgoTree decoder --- */
    document.getElementById("addrtree-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("addrtree-result");
      var res = decodeErgoAddress(document.getElementById("addrtree-in").value);
      if (!res.valid) {
        out.textContent = "✗ " + (res.network ? res.network + ", " + res.type + " — but: " : "") + res.reason;
        return;
      }
      var head = "✓ Valid " + res.network + " " + res.type + " address (prefix byte 0x" + res.prefix.toString(16).padStart(2, "0") + ") — checksum verified, the same check as tool 2. ";
      if (res.typeCode === 1) {
        out.textContent = res.ergoTree
          ? head + "Its content is the public key " + res.publicKey + ", so its ErgoTree is " + res.ergoTree + " (36 bytes: header 00 + the 08cd ProveDlog proposition + the key). Paste that hex into tool 10 and it derives this same address back, plus the script's P2SH form. Decoding only, done locally: it shows what the address carries, not who owns the key."
          : head + res.note + " Decoding only, done locally.";
      } else if (res.typeCode === 2) {
        out.textContent = head + "Its content is the script hash " + res.scriptHash + " (" + res.contentBytes + " bytes). " + (res.note || "") + " Decoding only, done locally.";
      } else {
        var msg = head + "A P2S address carries the script itself, so its ErgoTree is its content verbatim: " + res.ergoTree + " (" + res.contentBytes + " bytes). ";
        if (res.note) {
          msg += res.note + " ";
        } else if (res.treeInfo && res.treeInfo.segregated) {
          msg += "Tool 10's parser reads its header (0x" + res.treeInfo.header.toString(16).padStart(2, "0") + ") as a constant-segregated tree, so — same honesty rule as tool 10 — no P2SH address is derived from it here. ";
        } else if (res.treeInfo) {
          msg += "Tool 10's parser reads that tree's proposition as " + res.treeInfo.propositionLength + " bytes and derives the script's " + res.network + " P2SH address: " + res.treeInfo.p2shAddress + ". ";
        }
        out.textContent = msg + "Decoding only, done locally: it shows what the address carries, not who can spend a box it guards.";
      }
    });

    /* --- Babel fee calculator --- */
    document.getElementById("babel-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("babel-result");
      var res = analyzeBabelFee(document.getElementById("babel-fee").value, document.getElementById("babel-price").value, document.getElementById("babel-decimals").value);
      if (res === null) {
        out.textContent = "Enter the ERG amount you need (above zero, up to 9 decimal places), the babel box's price as a whole number of nanoERG per raw token unit (its R5 register on the explorer), and the token's decimals (0 to 18).";
        return;
      }
      var msg = "Swapping " + res.tokensRaw + " raw tokens (" + res.tokensDisplay + " displayed at " + res.decimals + " decimals) at " + res.priceNano + " nanoERG per raw token unit releases " + res.coveredErg + " ERG (" + res.coveredNano + " nanoERG) from the babel box. ";
      msg += res.excessNano === "0"
        ? "That covers the " + res.feeErg + " ERG you need exactly — no overhang. "
        : "That covers the " + res.feeErg + " ERG you need, with " + res.excessErg + " ERG (" + res.excessNano + " nanoERG) to spare — one token fewer would come up short, and the spare ERG stays in your transaction. ";
      msg += "Planning only, done locally: check on the explorer that the babel box actually holds at least " + res.coveredErg + " ERG and still quotes this price before building a transaction — boxes get spent and recreated at new prices. Nothing was signed or sent.";
      out.textContent = msg;
    });

    /* --- Address network converter --- */
    document.getElementById("netconv-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("netconv-result");
      var res = convertAddressNetwork(document.getElementById("netconv-in").value);
      if (!res.valid) {
        out.textContent = res.reason + " Fix the address and try again — I only convert addresses whose checksum verifies.";
        return;
      }
      out.textContent = "That is a " + res.network + " " + res.type + " address, and its content is identical on both networks — only the prefix byte changes. The same address on " + res.convertedNetwork + " is: " + res.converted + " — Converting moves no funds and proves no ownership: the converted address guards boxes on " + res.convertedNetwork + " only, and sending " + res.network + " ERG to it would lose them. Converted locally; nothing was signed or sent.";
    });

    /* --- Box ID calculator --- */
    document.getElementById("boxid-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("boxid-result");
      var res = analyzeBoxId(document.getElementById("boxid-bytes").value, document.getElementById("boxid-expected").value);
      if (!res) {
        out.textContent = "That is not a valid serialized box: I need the full box bytes as even-length hex (and, if you enter an expected ID, a full 64-character hex ID). Nothing was hashed.";
        return;
      }
      var msg = "Those " + res.byteLength + " bytes hash to box ID: " + res.boxId + ". ";
      if (res.matches === true) msg += "That matches the expected box ID you entered — the bytes are exactly that box. ";
      else if (res.matches === false) msg += "That does NOT match the expected box ID you entered (" + res.expected + ") — the bytes differ from that box somewhere: a single changed byte changes the whole ID. ";
      msg += "Remember a token minted in a transaction takes this same value — the box ID of the transaction's first input — as its token ID. Computed locally with Blake2b-256; nothing was fetched, signed or sent.";
      out.textContent = msg;
    });

    /* --- Blake2b-256 hash calculator --- */
    document.getElementById("hash-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("hash-result");
      var res = analyzeBlake2b(document.getElementById("hash-input").value, document.getElementById("hash-mode").value, document.getElementById("hash-expected").value);
      if (!res) {
        out.textContent = "I could not hash that: hex mode needs even-length hex bytes (or empty, to hash zero bytes), and an expected digest, if entered, must be a full 64-character hex digest. Nothing was hashed.";
        return;
      }
      var msg = "Blake2b-256 of those " + res.byteLength + " byte(s) (" + res.mode + " input) is: " + res.digest + ". Its first 24 bytes — the hash192 form a P2SH address carries (tools 10 and 20) — are: " + res.hash192 + ". ";
      if (res.matches === true) msg += "That matches the expected digest you entered. ";
      else if (res.matches === false) msg += "That does NOT match the expected digest you entered (" + res.expected + ") — a single changed byte changes the whole digest. ";
      msg += "This is the same hash behind box IDs (tool 14) and address checksums. Computed locally; nothing was fetched, signed or sent.";
      out.textContent = msg;
    });

    /* --- Serialized box parser --- */
    document.getElementById("boxparse-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("boxparse-result");
      var res = parseErgoBox(document.getElementById("boxparse-bytes").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Parsed " + res.byteLength + " bytes — box ID " + res.boxId + " (the same Blake2b-256 tool 14 computes, so the two tools agree by construction). " +
        "Value: " + res.valueErg + " ERG (" + res.valueNano + " nanoERG). " +
        "ErgoTree (" + (res.ergoTree.length / 2) + " bytes): " + res.ergoTree + " — paste it into tool 10 to inspect the script and derive its addresses. " +
        "Created at height " + res.creationHeight + " by transaction " + res.transactionId + ", output index " + res.index + ". ";
      if (res.tokens.length === 0) {
        msg += "Tokens: none. ";
      } else {
        msg += "Tokens (" + res.tokens.length + "): " + res.tokens.map(function (tk) { return tk.amount + " raw of " + tk.tokenId; }).join("; ") + ". Token amounts are the raw on-chain integers — tool 6 converts them to display form once you know each token's decimals. ";
      }
      if (res.registers.length === 0) {
        msg += "Registers: none set (only the mandatory R0–R3, which are the value, script, tokens and creation height already shown). ";
      } else {
        msg += "Registers: " + res.registers.map(function (rg) { return rg.name + " = " + rg.value + " (" + rg.type + ", raw " + rg.rawHex + ")"; }).join("; ") + ". ";
      }
      msg += "Parsed locally, field by field; nothing was fetched, signed or sent.";
      out.textContent = msg;
    });

    /* --- P2S address builder --- */
    document.getElementById("p2s-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("p2s-result");
      var res = buildP2SAddress(document.getElementById("p2s-hex").value, document.getElementById("p2s-network").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Your " + res.network + " P2S address: " + res.address + " — built locally as prefix byte " + (res.network === "Mainnet" ? "0x03" : "0x13") + " + the script's full " + res.byteLength + "-byte ErgoTree + the Blake2b-256 checksum, and round-tripped through tool 11's decoder, which reads back this exact tree. ";
      msg += res.isP2PK
        ? "This script is the standard P2PK proposition, so tool 10 also derives its ordinary P2PK address — a box meant to be spent by that key alone is normally guarded by the P2PK address, not this P2S form. "
        : res.segregated
          ? "This is a constant-segregated tree — the case tool 10 honestly declines to derive a P2SH address for, because the reference script hash needs the constants substituted back in. As P2S content the bytes are unambiguous, so this address is exact. "
          : "Compare tool 10's P2SH address for the same script: short and hash-only, but the script stays hidden until a box is spent; this P2S address reveals the script to anyone who sees it. ";
      msg += "Construction only: it proves the address is well-formed for this script, not who can spend a box it guards — that depends on the script itself. Nothing was fetched, signed or sent.";
      out.textContent = msg;
    });

    /* --- Serialized box builder --- */
    document.getElementById("boxbuild-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("boxbuild-result");
      var tokenLines = document.getElementById("boxbuild-tokens").value.split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ""; });
      var tokens = [];
      for (var i = 0; i < tokenLines.length; i++) {
        var parts = tokenLines[i].split(/[\s,]+/).filter(function (p) { return p !== ""; });
        if (parts.length !== 2) {
          out.textContent = "✗ Token line " + (i + 1) + " must be exactly: a 64-character token ID, a space, then the raw amount.";
          return;
        }
        tokens.push({ tokenId: parts[0], amount: parts[1] });
      }
      var registers = document.getElementById("boxbuild-registers").value.split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ""; });
      var res = buildErgoBox({
        valueNano: document.getElementById("boxbuild-value").value,
        ergoTree: document.getElementById("boxbuild-tree").value,
        creationHeight: document.getElementById("boxbuild-height").value,
        tokens: tokens,
        registers: registers,
        transactionId: document.getElementById("boxbuild-txid").value,
        index: document.getElementById("boxbuild-index").value
      });
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Built a " + res.byteLength + "-byte serialized box, and round-tripped it through tool 15's parser — every field reads back exactly, so its box ID (tool 14) is " + res.boxId + ". Serialized bytes: " + res.boxHex + " ";
      msg += res.registers.length === 0
        ? "Registers: none set. "
        : "Registers: " + res.registers.map(function (rg) { return rg.name + " = " + rg.value + " (" + rg.type + ", raw " + rg.rawHex + ")"; }).join("; ") + ". ";
      msg += "Construction only: these bytes are a box on paper — a box exists on-chain only once a signed transaction creating it is accepted, and this tool signs and sends nothing.";
      out.textContent = msg;
    });

    /* --- Sigma constant inspector --- */
    document.getElementById("sigma-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("sigma-result");
      var hexVal = document.getElementById("sigma-hex").value;
      var specVal = document.getElementById("sigma-spec").value;
      if (hexVal.trim() !== "") {
        var dec = decodeSigmaConstant(hexVal);
        if (!dec.valid) {
          out.textContent = "✗ " + dec.reason;
          return;
        }
        out.textContent = "✓ That is one " + dec.type + " constant, " + dec.byteLength + (dec.byteLength === 1 ? " byte" : " bytes") + " — value: " + dec.value + ". Decoded locally with the same reader tool 15 uses for a box's registers, at the same integer widths, so what an explorer shows for a register (a babel box's R5 price, say) reads back as the value that was written. Decoding only: it shows what the constant holds, not what any script does with it.";
        return;
      }
      if (specVal.trim() !== "") {
        var enc = encodeSigmaConstant(specVal);
        if (!enc.valid) {
          out.textContent = "✗ " + enc.reason;
          return;
        }
        var back = decodeSigmaConstant(enc.rawHex);
        if (!back.valid || back.type !== enc.typeName || back.value !== enc.value) {
          out.textContent = "✗ Internal round-trip check failed: the encoded constant does not decode back to exactly this value — refusing to show it rather than risk a mismatched constant.";
          return;
        }
        document.getElementById("sigma-hex").value = enc.rawHex;
        out.textContent = "✓ Your " + enc.typeName + " constant: " + enc.rawHex + " — encoded locally exactly as tool 17 encodes a register, and round-tripped through the decoder above, which reads it back as " + back.value + ". Paste that hex into a box's registers with tool 17, one register per line in R4, R5, … order. Construction only: a constant on its own is just bytes — it takes effect only inside a box a signed transaction creates, and this tool signs and sends nothing.";
        return;
      }
      out.textContent = "Fill in one side — a constant's hex to decode it, or a typed value to encode it — and I will do the other.";
    });

    /* --- P2SH address builder --- */
    document.getElementById("p2shbuild-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("p2shbuild-result");
      var res = buildP2SHAddress(document.getElementById("p2shbuild-hex").value, document.getElementById("p2shbuild-network").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Your " + res.network + " P2SH address: " + res.address + " — built locally as prefix byte " + (res.network === "Mainnet" ? "0x02" : "0x12") + " + the script hash " + res.scriptHash + " (the first 24 bytes of Blake2b-256 over the proposition " + res.propositionHex + ") + the Blake2b-256 checksum, and round-tripped through tool 11's decoder, which reads back this exact hash. ";
      msg += res.isP2PK
        ? "This script is the standard P2PK proposition — a box meant to be spent by that key alone is normally guarded by its P2PK address (tool 8), not this hash form. "
        : "The script itself stays hidden behind that hash until a box guarded by this address is spent — the opposite trade from tool 16's P2S form, which reveals the full script in the address. ";
      msg += "Construction only: it proves the address is well-formed for this script, not who can spend a box it guards — that depends on the script itself. Nothing was fetched, signed or sent.";
      out.textContent = msg;
    });

    document.getElementById("treebuild-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("treebuild-result");
      var netLabel = document.getElementById("treebuild-network").value;
      var built = buildP2PKTree(document.getElementById("treebuild-pubkey").value, netLabel);
      if (!built.valid) {
        out.textContent = "✗ " + built.reason;
        return;
      }
      out.textContent = "✓ Your P2PK ErgoTree: " + built.treeHex + " — header 00 + the ProveDlog proposition (08 cd) + your public key, built locally and round-tripped through tool 10's parser and tool 11's decoder, which both read it back as this exact key. The tree is the same on every network; on " + built.network + " it gives the P2PK address " + built.address + " (tool 8) and the P2SH address " + built.p2shAddress + " (tool 10). Paste the tree hex into tools 15, 16 or 17 wherever an ErgoTree is asked for. Construction only: the tree is just a script — who can spend a box it guards depends on holding the key's private half, which this tool never asks for and you should never type into any website.";
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
