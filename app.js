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

/* ---------- Box health checker ---------- */
/* Tools 3, 5 and 7 answered together for one box: does it meet the
   protocol minimum for its size (360 nanoERG per byte, tool 5), how
   much storage rent would it owe per cycle (serialized bytes x
   1,250,000 nanoERG, tool 3), and is it old enough for that rent to
   be charged (creation height + 1,051,200 blocks, tool 7)? Both
   rates are votable chain parameters — still the live mainnet epoch
   params at api.ergoplatform.com/api/v1/info on 2026-10-07 (chain
   height 1,889,822) — so re-check them before citing them again.
   This composes those three analysers rather than re-deriving their
   maths, so the combined verdict can never disagree with them.
   Verdict precedence: a box below its protocol minimum is reported
   first (a transaction creating it at that size would be rejected);
   then a rent-eligible box holding at most one rent payment, which
   a miner may spend whole right now; then the same underfunding
   before eligibility; otherwise the box is funded, and the number
   of full rent payments it covers is tool 3's figure. All figures
   user-supplied — the size and both heights come off the box's
   explorer page; this tool fetches nothing and claims no live
   chain data. Exact BigInt maths throughout. */
function analyzeBoxHealth(sizeStr, ergStr, creationStr, currentStr) {
  var minRes = analyzeMinBoxValue(sizeStr, ergStr);
  var rentRes = analyzeStorageRent(sizeStr, ergStr);
  var clockRes = analyzeRentCountdown(creationStr, currentStr);
  if (minRes === null || rentRes === null || clockRes === null) return null;
  var valueNano = ergToNano(ergStr); /* non-null: the analysers validated it */
  var value = BigInt(valueNano);
  var rent = BigInt(rentRes.rentNano);
  var verdict;
  if (!minRes.meetsMinimum) verdict = "below-minimum";
  else if (clockRes.eligible && rentRes.consumableAtFirstRent) verdict = "consumable-now";
  else if (rentRes.consumableAtFirstRent) verdict = "consumable-at-eligibility";
  else verdict = "funded";
  var afterRent = clockRes.eligible && value > rent ? value - rent : null;
  return {
    valueNano: valueNano,
    valueErg: nanoToErg(valueNano),
    minNano: minRes.minNano,
    minErg: minRes.minErg,
    meetsMinimum: minRes.meetsMinimum,
    differenceNano: minRes.differenceNano,
    differenceErg: minRes.differenceErg,
    meetsSafeUserMin: minRes.meetsSafeUserMin,
    rentNano: rentRes.rentNano,
    rentErg: rentRes.rentErg,
    payments: rentRes.payments,
    approxYears: rentRes.approxYears,
    consumableAtFirstRent: rentRes.consumableAtFirstRent,
    ageBlocks: clockRes.ageBlocks,
    eligibilityHeight: clockRes.eligibilityHeight,
    eligible: clockRes.eligible,
    blocksRemaining: clockRes.blocksRemaining,
    approxDaysRemaining: clockRes.approxDaysRemaining,
    valueAfterRentNano: afterRent === null ? null : afterRent.toString(),
    valueAfterRentErg: afterRent === null ? null : nanoToErg(afterRent.toString()),
    verdict: verdict
  };
}

/* ---------- Emission & supply calculator ---------- */
/* Ergo's issuance is fixed by protocol rules, not voted per block:
   the monetary settings in ergoplatform/ergo's application.conf
   (fixedRatePeriod 525,600 blocks, fixedRate 75 ERG, founders'
   initial reward 7.5 ERG, epochLength 64,800 blocks, oneEpochReduction
   3 ERG) plugged into EmissionRules in sigmastate-interpreter:
   blocks below 525,600 issue a flat 75 ERG; from 525,600 the rate
   drops 3 ERG every 64,800-block epoch (72, 69, 66, ...) until it
   reaches 0 at block 2,080,800, by which point exactly 97,739,925 ERG
   — the maximum supply — has been issued. The foundation's share is
   7.5 ERG during the fixed era, then 4.5 and 1.5 ERG over the next
   two epochs, then nothing; the miner receives the rest. On top of
   that sits EIP-27 (papers/emission.md in ergoplatform/ergo,
   activated at block 777,217): until emission ends, 12 ERG of each
   block reward of 15 ERG or more — or all but 3 ERG of a smaller
   one — is diverted to a re-emission contract instead of the miner,
   and from block 2,080,800 that contract pays the miner 3 ERG per
   block: recycled coins, not new issuance (the EIP sized it to last
   about 4,566,336 blocks, roughly 17.4 years). Every figure here is
   a literal BigInt port of those rules, cross-checked before coding
   against a brute-force sum over every block: total issued
   97,739,925 ERG, first-year issued 19,710,000 ERG, last emitting
   block 2,080,799. The schedule is protocol-fixed, so this claims
   no live chain data — the height is user-supplied. */
var EMISSION_FIXED_RATE_PERIOD = 525600n;
var EMISSION_FIXED_RATE_NANO = 75000000000n;
var EMISSION_FOUNDERS_INITIAL_NANO = 7500000000n;
var EMISSION_EPOCH_LENGTH = 64800n;
var EMISSION_ONE_EPOCH_REDUCTION_NANO = 3000000000n;
var EMISSION_TOTAL_NANO = 97739925000000000n;
var EIP27_ACTIVATION_HEIGHT = 777217n;
var EIP27_REEMISSION_START_HEIGHT = 2080800n;
var EIP27_DIVERTED_NANO = 12000000000n;
var EIP27_REEMISSION_REWARD_NANO = 3000000000n;
var EMISSION_MAX_HEIGHT = 100000000n;
function emissionAtHeight(h) {
  if (h < EMISSION_FIXED_RATE_PERIOD) return EMISSION_FIXED_RATE_NANO;
  var epoch = 1n + (h - EMISSION_FIXED_RATE_PERIOD) / EMISSION_EPOCH_LENGTH;
  var rate = EMISSION_FIXED_RATE_NANO - EMISSION_ONE_EPOCH_REDUCTION_NANO * epoch;
  return rate > 0n ? rate : 0n;
}
function foundationRewardAtHeight(h) {
  if (h < EMISSION_FIXED_RATE_PERIOD) return EMISSION_FOUNDERS_INITIAL_NANO;
  if (h < EMISSION_FIXED_RATE_PERIOD + EMISSION_EPOCH_LENGTH) return EMISSION_FOUNDERS_INITIAL_NANO - EMISSION_ONE_EPOCH_REDUCTION_NANO;
  if (h < EMISSION_FIXED_RATE_PERIOD + 2n * EMISSION_EPOCH_LENGTH) return EMISSION_FOUNDERS_INITIAL_NANO - 2n * EMISSION_ONE_EPOCH_REDUCTION_NANO;
  return 0n;
}
function minersRewardAtHeight(h) {
  if (h < EMISSION_FIXED_RATE_PERIOD + 2n * EMISSION_EPOCH_LENGTH) return EMISSION_FIXED_RATE_NANO - EMISSION_FOUNDERS_INITIAL_NANO;
  return emissionAtHeight(h);
}
function issuedAfterHeight(h) {
  if (h < EMISSION_FIXED_RATE_PERIOD) return EMISSION_FIXED_RATE_NANO * h;
  var fixedIssue = EMISSION_FIXED_RATE_NANO * (EMISSION_FIXED_RATE_PERIOD - 1n);
  var epoch = (h - EMISSION_FIXED_RATE_PERIOD) / EMISSION_EPOCH_LENGTH;
  var fullEpochs = epoch < 24n ? epoch : 24n;
  var epochSum = fullEpochs * EMISSION_FIXED_RATE_NANO - EMISSION_ONE_EPOCH_REDUCTION_NANO * fullEpochs * (fullEpochs + 1n) / 2n;
  var heightInEpoch = (h - EMISSION_FIXED_RATE_PERIOD) % EMISSION_EPOCH_LENGTH + 1n;
  var rateThisEpoch = EMISSION_FIXED_RATE_NANO - EMISSION_ONE_EPOCH_REDUCTION_NANO * (epoch + 1n);
  if (rateThisEpoch < 0n) rateThisEpoch = 0n;
  return fixedIssue + epochSum * EMISSION_EPOCH_LENGTH + heightInEpoch * rateThisEpoch;
}
function analyzeEmission(heightStr) {
  var hs = parseChainHeight(heightStr);
  if (hs === null) return null;
  var h = BigInt(hs);
  if (h < 1n || h > EMISSION_MAX_HEIGHT) return null;
  var emission = emissionAtHeight(h);
  var foundation = foundationRewardAtHeight(h);
  var eip27 = h >= EIP27_ACTIVATION_HEIGHT && h < EIP27_REEMISSION_START_HEIGHT;
  var diverted = 0n;
  if (eip27) {
    diverted = emission >= 15000000000n ? EIP27_DIVERTED_NANO : emission - EIP27_REEMISSION_REWARD_NANO;
    if (diverted < 0n) diverted = 0n;
  }
  var reemission = h >= EIP27_REEMISSION_START_HEIGHT ? EIP27_REEMISSION_REWARD_NANO : 0n;
  var miner = h >= EIP27_REEMISSION_START_HEIGHT ? reemission : minersRewardAtHeight(h) - diverted;
  var issued = issuedAfterHeight(h);
  var remaining = EMISSION_TOTAL_NANO - issued;
  var epoch = h >= EMISSION_FIXED_RATE_PERIOD ? (1n + (h - EMISSION_FIXED_RATE_PERIOD) / EMISSION_EPOCH_LENGTH).toString() : null;
  return {
    height: h.toString(),
    phase: h >= EIP27_REEMISSION_START_HEIGHT ? "reemission" : (h < EMISSION_FIXED_RATE_PERIOD ? "fixed" : "declining"),
    epoch: epoch,
    eip27: eip27,
    emissionNano: emission.toString(),
    emissionErg: nanoToErg(emission.toString()),
    minerNano: miner.toString(),
    minerErg: nanoToErg(miner.toString()),
    foundationNano: foundation.toString(),
    foundationErg: nanoToErg(foundation.toString()),
    divertedNano: diverted.toString(),
    divertedErg: nanoToErg(diverted.toString()),
    reemissionNano: reemission.toString(),
    reemissionErg: nanoToErg(reemission.toString()),
    issuedNano: issued.toString(),
    issuedErg: nanoToErg(issued.toString()),
    remainingNano: remaining.toString(),
    remainingErg: nanoToErg(remaining.toString()),
    totalErg: nanoToErg(EMISSION_TOTAL_NANO.toString()),
    percentIssued: Number(issued * 1000000n / EMISSION_TOTAL_NANO) / 10000
  };
}

/* ---------- EIP-4 token metadata codec ---------- */
/* EIP-4 (ergoplatform/eips, the asset standard) fixes how a token's
   issuance box describes the token: R4 holds the name, R5 the
   description and R6 the number of decimals, each encoded as a
   Coll[Byte] Sigma constant holding the UTF-8 TEXT of the value —
   the type byte 0x0e, a VLQ byte-length, then the bytes. Decimals
   included: the EIP's own worked example (the "USD" token issued in
   block 98288) encodes 2 decimals as the one-character string "2",
   hex 0e0132 — not as an Int constant. Some tokens in the wild do
   carry R6 as an Int constant (type byte 0x04, zigzag VLQ); the
   decoder accepts that form too and says which form it found. R7
   optionally carries a 1-2 byte asset type, also as Coll[Byte]:
   category 0x01 is NFT (subcategories 0x01 picture, 0x02 audio,
   0x03 video, 0x04 collection, 0x0f file attachments) and 0x02 is
   membership tokens (0x01 threshold signature). Encodings verified
   against the EIP's own published examples (R4 0e03555344 for
   "USD", R5 and R6 likewise, R7 0e020101 / 0e02010f / 0e020201)
   with an independent Python build before coding. Everything is
   computed locally from what you type; a token also needs its ID —
   the box ID of the issuing transaction's first input — which is a
   chain fact this tool does not invent. Registers only: it builds
   no transaction, signs nothing and mints nothing. */
var EIP4_ASSET_TYPES = {
  picture: { bytes: [1, 1], label: "NFT — picture artwork" },
  audio: { bytes: [1, 2], label: "NFT — audio artwork" },
  video: { bytes: [1, 3], label: "NFT — video artwork" },
  collection: { bytes: [1, 4], label: "NFT — artwork collection" },
  attachments: { bytes: [1, 15], label: "NFT — file attachments" },
  membership: { bytes: [2, 1], label: "Membership token — threshold signature" },
  nft: { bytes: [1], label: "NFT (category only, no subcategory)" }
};
var EIP4_ASSET_LABELS = {
  "1,1": "NFT — picture artwork",
  "1,2": "NFT — audio artwork",
  "1,3": "NFT — video artwork",
  "1,4": "NFT — artwork collection",
  "1,15": "NFT — file attachments",
  "2,1": "Membership token — threshold signature",
  "1": "NFT (category only, no subcategory)"
};
function eip4CollHex(payloadBytes) {
  return bytesToHex([0x0e].concat(writeVlqBig(BigInt(payloadBytes.length)), Array.from(payloadBytes)));
}
function eip4CollStringHex(str) {
  return eip4CollHex(utf8Bytes(str));
}
function eip4ParseColl(bytes) {
  if (!bytes || bytes.length < 2 || bytes[0] !== 0x0e) return null;
  var len = readVlqBig(bytes, 1);
  if (!len) return null;
  var start = 1 + len.length;
  if (start + Number(len.value) !== bytes.length) return null;
  return Array.from(bytes.slice(start));
}
function utf8Text(bytes) {
  if (typeof TextDecoder !== "undefined") {
    try { return new TextDecoder("utf-8").decode(new Uint8Array(bytes)); } catch (e) { /* fall through */ }
  }
  var s = "";
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
}
function utf8RoundTrips(text, payloadBytes) {
  var re = Array.from(utf8Bytes(text));
  if (re.length !== payloadBytes.length) return false;
  for (var i = 0; i < re.length; i++) if (re[i] !== payloadBytes[i]) return false;
  return true;
}
function buildEip4Registers(nameStr, descStr, decStr, typeStr) {
  var name = nameStr == null ? "" : String(nameStr);
  if (name === "") return null;
  var desc = descStr == null ? "" : String(descStr);
  var dec = (decStr == null ? "" : String(decStr)).trim();
  if (!/^\d+$/.test(dec)) return null;
  if (dec.length > 1 && dec.charAt(0) === "0") return null;
  if (dec.length > 3) return null;
  var type = (typeStr == null ? "" : String(typeStr)).trim().toLowerCase();
  var asset = null;
  if (type !== "") {
    asset = EIP4_ASSET_TYPES[type] || null;
    if (!asset) return null;
  }
  return {
    name: name,
    description: desc,
    decimals: dec,
    r4Hex: eip4CollStringHex(name),
    r5Hex: desc === "" ? null : eip4CollStringHex(desc),
    r6Hex: eip4CollStringHex(dec),
    r7Hex: asset ? eip4CollHex(asset.bytes) : null,
    assetType: asset ? asset.label : null
  };
}
function decodeEip4Registers(r4Str, r5Str, r6Str, r7Str) {
  var inputs = [r4Str, r5Str, r6Str, r7Str].map(function (x) {
    return (x == null ? "" : String(x)).replace(/\s+/g, "");
  });
  if (inputs.every(function (x) { return x === ""; })) return null;
  var out = {
    name: null, nameValidUtf8: null,
    description: null, descriptionValidUtf8: null,
    decimals: null, decimalsForm: null,
    assetCategory: null, assetSubcategory: null, assetType: null,
    rawHex: { r4: null, r5: null, r6: null, r7: null }
  };
  var textReg = function (idx, isDesc) {
    var bytes = hexToBytes(inputs[idx]);
    if (!bytes) return false;
    var payload = eip4ParseColl(bytes);
    if (!payload) return false;
    var text = utf8Text(payload);
    var ok = utf8RoundTrips(text, payload);
    if (isDesc) { out.description = text; out.descriptionValidUtf8 = ok; out.rawHex.r5 = bytesToHex(bytes); }
    else { out.name = text; out.nameValidUtf8 = ok; out.rawHex.r4 = bytesToHex(bytes); }
    return true;
  };
  if (inputs[0] !== "" && !textReg(0, false)) return null;
  if (inputs[1] !== "" && !textReg(1, true)) return null;
  if (inputs[2] !== "") {
    var b6 = hexToBytes(inputs[2]);
    if (!b6 || b6.length === 0) return null;
    if (b6[0] === 0x0e) {
      var p6 = eip4ParseColl(b6);
      if (!p6) return null;
      var t6 = utf8Text(p6);
      if (!/^\d+$/.test(t6) || !utf8RoundTrips(t6, p6)) return null;
      out.decimals = t6.replace(/^0+(?=\d)/, "");
      out.decimalsForm = "string";
    } else if (b6[0] === 0x04) {
      var v6 = readVlqBig(b6, 1);
      if (!v6 || 1 + v6.length !== b6.length) return null;
      var d6 = zigzagDecode32(v6.value);
      if (d6 < 0n) return null;
      out.decimals = d6.toString();
      out.decimalsForm = "int";
    } else {
      return null;
    }
    out.rawHex.r6 = bytesToHex(b6);
  }
  if (inputs[3] !== "") {
    var b7 = hexToBytes(inputs[3]);
    if (!b7) return null;
    var p7 = eip4ParseColl(b7);
    if (!p7 || p7.length < 1 || p7.length > 2) return null;
    out.assetCategory = p7[0];
    out.assetSubcategory = p7.length > 1 ? p7[1] : null;
    var key = p7.join(",");
    out.assetType = EIP4_ASSET_LABELS[key] ||
      (p7[0] === 1 ? "NFT category, unlisted subcategory" :
       p7[0] === 2 ? "Membership category, unlisted subcategory" :
       "Unrecognised asset category");
    out.rawHex.r7 = bytesToHex(b7);
  }
  return out;
}

/* ---------- EIP-44 arbitrary data hash (ADH) codec ---------- */
/* EIP-0044 (Arbitrary Data Signing Standard, status: Proposed)
   extends the address codeset with type 4, ADH — arbitrary data
   hash. Its encoding pseudocode is the ordinary address
   construction pointed at data instead of a key or script:
   head byte = network byte (0x00 mainnet / 0x10 testnet) + 4;
   body = head + blake2b256(data); checksum = first 4 bytes of
   blake2b256(body); representation = base58(body + checksum).
   Hashing the data first keeps the representation short and
   hardware-wallet friendly. For signing, the EIP has the prover
   sign 0x00 || network byte || blake2b256(data) — the leading
   0x00 is a transaction invalidator (a serialized transaction
   starts with its input count, never 0), so a data signature can
   never be tricked into being a transaction signature, and the
   network byte stops testnet signatures replaying on mainnet.
   Verified against an independent Python (hashlib) build before
   coding. This is a PROPOSED standard, not an adopted one: an
   ADH string is a data representation for message signing, NOT
   a payment address — Ergo's spendable address types are 1-3. */
var ADH_TYPE_CODE = 4;
function adhDataBytes(dataStr, modeStr) {
  var mode = (modeStr == null ? "" : String(modeStr)).trim().toLowerCase();
  if (mode === "text") {
    var text = dataStr == null ? "" : String(dataStr);
    if (text === "") return null;
    return utf8Bytes(text);
  }
  if (mode === "hex") {
    var cleaned = (dataStr == null ? "" : String(dataStr)).replace(/\s+/g, "");
    if (cleaned.toLowerCase().indexOf("0x") === 0) cleaned = cleaned.slice(2);
    if (cleaned === "") return null;
    return hexToBytes(cleaned);
  }
  return null;
}
function buildAdhRepresentation(dataStr, modeStr, networkStr) {
  var net = (networkStr == null ? "" : String(networkStr)).trim().toLowerCase();
  if (net !== "mainnet" && net !== "testnet") return null;
  var bytes = adhDataBytes(dataStr, modeStr);
  if (!bytes || bytes.length === 0) return null;
  var netByte = net === "mainnet" ? 0x00 : 0x10;
  var prefix = netByte | ADH_TYPE_CODE;
  var hash = blake2b256(bytes);
  var body = new Uint8Array(1 + hash.length);
  body[0] = prefix;
  body.set(hash, 1);
  var checksum = blake2b256(body).subarray(0, 4);
  var full = new Uint8Array(body.length + 4);
  full.set(body, 0);
  full.set(checksum, body.length);
  var representation = base58Encode(full);
  var out = {
    representation: representation,
    dataHash: bytesToHex(hash),
    network: net === "mainnet" ? "Mainnet" : "Testnet",
    prefix: prefix,
    byteLength: bytes.length,
    signedBytesHex: "00" + bytesToHex([netByte]) + bytesToHex(hash)
  };
  var back = decodeAdhRepresentation(representation);
  if (!back || back.dataHash !== out.dataHash || back.network !== out.network) return null;
  return out;
}
function decodeAdhRepresentation(raw) {
  var str = typeof raw === "string" ? raw.trim() : "";
  if (!str || /\s/.test(str)) return null;
  var decoded = base58Decode(str);
  if (!decoded || decoded.length !== 37) return null;
  var prefix = decoded[0];
  var networkCode = prefix >> 4;
  var typeCode = prefix & 0x0f;
  if (typeCode !== ADH_TYPE_CODE) return null;
  if (networkCode !== 0 && networkCode !== 1) return null;
  var body = decoded.subarray(0, decoded.length - 4);
  var stored = decoded.subarray(decoded.length - 4);
  var digest = blake2b256(body);
  for (var i = 0; i < 4; i++) if (digest[i] !== stored[i]) return null;
  var netByte = networkCode === 0 ? 0x00 : 0x10;
  var hashHex = bytesToHex(decoded.subarray(1, 33));
  return {
    network: networkCode === 0 ? "Mainnet" : "Testnet",
    typeCode: typeCode,
    prefix: prefix,
    dataHash: hashHex,
    signedBytesHex: "00" + bytesToHex([netByte]) + hashHex
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

/* ---------- Base58 codec ---------- */
/* Every Ergo address on this page is Base58 text over raw bytes
   (tools 2, 8, 11, 13, 16, 20 all encode or decode it internally).
   This tool exposes that codec on its own: hex bytes -> Base58, or
   Base58 -> hex bytes, using the Bitcoin alphabet Ergo uses (no 0,
   O, I or l — those four are rejected on decode). Each leading zero
   byte is one leading "1"; empty input in either direction is the
   empty result, not an error. Base58 here is plain Base58, NOT
   Base58Check: no checksum is added on encode or verified on decode
   — an address pasted in decodes to prefix + content + its stored
   checksum bytes verbatim, and tool 2 is the one that verifies that
   checksum. Verified against an independent Python build before
   coding, including the classic 00eb1523…06647 vector and Kyle's
   own address bytes round-tripping exactly. */
function analyzeBase58(inputStr, directionStr) {
  var direction = (directionStr == null ? "" : String(directionStr)).trim().toLowerCase();
  if (direction !== "encode" && direction !== "decode") return null;
  var input = inputStr == null ? "" : String(inputStr);
  if (direction === "encode") {
    var cleaned = input.replace(/\s+/g, "");
    if (cleaned === "" || cleaned.toLowerCase() === "0x") {
      return { direction: direction, byteLength: 0, encoded: "", hex: "" };
    }
    var bytes = hexToBytes(cleaned);
    if (!bytes) return null;
    return { direction: direction, byteLength: bytes.length, encoded: base58Encode(bytes), hex: bytesToHex(bytes) };
  }
  var trimmed = input.trim();
  if (/\s/.test(trimmed)) return null;
  if (trimmed === "") return { direction: direction, byteLength: 0, encoded: "", hex: "" };
  var decoded = base58Decode(trimmed);
  if (!decoded) return null;
  return { direction: direction, byteLength: decoded.length, encoded: trimmed, hex: bytesToHex(decoded) };
}

/* ---------- VLQ codec ---------- */
/* Almost every integer inside a serialized box is a VLQ (variable-
   length quantity): the box value, creation height, token amounts,
   counts and output index in tools 15/17, and the proposition size
   in a size-flagged ErgoTree (tool 10). The encoding is unsigned
   LEB128 exactly as fleet-sdk's writeBigVLQ/readBigVLQ define it:
   7 bits per byte, least-significant group first, high bit set on
   every byte except the last; negatives are not encodable. This
   tool exposes that codec on its own, in both directions, with
   exact BigInt maths at any size. Decode is strict in the way a
   box parser must be: the bytes must be exactly one VLQ (a
   truncated encoding and trailing bytes are rejected), and the
   encoding must be canonical — re-encoding the decoded value must
   reproduce the input byte-for-byte, so an overlong form like
   8000 (zero written in two bytes) is rejected rather than read
   as a second spelling of the same number. Verified against
   fleet-sdk's published vlq.spec vectors and an independent
   Python build before coding. */
function analyzeVlq(inputStr, directionStr) {
  var direction = (directionStr == null ? "" : String(directionStr)).trim().toLowerCase();
  if (direction !== "encode" && direction !== "decode") return null;
  var input = inputStr == null ? "" : String(inputStr).trim();
  if (direction === "encode") {
    if (!/^[0-9]+$/.test(input)) return null;
    var value = BigInt(input);
    var encBytes = writeVlqBig(value);
    return { direction: direction, value: value.toString(), hex: bytesToHex(Uint8Array.from(encBytes)), byteLength: encBytes.length };
  }
  var bytes = hexToBytes(input.replace(/\s+/g, ""));
  if (!bytes || bytes.length === 0) return null;
  var read = readVlqBig(bytes, 0);
  if (!read || read.length !== bytes.length) return null;
  var reenc = writeVlqBig(read.value);
  if (reenc.length !== bytes.length) return null;
  for (var i = 0; i < reenc.length; i++) if (reenc[i] !== bytes[i]) return null;
  return { direction: direction, value: read.value.toString(), hex: bytesToHex(bytes), byteLength: bytes.length };
}

/* ---------- ZigZag codec ---------- */
/* Signed integers cannot go into a VLQ (tool 23) directly, so
   Ergo zig-zags them first: 0 -> 0, -1 -> 1, 1 -> 2, -2 -> 3 —
   negatives fold into the odd numbers so small magnitudes of
   either sign stay small — and the result is written as a VLQ.
   That two-step form is how every signed value inside a box or
   register is stored (tools 15, 17 and 18 use it internally):
   an SLong through the 64-bit zig-zag (fleet-sdk's zigZag64),
   an SShort/SInt through its 32-bit one (zigZag32), which
   zig-zags in signed 32-bit space and writes a negative result
   widened to its unsigned 64-bit form — so 2147483647 is
   feffffff0f at 64-bit width but feffffffffffffffff01 at 32-bit
   width, the exact spelling the box parser reads back at the
   32-bit extremes. This tool exposes the codec on its own, in
   both directions and both widths, with exact BigInt maths.
   Decode is strict like tool 23's (exactly one canonical VLQ),
   plus one more check a box parser needs: re-encoding the
   decoded value at the chosen width must reproduce the input
   bytes, so an over-wide VLQ whose bits the width would
   truncate or wrap is refused instead of read as a different
   number. Verified against fleet-sdk's published zigZag spec
   vectors and an independent Python build before coding. */
function analyzeZigZag(inputStr, directionStr, widthStr) {
  var direction = (directionStr == null ? "" : String(directionStr)).trim().toLowerCase();
  if (direction !== "encode" && direction !== "decode") return null;
  var width = (widthStr == null ? "" : String(widthStr)).trim();
  if (width !== "64" && width !== "32") return null;
  var input = inputStr == null ? "" : String(inputStr).trim();
  var min = width === "64" ? -9223372036854775808n : -2147483648n;
  var max = width === "64" ? 9223372036854775807n : 2147483647n;
  if (direction === "encode") {
    if (!/^-?[0-9]+$/.test(input)) return null;
    var value = BigInt(input);
    if (value < min || value > max) return null;
    var unsigned = width === "64" ? zigzagEncode(value) : sigmaIntZigzag(Number(value));
    var encBytes = writeVlqBig(unsigned);
    return { direction: direction, width: width, value: value.toString(), unsigned: unsigned.toString(), hex: bytesToHex(Uint8Array.from(encBytes)), byteLength: encBytes.length };
  }
  var bytes = hexToBytes(input.replace(/\s+/g, ""));
  if (!bytes || bytes.length === 0) return null;
  var read = readVlqBig(bytes, 0);
  if (!read || read.length !== bytes.length) return null;
  var reenc = writeVlqBig(read.value);
  if (reenc.length !== bytes.length) return null;
  for (var i = 0; i < reenc.length; i++) if (reenc[i] !== bytes[i]) return null;
  var signed = width === "64" ? zigzagDecode(read.value) : zigzagDecode32(read.value);
  var unsigned2 = width === "64" ? zigzagEncode(signed) : sigmaIntZigzag(Number(signed));
  if (unsigned2 !== read.value) return null;
  return { direction: direction, width: width, value: signed.toString(), unsigned: read.value.toString(), hex: bytesToHex(bytes), byteLength: bytes.length };
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

/* ---------- Serialized transaction parser ---------- */
/* A whole transaction, taken apart in the layout fleet-sdk's
   transaction serializer writes (and its deserializer reads):
   the input count, then each input — the 32-byte ID of the box
   being spent, the spending proof (a VLQ length and that many
   bytes; length 0 in an unsigned transaction), and the context
   extension (a count, then VLQ key + Sigma constant pairs) —
   then the data inputs (box IDs only, read but never spent),
   then the distinct token IDs the outputs use, then the outputs
   themselves as EMBEDDED boxes: same fields as a standalone box
   (tool 15) except a token is named by its VLQ index into that
   distinct-ID list instead of repeating the 32-byte ID, and the
   creating transaction ID and output index are not stored in
   the bytes at all — they ARE this transaction's ID and the
   output's position, which is also how each output's box ID is
   recomputed here (the standalone serialization fleet rebuilds:
   value, tree, height, full token IDs and amounts, registers,
   this transaction's ID, the index — Blake2b-256, tool 14).
   The transaction ID itself is the Blake2b-256 of the UNSIGNED
   serialization: the inputs rewritten with empty proofs (their
   extensions kept — fleet's computeId does exactly this) plus
   every remaining byte verbatim, so a signed and an unsigned
   copy of one transaction share an ID. Two honest limits, both
   fleet-sdk's own: its deserializer reads only the trees its box
   reader can delimit (the fee contract, a standard P2PK tree, or
   a size-flagged tree) — fleet keeps a separate, shorter list of
   "deserializable" vectors for exactly this reason — and a
   register or extension constant outside tool 15's type set
   stops the parse. Both are reported plainly rather than
   guessed past. Input boxes are named by ID only: their values
   are not in these bytes, so no fee (inputs minus outputs) can
   be computed here, and none is claimed. Verified against
   fleet-sdk's published transaction vectors — the two its own
   deserializer round-trips — plus an independent Python build,
   before coding. */
function parseErgoTransaction(txHex) {
  var fail = function (reason) {
    return { valid: false, reason: reason, txId: null, byteLength: null, signed: null, inputs: null, dataInputs: null, tokenIds: null, outputs: null, totalOutputNano: null, totalOutputErg: null, tokenTotals: null };
  };
  var cleaned = txHex == null ? "" : String(txHex).replace(/\s+/g, "");
  var bytes = hexToBytes(cleaned);
  if (!bytes) return fail("Enter the transaction's full serialized bytes as hex (an even number of 0-9/a-f characters, with or without a 0x prefix) — SDKs and node APIs produce them, and explorers link them from a transaction's page.");
  var pos = 0;
  var step = function (what) { return fail("Truncated transaction: the bytes end in the middle of the " + what + ". A full serialized transaction carries its inputs, data inputs, distinct token IDs and outputs — check the hex is complete."); };
  var readCount = function (what) {
    var v = readVlqBig(bytes, pos);
    if (!v) return null;
    pos += v.length;
    if (v.value > 10000n) return { implausible: v.value.toString(), what: what };
    return { count: Number(v.value) };
  };
  /* --- inputs (collecting the unsigned rewrite for the ID) --- */
  var inCount = readCount("input count");
  if (!inCount) return step("input count");
  if (inCount.implausible) return fail("Implausible input count (" + inCount.implausible + ") — these bytes do not parse as a serialized transaction from the input count onward; check the hex is a transaction serialization, not a single box (tool 15 takes those).");
  var unsignedBytes = [];
  var pushAll = function (arr) { for (var i = 0; i < arr.length; i++) unsignedBytes.push(arr[i]); };
  pushAll(writeVlqBig(BigInt(inCount.count)));
  var inputs = [];
  for (var ii = 0; ii < inCount.count; ii++) {
    var inWhat = "input " + (ii + 1);
    if (pos + 32 > bytes.length) return step(inWhat + "'s box ID");
    var inBoxId = bytesToHex(bytes.subarray(pos, pos + 32));
    var inBoxIdBytes = bytes.subarray(pos, pos + 32);
    pos += 32;
    var proofLenVlq = readVlqBig(bytes, pos);
    if (!proofLenVlq) return step(inWhat + "'s proof length");
    pos += proofLenVlq.length;
    var proofLen = Number(proofLenVlq.value);
    if (pos + proofLen > bytes.length) return step(inWhat + "'s spending proof");
    var proofHex = proofLen > 0 ? bytesToHex(bytes.subarray(pos, pos + proofLen)) : null;
    pos += proofLen;
    var extStart = pos;
    var extCount = readCount(inWhat + "'s context extension count");
    if (!extCount) return step(inWhat + "'s context extension count");
    if (extCount.implausible) return fail("Implausible context extension count (" + extCount.implausible + ") on " + inWhat + " — these bytes do not parse as a serialized transaction from there onward.");
    var extension = [];
    for (var e = 0; e < extCount.count; e++) {
      var keyVlq = readVlqBig(bytes, pos);
      if (!keyVlq) return step(inWhat + "'s context extension key");
      pos += keyVlq.length;
      var constStart = pos;
      var eType = parseSigmaType(bytes, pos);
      if (!eType) return fail("Input " + (ii + 1) + "'s context extension value " + (e + 1) + " holds a Sigma constant whose type is outside the set this parser decodes (the primitive, collection and tuple types — for example an Option, Box or AvlTree constant). Because a constant's length comes from its type, the fields after it cannot be located safely, so the transaction is not decoded rather than guessed at.");
      pos += eType.length;
      var eData = parseSigmaData(eType.node, bytes, pos);
      if (!eData) return fail("Input " + (ii + 1) + "'s context extension value " + (e + 1) + " (" + sigmaTypeName(eType.node) + ") is truncated or holds a constant form this parser does not decode, so the fields after it cannot be located safely — the transaction is not decoded rather than guessed at.");
      pos += eData.length;
      extension.push({ key: Number(keyVlq.value), type: sigmaTypeName(eType.node), value: eData.value, rawHex: bytesToHex(bytes.subarray(constStart, pos)) });
    }
    pushAll(inBoxIdBytes);
    unsignedBytes.push(0);
    pushAll(bytes.subarray(extStart, pos));
    inputs.push({ boxId: inBoxId, proofBytes: proofHex, proofLength: proofLen, extension: extension });
  }
  /* The ID: unsigned inputs + every remaining byte verbatim */
  var txIdBytes = unsignedBytes.slice();
  for (var r = pos; r < bytes.length; r++) txIdBytes.push(bytes[r]);
  var txId = bytesToHex(blake2b256(Uint8Array.from(txIdBytes)));
  /* --- data inputs --- */
  var diCount = readCount("data input count");
  if (!diCount) return step("data input count");
  if (diCount.implausible) return fail("Implausible data input count (" + diCount.implausible + ") — these bytes do not parse as a serialized transaction from the data inputs onward.");
  var dataInputs = [];
  for (var d = 0; d < diCount.count; d++) {
    if (pos + 32 > bytes.length) return step("data input " + (d + 1) + "'s box ID");
    dataInputs.push(bytesToHex(bytes.subarray(pos, pos + 32)));
    pos += 32;
  }
  /* --- distinct token IDs --- */
  var tkCount = readCount("distinct token ID count");
  if (!tkCount) return step("distinct token ID count");
  if (tkCount.implausible) return fail("Implausible distinct token ID count (" + tkCount.implausible + ") — these bytes do not parse as a serialized transaction from the token ID list onward.");
  var tokenIds = [];
  for (var t = 0; t < tkCount.count; t++) {
    if (pos + 32 > bytes.length) return step("distinct token ID " + (t + 1));
    tokenIds.push(bytesToHex(bytes.subarray(pos, pos + 32)));
    pos += 32;
  }
  /* --- outputs (embedded boxes) --- */
  var outCount = readCount("output count");
  if (!outCount) return step("output count");
  if (outCount.implausible) return fail("Implausible output count (" + outCount.implausible + ") — these bytes do not parse as a serialized transaction from the output count onward.");
  var feeBytes = hexToBytes(FEE_CONTRACT_HEX);
  var outputs = [];
  var totalNano = 0n;
  var tokenTotals = [];
  for (var o = 0; o < outCount.count; o++) {
    var outWhat = "output " + (o + 1);
    var outStart = pos;
    var valVlq = readVlqBig(bytes, pos);
    if (!valVlq) return step(outWhat + "'s value");
    var outValue = valVlq.value;
    pos += valVlq.length;
    /* ErgoTree, delimited exactly as fleet-sdk's box reader delimits it */
    var isFee = bytes.length - pos >= feeBytes.length;
    if (isFee) { for (var f = 0; f < feeBytes.length; f++) { if (bytes[pos + f] !== feeBytes[f]) { isFee = false; break; } } }
    var treeEnd;
    if (isFee) {
      treeEnd = pos + feeBytes.length;
    } else if (bytes.length - pos >= 36 && bytes[pos] === 0 && bytes[pos + 1] === 0x08 && bytes[pos + 2] === 0xcd && (bytes[pos + 3] === 0x02 || bytes[pos + 3] === 0x03)) {
      treeEnd = pos + 36;
    } else {
      if (pos >= bytes.length) return step(outWhat + "'s ErgoTree");
      var headerByte = bytes[pos];
      if ((headerByte & ERGOTREE_SIZE_FLAG) === 0) return fail("Output " + (o + 1) + "'s ErgoTree (header byte 0x" + headerByte.toString(16).padStart(2, "0") + ") carries no size field and is not the standard P2PK tree or the miner fee contract — like fleet-sdk's transaction deserializer, which reads only the trees its box reader can delimit (fleet keeps a separate, shorter list of deserializable transaction vectors for exactly this reason), this parser cannot tell where such a tree ends without parsing the full script, so the transaction is not decoded rather than guessed at.");
      var sizeVlq = readVlqBig(bytes, pos + 1);
      if (!sizeVlq) return step(outWhat + "'s ErgoTree size");
      treeEnd = pos + 1 + sizeVlq.length + Number(sizeVlq.value);
      if (treeEnd > bytes.length) return step(outWhat + "'s ErgoTree");
    }
    var outTree = bytesToHex(bytes.subarray(pos, treeEnd));
    pos = treeEnd;
    var heightVlq = readVlqBig(bytes, pos);
    if (!heightVlq) return step(outWhat + "'s creation height");
    var outHeight = heightVlq.value;
    pos += heightVlq.length;
    var headEnd = pos;
    var otCount = readCount(outWhat + "'s token count");
    if (!otCount) return step(outWhat + "'s token count");
    if (otCount.implausible) return fail("Implausible token count (" + otCount.implausible + ") in output " + (o + 1) + " — these bytes do not parse as a serialized transaction from there onward.");
    var outTokens = [];
    var outTokenFull = [];
    for (var ot = 0; ot < otCount.count; ot++) {
      var idxVlq = readVlqBig(bytes, pos);
      if (!idxVlq) return step(outWhat + "'s token index");
      pos += idxVlq.length;
      var tokenIndex = Number(idxVlq.value);
      if (tokenIndex >= tokenIds.length) return fail("Output " + (o + 1) + " refers to token index " + tokenIndex + ", but the transaction lists only " + tokenIds.length + " distinct token ID(s) — an embedded box names its tokens by index into that list, so these bytes do not parse as a serialized transaction from there onward.");
      var amtStart = pos;
      var amtVlq = readVlqBig(bytes, pos);
      if (!amtVlq) return step(outWhat + "'s token amount");
      pos += amtVlq.length;
      outTokens.push({ tokenId: tokenIds[tokenIndex], amount: amtVlq.value.toString() });
      var idB = hexToBytes(tokenIds[tokenIndex]);
      for (var ib = 0; ib < idB.length; ib++) outTokenFull.push(idB[ib]);
      for (var ab = amtStart; ab < pos; ab++) outTokenFull.push(bytes[ab]);
      var seenTotal = null;
      for (var tt = 0; tt < tokenTotals.length; tt++) if (tokenTotals[tt].tokenId === tokenIds[tokenIndex]) seenTotal = tokenTotals[tt];
      if (seenTotal) seenTotal.amount = (BigInt(seenTotal.amount) + amtVlq.value).toString();
      else tokenTotals.push({ tokenId: tokenIds[tokenIndex], amount: amtVlq.value.toString() });
    }
    var regStart = pos;
    var regCount = readCount(outWhat + "'s register count");
    if (!regCount) return step(outWhat + "'s register count");
    if (regCount.implausible || regCount.count > 6) return fail("Implausible register count (" + (regCount.implausible || regCount.count) + ") in output " + (o + 1) + " — a box carries at most the six non-mandatory registers R4–R9, so these bytes do not parse as a serialized transaction from there onward.");
    var outRegisters = [];
    for (var rg = 0; rg < regCount.count; rg++) {
      var regName = "R" + (4 + rg);
      var regConstStart = pos;
      var rType = parseSigmaType(bytes, pos);
      if (!rType) return fail("Output " + (o + 1) + "'s register " + regName + " holds a Sigma constant whose type is outside the set this parser decodes (the primitive, collection and tuple types — for example an Option, Box or AvlTree constant). Because a register's length comes from its type, the fields after it cannot be located safely, so the transaction is not decoded rather than guessed at.");
      pos += rType.length;
      var rData = parseSigmaData(rType.node, bytes, pos);
      if (!rData) return fail("Output " + (o + 1) + "'s register " + regName + " (" + sigmaTypeName(rType.node) + ") is truncated or holds a constant form this parser does not decode, so the fields after it cannot be located safely — the transaction is not decoded rather than guessed at.");
      pos += rData.length;
      outRegisters.push({ name: regName, type: sigmaTypeName(rType.node), value: rData.value, rawHex: bytesToHex(bytes.subarray(regConstStart, pos)) });
    }
    /* Box ID over the standalone serialization fleet rebuilds */
    var boxIdParts = [];
    for (var hb = outStart; hb < headEnd; hb++) boxIdParts.push(bytes[hb]);
    var cntBytes = writeVlqBig(BigInt(outTokens.length));
    for (var cb = 0; cb < cntBytes.length; cb++) boxIdParts.push(cntBytes[cb]);
    for (var fb = 0; fb < outTokenFull.length; fb++) boxIdParts.push(outTokenFull[fb]);
    for (var rb = regStart; rb < pos; rb++) boxIdParts.push(bytes[rb]);
    var txIdRaw = hexToBytes(txId);
    for (var xb = 0; xb < txIdRaw.length; xb++) boxIdParts.push(txIdRaw[xb]);
    var idxBytes = writeVlqBig(BigInt(o));
    for (var jb = 0; jb < idxBytes.length; jb++) boxIdParts.push(idxBytes[jb]);
    totalNano += outValue;
    outputs.push({
      index: o,
      byteLength: boxIdParts.length,
      boxId: bytesToHex(blake2b256(Uint8Array.from(boxIdParts))),
      valueNano: outValue.toString(),
      valueErg: nanoToErg(outValue.toString()),
      ergoTree: outTree,
      creationHeight: Number(outHeight),
      tokens: outTokens,
      registers: outRegisters
    });
  }
  if (pos !== bytes.length) return fail("There are " + (bytes.length - pos) + " extra byte(s) after the last output — a full serialized transaction ends exactly there, so this hex carries trailing data (it may be two transactions pasted together, or a lone box — tool 15 takes those).");
  var signed = inputs.some(function (inp) { return inp.proofLength > 0; });
  return {
    valid: true, reason: null,
    txId: txId,
    byteLength: bytes.length,
    signed: signed,
    inputs: inputs,
    dataInputs: dataInputs,
    tokenIds: tokenIds,
    outputs: outputs,
    totalOutputNano: totalNano.toString(),
    totalOutputErg: nanoToErg(totalNano.toString()),
    tokenTotals: tokenTotals
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

/* ---------- Serialized transaction builder ---------- */
/* The encode-side inverse of tool 29, in the exact layout
   fleet-sdk's serializeTransaction writes: [input count VLQ, then
   per input a 32-byte box ID + a VLQ-length-prefixed spending
   proof (a single 00 byte when there is none) + a context
   extension (count VLQ, then per entry a key VLQ + a Sigma
   constant)][data input count VLQ + that many 32-byte box IDs]
   [distinct token ID count VLQ + the IDs][output count VLQ, then
   the outputs as embedded boxes — value VLQ, ErgoTree verbatim,
   creation height VLQ, token count VLQ with each token named by
   its VLQ INDEX into the distinct-ID list, register count VLQ +
   constants]. The distinct-ID list is built the way fleet builds
   it: every token ID the outputs use, in order of first
   appearance across the outputs. A register or extension constant
   is given either as one of tool 17/18's typed specs (long:100)
   or as the constant's raw hex exactly as tool 15 displays it —
   the hex form also carries the types specs cannot express, like
   tuples, which real transactions use (fleet's raffle vector's
   registers are tuples). Extension entries are written in
   ascending key order, the order fleet's own writer emits for a
   key record, and duplicate keys are refused rather than silently
   merged. The transaction ID is the Blake2b-256 of the unsigned
   rewrite — proofs stripped, extensions kept — exactly as tool 29
   recomputes it. The assembled bytes are round-tripped through
   tool 29's parser before they are shown, and every field
   (including each output's recomputed box ID) must read back
   exactly; an output whose tree the parser cannot delimit (its
   stated limit — no size field, and not the P2PK tree or the
   miner fee contract) is therefore refused rather than emitted
   unverified, the same subset fleet-sdk itself round-trips in
   its deserializableTxVectors. Verified in the tests by
   rebuilding fleet-sdk's published transaction vectors
   byte-for-byte from their recorded fields — the unsigned
   no-token and one-token vectors, fleet's data-inputs variant,
   its signed raffle transaction, and a signed + extension
   variant — cross-checked with an independent Python build on
   2026-10-08. A built transaction is just bytes: nothing here
   signs (a proof field is data the user pastes, never a signature
   this tool makes), broadcasts or spends anything. */
function sigmaConstantBytes(entry) {
  var fail = function (reason) { return { valid: false, reason: reason }; };
  var s = entry == null ? "" : String(entry).trim();
  if (s === "") return fail("an empty entry — give a typed spec like long:100 (tool 18's forms) or one Sigma constant as hex exactly as tool 15 shows it.");
  var colon = s.indexOf(":");
  if (colon > 0 && /^[a-zA-Z]+$/.test(s.slice(0, colon))) {
    var enc = encodeSigmaConstant(s);
    if (!enc.valid) return fail(enc.reason);
    return { valid: true, bytes: enc.bytes, rawHex: enc.rawHex, typeName: enc.typeName, value: enc.value };
  }
  var bytes = hexToBytes(s.toLowerCase());
  if (!bytes) return fail("\"" + s + "\" is neither a typed spec (kind:value — tool 18 lists the kinds) nor one Sigma constant in hex.");
  var dec = decodeSigmaConstant(s);
  if (!dec.valid) return fail("\"" + s + "\" is not one complete Sigma constant: " + dec.reason);
  return { valid: true, bytes: Array.from(bytes), rawHex: dec.rawHex, typeName: dec.type, value: dec.value };
}
function buildErgoTransaction(fields) {
  var fail = function (reason) {
    return { valid: false, reason: reason, txHex: null, txId: null, byteLength: null, signed: null, tokenIds: null, outputs: null, totalOutputNano: null, totalOutputErg: null };
  };
  if (!fields) return fail("No fields supplied.");
  var digits = function (x) { return typeof x === "string" && /^\d+$/.test(x.trim()); };
  var hexId = function (x) { var b = hexToBytes(x == null ? "" : String(x).trim().toLowerCase()); return b && b.length === 32 ? b : null; };
  /* --- inputs --- */
  var inFields = fields.inputs || [];
  if (!Array.isArray(inFields) || inFields.length < 1 || inFields.length > 10000) return fail("A transaction spends at least one input box — give between 1 and 10,000 inputs.");
  var inputs = [];
  for (var i = 0; i < inFields.length; i++) {
    var inf = inFields[i] || {};
    var inId = hexId(inf.boxId);
    if (!inId) return fail("Input " + (i + 1) + ": a box ID is 32 bytes, 64 hex characters — got \"" + inf.boxId + "\".");
    var proofBytes = null;
    if (inf.proofHex != null && String(inf.proofHex).trim() !== "") {
      proofBytes = hexToBytes(String(inf.proofHex).trim().toLowerCase());
      if (!proofBytes) return fail("Input " + (i + 1) + ": the spending proof must be hex (an even number of 0-9/a-f characters) — leave it empty for an unsigned input.");
    }
    var extFields = inf.extension || [];
    if (!Array.isArray(extFields) || extFields.length > 10000) return fail("Input " + (i + 1) + ": the context extension is a list of key / constant entries.");
    var ext = [];
    var seenKeys = {};
    for (var e = 0; e < extFields.length; e++) {
      var ef = extFields[e] || {};
      if (!digits(ef.key == null ? "" : String(ef.key))) return fail("Input " + (i + 1) + ", extension entry " + (e + 1) + ": the key is a whole number (digits only).");
      var keyNum = Number(String(ef.key).trim());
      if (!Number.isSafeInteger(keyNum) || keyNum > 4294967295) return fail("Input " + (i + 1) + ", extension entry " + (e + 1) + ": a context extension key is an unsigned 32-bit number (0 to 4,294,967,295).");
      if (seenKeys[keyNum]) return fail("Input " + (i + 1) + ": extension key " + keyNum + " is given twice — one key holds one constant, so the duplicate is refused rather than merged.");
      seenKeys[keyNum] = true;
      var ec = sigmaConstantBytes(ef.value);
      if (!ec.valid) return fail("Input " + (i + 1) + ", extension key " + keyNum + ": " + ec.reason);
      ext.push({ key: keyNum, bytes: ec.bytes, rawHex: ec.rawHex, typeName: ec.typeName, value: ec.value });
    }
    ext.sort(function (a, b) { return a.key - b.key; });
    inputs.push({ boxId: bytesToHex(inId), boxIdBytes: inId, proofBytes: proofBytes, extension: ext });
  }
  /* --- data inputs --- */
  var diFields = fields.dataInputs || [];
  if (!Array.isArray(diFields) || diFields.length > 10000) return fail("Data inputs are a list of box IDs (boxes the scripts read but do not spend).");
  var dataInputs = [];
  for (var d = 0; d < diFields.length; d++) {
    var diId = hexId(diFields[d]);
    if (!diId) return fail("Data input " + (d + 1) + ": a box ID is 32 bytes, 64 hex characters — got \"" + diFields[d] + "\".");
    dataInputs.push(bytesToHex(diId));
  }
  /* --- outputs (candidates, validated like tool 17's fields) --- */
  var outFields = fields.outputs || [];
  if (!Array.isArray(outFields) || outFields.length < 1 || outFields.length > 10000) return fail("A transaction creates at least one output box — give between 1 and 10,000 outputs.");
  var tokenIds = [];
  var tokenIndex = {};
  var outputs = [];
  for (var o = 0; o < outFields.length; o++) {
    var of = outFields[o] || {};
    var oWhat = "Output " + (o + 1);
    if (!digits(of.valueNano)) return fail(oWhat + ": enter the value as a whole number of nanoERG (digits only — tool 1 converts ERG to nanoERG).");
    var oValue = BigInt(String(of.valueNano).trim());
    if (oValue < 1n || oValue > 9223372036854775807n) return fail(oWhat + ": a box value is a positive signed 64-bit amount of nanoERG (1 to 9,223,372,036,854,775,807) — and a spendable box must also clear the minimum-value rule in tool 5.");
    var oTree = hexToBytes(of.ergoTree == null ? "" : String(of.ergoTree));
    if (!oTree) return fail(oWhat + ": enter the guarding script's ErgoTree as hex (an even number of 0-9/a-f characters, with or without a 0x prefix) — tools 19, 16 and 11 produce trees from keys, scripts and addresses.");
    if (!digits(of.creationHeight)) return fail(oWhat + ": enter the creation height as a whole block number (digits only). It is normally the height of the block the transaction is mined in.");
    var oHeight = Number(String(of.creationHeight).trim());
    if (!Number.isSafeInteger(oHeight) || oHeight > 4294967295) return fail(oWhat + ": a creation height is an unsigned 32-bit block number (0 to 4,294,967,295).");
    var tkFields = of.tokens || [];
    if (!Array.isArray(tkFields) || tkFields.length > 10000) return fail(oWhat + ": tokens are a list of token ID / amount pairs.");
    var oTokens = [];
    for (var t = 0; t < tkFields.length; t++) {
      var tf = tkFields[t] || {};
      var tkId = hexId(tf.tokenId);
      if (!tkId) return fail(oWhat + ", token " + (t + 1) + ": a token ID is 32 bytes, 64 hex characters — got \"" + tf.tokenId + "\".");
      if (!digits(tf.amount)) return fail(oWhat + ", token " + (t + 1) + ": enter the amount as a whole raw integer (digits only — tool 6 converts display amounts to raw).");
      var tkAmt = BigInt(String(tf.amount).trim());
      if (tkAmt < 1n || tkAmt > 9223372036854775807n) return fail(oWhat + ", token " + (t + 1) + ": a token amount is a positive signed 64-bit raw integer.");
      var tkHex = bytesToHex(tkId);
      if (!(tkHex in tokenIndex)) { tokenIndex[tkHex] = tokenIds.length; tokenIds.push(tkHex); }
      oTokens.push({ tokenId: tkHex, amount: tkAmt, index: tokenIndex[tkHex] });
    }
    var rgFields = of.registers || [];
    if (!Array.isArray(rgFields) || rgFields.length > 6) return fail(oWhat + ": a box carries at most the six non-mandatory registers R4–R9.");
    var oRegs = [];
    for (var r = 0; r < rgFields.length; r++) {
      var rc = sigmaConstantBytes(rgFields[r]);
      if (!rc.valid) return fail(oWhat + ", register R" + (4 + r) + ": " + rc.reason);
      oRegs.push(rc);
    }
    outputs.push({ value: oValue, treeBytes: oTree, treeHex: bytesToHex(oTree), height: oHeight, tokens: oTokens, registers: oRegs });
  }
  /* --- serialize --- */
  var bytes = [];
  var unsignedHead = [];
  var push = function (arr, x) { for (var i = 0; i < x.length; i++) arr.push(x[i]); };
  push(bytes, writeVlqBig(BigInt(inputs.length)));
  inputs.forEach(function (inp) {
    var signedPart = [];
    push(signedPart, Array.from(inp.boxIdBytes));
    if (inp.proofBytes && inp.proofBytes.length > 0) { push(signedPart, writeVlqBig(BigInt(inp.proofBytes.length))); push(signedPart, Array.from(inp.proofBytes)); }
    else signedPart.push(0);
    var unsignedPart = Array.from(inp.boxIdBytes);
    unsignedPart.push(0);
    var extBytes = writeVlqBig(BigInt(inp.extension.length));
    inp.extension.forEach(function (x) { push(extBytes, writeVlqBig(BigInt(x.key))); push(extBytes, x.bytes); });
    push(signedPart, extBytes);
    push(unsignedPart, extBytes);
    push(bytes, signedPart);
    push(unsignedHead, unsignedPart);
  });
  var rest = [];
  push(rest, writeVlqBig(BigInt(dataInputs.length)));
  dataInputs.forEach(function (id) { push(rest, Array.from(hexToBytes(id))); });
  push(rest, writeVlqBig(BigInt(tokenIds.length)));
  tokenIds.forEach(function (id) { push(rest, Array.from(hexToBytes(id))); });
  push(rest, writeVlqBig(BigInt(outputs.length)));
  outputs.forEach(function (op) {
    push(rest, writeVlqBig(op.value));
    push(rest, Array.from(op.treeBytes));
    push(rest, writeVlqBig(BigInt(op.height)));
    push(rest, writeVlqBig(BigInt(op.tokens.length)));
    op.tokens.forEach(function (tk) { push(rest, writeVlqBig(BigInt(tk.index))); push(rest, writeVlqBig(tk.amount)); });
    push(rest, writeVlqBig(BigInt(op.registers.length)));
    op.registers.forEach(function (rg) { push(rest, rg.bytes); });
  });
  push(bytes, rest);
  var unsignedBytes = writeVlqBig(BigInt(inputs.length)).concat(unsignedHead, rest);
  var txHex = bytesToHex(Uint8Array.from(bytes));
  var txId = bytesToHex(blake2b256(Uint8Array.from(unsignedBytes)));
  /* --- round-trip through tool 29's parser --- */
  var parsed = parseErgoTransaction(txHex);
  if (!parsed.valid) return fail("These fields assemble, but the result does not read back through the transaction parser (tool 29): " + parsed.reason + " The bytes are refused rather than shown unverified.");
  var roundTripped = parsed.txId === txId &&
    parsed.inputs.length === inputs.length &&
    parsed.dataInputs.length === dataInputs.length &&
    parsed.tokenIds.length === tokenIds.length &&
    parsed.outputs.length === outputs.length &&
    parsed.inputs.every(function (pi, ii) {
      var inp = inputs[ii];
      return pi.boxId === inp.boxId &&
        pi.proofLength === (inp.proofBytes ? inp.proofBytes.length : 0) &&
        pi.proofBytes === (inp.proofBytes && inp.proofBytes.length > 0 ? bytesToHex(inp.proofBytes) : null) &&
        pi.extension.length === inp.extension.length &&
        pi.extension.every(function (px, ei) { var x = inp.extension[ei]; return px.key === x.key && px.type === x.typeName && px.value === x.value && px.rawHex === x.rawHex; });
    }) &&
    parsed.dataInputs.every(function (pd, di) { return pd === dataInputs[di]; }) &&
    parsed.tokenIds.every(function (pt, ti) { return pt === tokenIds[ti]; }) &&
    parsed.outputs.every(function (po, oi) {
      var op = outputs[oi];
      return po.valueNano === op.value.toString() &&
        po.ergoTree === op.treeHex &&
        po.creationHeight === op.height &&
        po.tokens.length === op.tokens.length &&
        po.tokens.every(function (pt, ti) { return pt.tokenId === op.tokens[ti].tokenId && pt.amount === op.tokens[ti].amount.toString(); }) &&
        po.registers.length === op.registers.length &&
        po.registers.every(function (pr, ri) { return pr.type === op.registers[ri].typeName && pr.value === op.registers[ri].value && pr.rawHex === op.registers[ri].rawHex; });
    });
  if (!roundTripped) return fail("Internal round-trip check failed: the assembled bytes do not parse back to exactly these fields — refusing to show them rather than risk a mismatched transaction.");
  var signed = inputs.some(function (inp) { return inp.proofBytes && inp.proofBytes.length > 0; });
  return {
    valid: true, reason: null,
    txHex: txHex,
    txId: txId,
    byteLength: bytes.length,
    signed: signed,
    tokenIds: tokenIds,
    outputs: parsed.outputs.map(function (po) { return { index: po.index, boxId: po.boxId, valueNano: po.valueNano, valueErg: po.valueErg }; }),
    totalOutputNano: parsed.totalOutputNano,
    totalOutputErg: parsed.totalOutputErg
  };
}

/* ---------- SHA-512 + HMAC-SHA512 (FIPS 180-4 / RFC 2104) ---------- */
/* Ergo's HD wallet math runs on HMAC-SHA512 (BIP32), which no other
   tool here needed — Blake2b covers Ergo's hashes, SHA-256 covers
   nothing in this hub. Pure-JS BigInt SHA-512, so it runs identically
   in the browser and in Node for the tests. The round constants are
   the standard fractional parts of the square/cube roots of the
   first primes; they were regenerated from first principles in the
   Python oracle and the whole implementation was verified against
   hashlib (empty, short and multi-block inputs) and RFC 4231
   HMAC test case 1 BEFORE any of it shipped here. */
var S512_H = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n
];
var S512_K = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n
];
function sha512(bytes) {
  var bitLen = BigInt(bytes.length) * 8n;
  var total = bytes.length + 1;
  while (total % 128 !== 112) total++;
  total += 16;
  var msg = new Uint8Array(total);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  for (var i = 0; i < 16; i++) msg[total - 1 - i] = Number((bitLen >> BigInt(8 * i)) & 0xffn);
  var h = S512_H.slice();
  var w = new Array(80);
  var ch, mj, s0, s1, t1, t2;
  for (var off = 0; off < total; off += 128) {
    for (var t = 0; t < 16; t++) {
      var v = 0n;
      for (var b = 0; b < 8; b++) v = (v << 8n) | BigInt(msg[off + t * 8 + b]);
      w[t] = v;
    }
    for (t = 16; t < 80; t++) {
      s0 = rotr64(w[t - 15], 1) ^ rotr64(w[t - 15], 8) ^ (w[t - 15] >> 7n);
      s1 = rotr64(w[t - 2], 19) ^ rotr64(w[t - 2], 61) ^ (w[t - 2] >> 6n);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & MASK64;
    }
    var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (t = 0; t < 80; t++) {
      s1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
      ch = (e & f) ^ ((e ^ MASK64) & g);
      t1 = (hh + s1 + ch + S512_K[t] + w[t]) & MASK64;
      s0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
      mj = (a & bb) ^ (a & c) ^ (bb & c);
      t2 = (s0 + mj) & MASK64;
      hh = g; g = f; f = e; e = (d + t1) & MASK64; d = c; c = bb; bb = a; a = (t1 + t2) & MASK64;
    }
    h[0] = (h[0] + a) & MASK64; h[1] = (h[1] + bb) & MASK64; h[2] = (h[2] + c) & MASK64; h[3] = (h[3] + d) & MASK64;
    h[4] = (h[4] + e) & MASK64; h[5] = (h[5] + f) & MASK64; h[6] = (h[6] + g) & MASK64; h[7] = (h[7] + hh) & MASK64;
  }
  var out = new Uint8Array(64);
  for (var j = 0; j < 8; j++) for (var k = 0; k < 8; k++) out[j * 8 + k] = Number((h[j] >> BigInt(8 * (7 - k))) & 0xffn);
  return out;
}
function hmacSha512(keyBytes, msgBytes) {
  var key = keyBytes;
  if (key.length > 128) key = sha512(key);
  var padded = new Uint8Array(128);
  padded.set(key);
  var inner = new Uint8Array(128 + msgBytes.length);
  var outer = new Uint8Array(128 + 64);
  for (var i = 0; i < 128; i++) { inner[i] = padded[i] ^ 0x36; outer[i] = padded[i] ^ 0x5c; }
  inner.set(msgBytes, 128);
  outer.set(sha512(inner), 128);
  return sha512(outer);
}

/* ---------- secp256k1 public keys (Jacobian point math, BigInt) ---------- */
/* The curve every Ergo key lives on. Constants are the standard
   ones; the generator's y-coordinate was re-derived from x by the
   oracle (a from-memory transcription dropped a digit and failed
   the curve equation — caught before shipping, which is what the
   oracle is for). Verified in the tests: private keys 1 and 2 map
   to their well-known compressed public keys. */
var SECP_P = BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f");
var SECP_N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
var SECP_G = [BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
              BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8"), 1n];
function secpMod(x) { var r = x % SECP_P; return r >= 0n ? r : r + SECP_P; }
function secpDouble(pt) {
  if (pt === null || pt[1] === 0n) return null;
  var x = pt[0], y = pt[1], z = pt[2];
  var yy = secpMod(y * y);
  var s = secpMod(4n * x * yy);
  var m = secpMod(3n * x * x);
  var nx = secpMod(m * m - 2n * s);
  var ny = secpMod(m * (s - nx) - 8n * yy * yy);
  return [nx, ny, secpMod(2n * y * z)];
}
function secpAdd(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  var z1z1 = secpMod(p1[2] * p1[2]), z2z2 = secpMod(p2[2] * p2[2]);
  var u1 = secpMod(p1[0] * z2z2), u2 = secpMod(p2[0] * z1z1);
  var s1 = secpMod(p1[1] * p2[2] * z2z2), s2 = secpMod(p2[1] * p1[2] * z1z1);
  if (u1 === u2) {
    if (s1 !== s2) return null;
    return secpDouble(p1);
  }
  var h = secpMod(u2 - u1), r = secpMod(s2 - s1);
  var hh = secpMod(h * h), hhh = secpMod(h * hh);
  var v = secpMod(u1 * hh);
  var nx = secpMod(r * r - hhh - 2n * v);
  var ny = secpMod(r * (v - nx) - s1 * hhh);
  return [nx, ny, secpMod(h * p1[2] * p2[2])];
}
function secp256k1PublicKey(privBytes) {
  if (!privBytes || privBytes.length !== 32) return null;
  var d = 0n;
  for (var i = 0; i < 32; i++) d = (d << 8n) | BigInt(privBytes[i]);
  if (d === 0n || d >= SECP_N) return null;
  var pt = null;
  for (var bit = 255; bit >= 0; bit--) {
    pt = secpDouble(pt) || (bit === 255 ? null : pt);
    if (pt === null && bit !== 255) pt = null;
    if (((d >> BigInt(bit)) & 1n) === 1n) pt = secpAdd(pt, SECP_G);
    if (bit === 255 && ((d >> 255n) & 1n) === 0n) pt = null;
  }
  if (pt === null) return null;
  /* Jacobian -> affine: one inversion via Fermat's little theorem */
  var zInv = 1n, base = pt[2], exp = SECP_P - 2n;
  var b = base, e2 = exp;
  var acc = 1n;
  while (e2 > 0n) { if ((e2 & 1n) === 1n) acc = secpMod(acc * b); b = secpMod(b * b); e2 >>= 1n; }
  zInv = acc;
  var zInv2 = secpMod(zInv * zInv);
  var ax = secpMod(pt[0] * zInv2);
  var ay = secpMod(pt[1] * zInv2 * zInv);
  var out = new Uint8Array(33);
  out[0] = (ay & 1n) === 1n ? 0x03 : 0x02;
  for (var k = 0; k < 32; k++) out[1 + k] = Number((ax >> BigInt(8 * (31 - k))) & 0xffn);
  return out;
}

/* ---------- HD address derivation (BIP32 + EIP-3, seed -> addresses) ---------- */
/* How every Ergo wallet turns one seed into addresses: the master
   key is HMAC-SHA512(key "Bitcoin seed", seed) split in half
   (key | chain code); each child is HMAC-SHA512(chain code, data)
   where data is 0x00 + parent key + index for hardened steps and
   the parent's compressed public key + index for normal steps, and
   the child key is (left half + parent key) mod the group order —
   exactly ergo-wallet's ExtendedSecretKey, including its retry with
   index+1 when a child would be invalid (probability ~2^-127, but
   the reference does it, so this does too). EIP-3 fixes the path:
   m/44'/429'/account'/change/index, coin type 429. Only public
   material ever leaves this function — public keys and addresses,
   never private keys — and the derived addresses are round-tripped
   through tool 11's decoder before being shown. The seed itself is
   the master secret of a wallet: the form says so in plain words,
   and nothing here is stored or sent anywhere. Verified in the
   tests against an independent Python implementation (hashlib/hmac
   + pure-Python curve math) fed with the published BIP39 test seed
   for "abandon" x11 + "about" and two further seeds, on both
   networks, hardened and non-hardened branches alike. */
var HD_HARDENED = 0x80000000;
var HD_COIN_TYPE = 429;
function hdMasterKey(seedBytes) {
  var digest = hmacSha512(utf8Bytes("Bitcoin seed"), seedBytes);
  return { key: digest.slice(0, 32), chain: digest.slice(32, 64) };
}
function hdChildKey(parent, index) {
  var idx = index;
  for (;;) {
    var data;
    if (idx >= HD_HARDENED) {
      data = new Uint8Array(37);
      data[0] = 0;
      data.set(parent.key, 1);
    } else {
      data = new Uint8Array(37);
      data.set(secp256k1PublicKey(parent.key), 0);
    }
    for (var i = 0; i < 4; i++) data[33 + i] = (idx >>> (8 * (3 - i))) & 0xff;
    var digest = hmacSha512(parent.chain, data);
    var left = 0n;
    for (var j = 0; j < 32; j++) left = (left << 8n) | BigInt(digest[j]);
    var parentInt = 0n;
    for (var k = 0; k < 32; k++) parentInt = (parentInt << 8n) | BigInt(parent.key[k]);
    var child = (left + parentInt) % SECP_N;
    if (left < SECP_N && child !== 0n) {
      var key = new Uint8Array(32);
      for (var m = 0; m < 32; m++) key[m] = Number((child >> BigInt(8 * (31 - m))) & 0xffn);
      return { key: key, chain: digest.slice(32, 64) };
    }
    idx += 1;
    if (idx > 0xffffffff) return null;
  }
}
function parseHdIndex(str, what) {
  var s = (str == null ? "" : String(str)).trim();
  if (!/^(0|[1-9][0-9]*)$/.test(s)) return { error: what + " must be a whole number — got \"" + s + "\"." };
  var v = Number(s);
  if (!Number.isSafeInteger(v) || v > 2147483647) return { error: what + " must be between 0 and 2147483647 (the BIP32 index space is 31 bits plus the hardened flag)." };
  return { value: v };
}
function deriveHdAddresses(seedHex, accountStr, changeStr, countStr) {
  var fail = function (reason) { return { valid: false, reason: reason, rows: [] }; };
  var s = (seedHex == null ? "" : String(seedHex)).trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]+$/.test(s) || s.length % 2 !== 0) return fail("The seed must be hex — an even number of 0-9/a-f characters. A BIP39 seed is 64 bytes (128 hex characters); the words themselves are not a seed, and this tool deliberately takes no mnemonic: converting words to a seed is a wallet's job, on a device you trust.");
  var seedBytes = hexToBytes(s);
  if (seedBytes === null || seedBytes.length < 16 || seedBytes.length > 64) return fail("The seed must be 16 to 64 bytes (32 to 128 hex characters) — the BIP32 seed length range. A standard BIP39 seed is 64 bytes.");
  var account = parseHdIndex(accountStr === "" || accountStr == null ? "0" : accountStr, "The account index");
  if (account.error) return fail(account.error);
  var changeParsed = parseHdIndex(changeStr === "" || changeStr == null ? "0" : changeStr, "The change index");
  if (changeParsed.error) return fail(changeParsed.error);
  if (changeParsed.value > 1) return fail("The change index is 0 for receiving addresses or 1 for internal change addresses — EIP-3 wallets use those two branches.");
  var countParsed = parseHdIndex(countStr === "" || countStr == null ? "5" : countStr, "The address count");
  if (countParsed.error) return fail(countParsed.error);
  if (countParsed.value < 1 || countParsed.value > 20) return fail("The address count must be between 1 and 20 — enough to check a wallet's first screen of addresses without turning this page into a key grinder.");
  var node = hdMasterKey(seedBytes);
  var pathIdx = [44 + HD_HARDENED, HD_COIN_TYPE + HD_HARDENED, account.value + HD_HARDENED, changeParsed.value];
  for (var p = 0; p < pathIdx.length; p++) {
    node = hdChildKey(node, pathIdx[p]);
    if (node === null) return fail("Derivation hit the index ceiling — no valid child key exists at this path.");
  }
  var rows = [];
  for (var i = 0; i < countParsed.value; i++) {
    var child = hdChildKey(node, i);
    if (child === null) return fail("Derivation hit the index ceiling — no valid child key exists at this path.");
    var pub = secp256k1PublicKey(child.key);
    if (pub === null) return fail("A derived key fell outside the curve's valid range — refusing to invent an address for it.");
    var pubHex = bytesToHex(pub);
    var mainnet = p2pkAddressFromPublicKey(pubHex, "mainnet");
    var testnet = p2pkAddressFromPublicKey(pubHex, "testnet");
    var backMain = decodeErgoAddress(mainnet);
    var backTest = decodeErgoAddress(testnet);
    if (!backMain.valid || backMain.publicKey !== pubHex || !backTest.valid || backTest.publicKey !== pubHex) {
      return fail("Internal round-trip check failed: a derived address does not decode back to its own public key — refusing to show it.");
    }
    rows.push({
      index: i,
      path: "m/44'/429'/" + account.value + "'/" + changeParsed.value + "/" + i,
      publicKey: pubHex,
      mainnet: mainnet,
      testnet: testnet
    });
  }
  return { valid: true, reason: null, account: account.value, change: changeParsed.value, rows: rows };
}

/* ---------- Public key inspector (compressed key -> curve point) ---------- */
/* The check tools 8 and 19 do not make: they accept any 33 bytes
   starting 02 or 03 as a compressed public key, but a compressed key
   is only a real key if its x-coordinate names a point on secp256k1 —
   y^2 = x^3 + 7 (mod p). About half of all x values have no point at
   all (x^3 + 7 is then a quadratic non-residue mod p), and any
   x >= p is out of the field entirely; an "address" built from those
   bytes guards a key nobody can ever hold. This inspector recovers y
   the standard way — the field prime is 3 (mod 4), so a square root
   of the right-hand side, when one exists, is rhs^((p+1)/4) mod p —
   then pins the parity the prefix claims (02 = even y, 03 = odd y;
   the other root, p - y, is the point's negation, so the same x
   under the other prefix is a different, also valid, point). The
   recovered point is re-verified against the curve equation and
   re-compressed before anything is shown, and the P2PK addresses
   are round-tripped through tool 11's decoder. Also shown: the
   uncompressed form (04 + x + y) and the SGroupElement Sigma
   constant (type byte 07 + the compressed bytes) that tool 18
   reads and writes. Verified against an independent Python oracle
   (pure-Python EC multiplication for the keys of private keys 1-3,
   pow-based decompression, hashlib address construction) in the
   tests, including the generator, its negation, my own address's
   key, and the non-residue x = 0. A public key is public: inspecting
   one proves no ownership of it and finds no private key. */
function secpPowMod(base, exp) {
  var acc = 1n, b = secpMod(base), e = exp;
  while (e > 0n) { if ((e & 1n) === 1n) acc = secpMod(acc * b); b = secpMod(b * b); e >>= 1n; }
  return acc;
}
function bigIntToHex64(v) {
  var s = v.toString(16);
  while (s.length < 64) s = "0" + s;
  return s;
}
function inspectPublicKey(pubkeyHex) {
  var fail = function (reason) {
    return { valid: false, reason: reason, publicKey: null, x: null, y: null, yParity: null, uncompressedHex: null, sigmaConstantHex: null, mainnet: null, testnet: null };
  };
  var s = (pubkeyHex == null ? "" : String(pubkeyHex)).trim().toLowerCase();
  if (s.indexOf("0x") === 0) s = s.slice(2);
  if (!/^[0-9a-f]{66}$/.test(s)) return fail("Enter a compressed public key as 66 hex characters (33 bytes) starting 02 or 03 — public keys only: never enter a private key or seed phrase anywhere, including here. An uncompressed key (65 bytes, starting 04) is not the form Ergo P2PK scripts carry; compressing it is just its x-coordinate plus a 02/03 prefix for its y's parity, which this tool reads rather than writes.");
  var prefix = parseInt(s.slice(0, 2), 16);
  if (prefix !== 2 && prefix !== 3) return fail("That is not a compressed public key: a compressed secp256k1 key is 33 bytes and starts 02 (even y) or 03 (odd y) — this starts " + s.slice(0, 2) + ".");
  var x = BigInt("0x" + s.slice(2));
  if (x >= SECP_P) return fail("This key's x-coordinate is outside the secp256k1 field — x must be less than the field prime p (ffffffff…fffffffefffffc2f), and this x is not. No point on the curve has this x, so no private key exists for it: it is not a public key at all, whatever address could be formatted around its bytes.");
  var rhs = secpMod(x * x * x + 7n);
  var y = secpPowMod(rhs, (SECP_P + 1n) / 4n);
  if (secpMod(y * y) !== rhs) return fail("This x-coordinate has no point on secp256k1: x^3 + 7 is a quadratic non-residue modulo p, so no y satisfies y^2 = x^3 + 7 for it. Roughly half of all x values are like this. No private key exists for these bytes — it is not a public key at all, whatever address could be formatted around them.");
  if (((y & 1n) === 1n) !== (prefix === 3)) y = SECP_P - y;
  if (secpMod(y * y) !== secpMod(x * x * x + 7n) || ((y & 1n) === 1n) !== (prefix === 3)) {
    return fail("Internal check failed: the recovered point does not satisfy the curve equation at the prefix's parity — refusing to show it.");
  }
  var recompressed = ((y & 1n) === 1n ? "03" : "02") + bigIntToHex64(x);
  if (recompressed !== s) return fail("Internal round-trip check failed: the recovered point does not re-compress to exactly this key — refusing to show it.");
  var mainnet = p2pkAddressFromPublicKey(s, "mainnet");
  var testnet = p2pkAddressFromPublicKey(s, "testnet");
  var back = decodeErgoAddress(mainnet);
  if (!mainnet || !testnet || !back.valid || back.publicKey !== s) {
    return fail("Internal round-trip check failed: the P2PK address built from this key does not decode back to it — refusing to show it.");
  }
  return {
    valid: true, reason: null, publicKey: s,
    x: bigIntToHex64(x), y: bigIntToHex64(y),
    yParity: (y & 1n) === 1n ? "odd" : "even",
    uncompressedHex: "04" + bigIntToHex64(x) + bigIntToHex64(y),
    sigmaConstantHex: "07" + s,
    mainnet: mainnet, testnet: testnet
  };
}

/* ---------- Box set summarizer (many boxes -> one set of totals) ---------- */
/* Tool 15 reads one box; a wallet holds many. This reads a whole
   pasted set — one full serialized box per line — and answers for
   the set what tool 25 answers for one box, composing the same
   analysers so the figures can never disagree with the single-box
   tools: each line is parsed by tool 15 itself, each box's minimum
   is tool 5's (serialized bytes x 360 nanoERG), and rent
   eligibility is tool 7's rule (creation height + 1,051,200
   blocks, STORAGE_PERIOD_BLOCKS) applied per box when the user
   supplies a current height. Totals are exact BigInt sums; token
   amounts aggregate by token ID in first-appearance order, raw
   on-chain integers as everywhere on this hub. The set is strict:
   a line that does not parse stops the whole summary with that
   line named (a silently skipped box would understate the totals
   without any sign), and the same box listed twice is refused —
   its ID would double-count the same on-chain box. Nothing here
   fetches anything: the boxes and the height are user-supplied,
   the summary is a statement about the pasted bytes, not a live
   wallet balance, and the page says so. Verified against an
   independent Python oracle (from-scratch VLQ/box reader +
   hashlib) over fleet-sdk's published box vectors, preserved in
   the goal's hidden files. */
function summarizeBoxSet(boxesText, currentHeightStr) {
  var fail = function (reason) {
    return { valid: false, reason: reason, boxes: null, boxCount: null, totalNano: null, totalErg: null, totalBytes: null, minTotalNano: null, minTotalErg: null, allMeetMinimum: null, belowMinimum: null, tokenTotals: null, distinctTokens: null, currentHeight: null, eligibleCount: null, eligibleNano: null, eligibleErg: null };
  };
  var lines = (boxesText == null ? "" : String(boxesText)).split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ""; });
  if (lines.length === 0) return fail("Paste at least one full serialized box as hex, one box per line — SDKs and node APIs produce the bytes, and explorers link them from a box's page. This summarizes the boxes you paste; it fetches nothing and is not a live wallet balance.");
  if (lines.length > 100) return fail("That is " + lines.length + " lines — this tool summarizes at most 100 boxes at a time, so a pasted set stays reviewable line by line.");
  var current = null;
  var heightGiven = !(currentHeightStr == null || String(currentHeightStr).trim() === "");
  if (heightGiven) {
    var parsedHeight = parseChainHeight(currentHeightStr);
    if (parsedHeight === null) return fail("The current height must be a whole number of blocks (digits only) — it is the height on the box's explorer page or your node's status. Leave it blank to summarize without the storage-rent eligibility figures.");
    current = BigInt(parsedHeight);
  }
  var boxes = [];
  var seen = {};
  var total = 0n;
  var totalBytes = 0;
  var minTotal = 0n;
  var belowMinimum = [];
  var tokenOrder = [];
  var tokenMap = {};
  var eligibleCount = 0;
  var eligibleTotal = 0n;
  for (var i = 0; i < lines.length; i++) {
    var parsed = parseErgoBox(lines[i]);
    if (!parsed.valid) return fail("Line " + (i + 1) + " does not parse as a serialized box: " + parsed.reason + " The whole set is refused rather than summarized without it — a skipped box would understate every total with no sign it had happened.");
    if (Object.prototype.hasOwnProperty.call(seen, parsed.boxId)) return fail("Line " + (i + 1) + " is the same box as line " + seen[parsed.boxId] + " (box ID " + parsed.boxId + ") — a box listed twice would double-count the same on-chain box in every total, so the set is refused; remove the duplicate line.");
    seen[parsed.boxId] = i + 1;
    var value = BigInt(parsed.valueNano);
    total += value;
    totalBytes += parsed.byteLength;
    var minStr = minBoxValueNano(String(parsed.byteLength));
    var min = BigInt(minStr);
    minTotal += min;
    if (value < min) belowMinimum.push({ boxId: parsed.boxId, minNano: minStr, shortfallNano: (min - value).toString() });
    var eligibility = null;
    var eligible = null;
    if (current !== null) {
      eligibility = BigInt(parsed.creationHeight) + BigInt(STORAGE_PERIOD_BLOCKS);
      eligible = current >= eligibility;
      if (eligible) { eligibleCount++; eligibleTotal += value; }
    }
    for (var t = 0; t < parsed.tokens.length; t++) {
      var tk = parsed.tokens[t];
      if (!Object.prototype.hasOwnProperty.call(tokenMap, tk.tokenId)) {
        tokenMap[tk.tokenId] = { tokenId: tk.tokenId, amount: 0n, boxCount: 0 };
        tokenOrder.push(tk.tokenId);
      }
      tokenMap[tk.tokenId].amount += BigInt(tk.amount);
      tokenMap[tk.tokenId].boxCount++;
    }
    boxes.push({
      line: i + 1, boxId: parsed.boxId, byteLength: parsed.byteLength,
      valueNano: parsed.valueNano, valueErg: parsed.valueErg,
      creationHeight: parsed.creationHeight, tokenCount: parsed.tokens.length,
      eligibilityHeight: eligibility === null ? null : Number(eligibility),
      eligible: eligible
    });
  }
  return {
    valid: true, reason: null,
    boxes: boxes, boxCount: boxes.length,
    totalNano: total.toString(), totalErg: nanoToErg(total.toString()),
    totalBytes: totalBytes,
    minTotalNano: minTotal.toString(), minTotalErg: nanoToErg(minTotal.toString()),
    allMeetMinimum: belowMinimum.length === 0, belowMinimum: belowMinimum,
    tokenTotals: tokenOrder.map(function (id) { var e = tokenMap[id]; return { tokenId: e.tokenId, amount: e.amount.toString(), boxCount: e.boxCount }; }),
    distinctTokens: tokenOrder.length,
    currentHeight: current === null ? null : Number(current),
    eligibleCount: current === null ? null : eligibleCount,
    eligibleNano: current === null ? null : eligibleTotal.toString(),
    eligibleErg: current === null ? null : nanoToErg(eligibleTotal.toString())
  };
}

/* ---------- Transaction fee & balance checker ---------- */
/* Tool 29 parses a transaction but cannot say what it cost: the
   bytes carry the outputs, never the input values. This tool
   closes that gap the only honest way — the user also pastes the
   transaction's input boxes (tool 15's bytes, one per line), each
   pasted box's ID is matched against the transaction's input list,
   and the accounting is then exact BigInt arithmetic:
     - ERG must balance exactly. Ergo creates no ERG inside a
       transaction (new coins enter only through the emission
       contract in a miner's coinbase), so inputs − outputs is 0
       for every valid non-coinbase transaction; a nonzero
       difference is reported plainly as proof that the pasted
       boxes are not this transaction's inputs, or the bytes are
       not a valid transaction.
     - The fee is not a field and is not the difference: it is the
       ERG locked in outputs guarded by the miner fee contract
       (FEE_CONTRACT_HEX — sigmastate's fee proposition), the way
       TX_V2's second output in tool 29's vectors pays it.
     - Tokens must conserve too: out ≤ in per token, the shortfall
       being a burn — with exactly one exception. A token that
       appears only in outputs was minted by this transaction, and
       the protocol fixes a minted token's ID as the box ID of the
       transaction's first input (that is also where tool 14's
       note points). An output-only token with any other ID, or
       out > in for a carried token, cannot occur in a valid
       transaction and is flagged, never smoothed over.
     - Data inputs are read, not spent: their value never enters
       the sums, and pasting a data-input box among the inputs is
       refused with that stated.
   The match is strict in both directions — a missing input box
   and an extra pasted box both stop the check — because a partial
   accounting would print a confident, wrong fee. */
function analyzeTxFee(txHex, boxesText) {
  var fail = function (reason) {
    return { valid: false, reason: reason, txId: null, signed: null, inputCount: null, inputNano: null, inputErg: null, outputNano: null, outputErg: null, differenceNano: null, differenceErg: null, balanced: null, feeNano: null, feeErg: null, feeOutputCount: null, tokenBalances: null, tokensConserved: null, mintedTokens: null, dataInputCount: null };
  };
  var tx = parseErgoTransaction(txHex);
  if (!tx.valid) return fail("The transaction bytes do not parse: " + tx.reason);
  var lines = (boxesText == null ? "" : String(boxesText)).split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ""; });
  if (lines.length === 0) return fail("Paste the transaction's input boxes too, one full serialized box per line — a transaction's bytes carry its outputs but never its input values, so the fee and the balance can only be checked against the boxes it spends (explorers link each input's box from the transaction's page; tool 15 reads one box at a time).");
  if (lines.length > 100) return fail("That is " + lines.length + " lines — this tool checks at most 100 input boxes at a time, so a pasted set stays reviewable line by line.");
  var byId = {};
  for (var i = 0; i < lines.length; i++) {
    var parsed = parseErgoBox(lines[i]);
    if (!parsed.valid) return fail("Line " + (i + 1) + " does not parse as a serialized box: " + parsed.reason + " The whole check is refused rather than run on a partial input set — a missing input would understate the input total and invent a fee that is not there.");
    if (Object.prototype.hasOwnProperty.call(byId, parsed.boxId)) return fail("Line " + (i + 1) + " is the same box as an earlier line (box ID " + parsed.boxId + ") — a box listed twice would double-count the same on-chain box in the input total, so the check is refused; remove the duplicate line.");
    byId[parsed.boxId] = parsed;
  }
  var inputNano = 0n;
  var inTokens = {};
  var inOrder = [];
  for (var k = 0; k < tx.inputs.length; k++) {
    var want = tx.inputs[k].boxId;
    if (!Object.prototype.hasOwnProperty.call(byId, want)) return fail("Input " + (k + 1) + " of the transaction (box ID " + want + ") is not among the pasted boxes — paste every box the transaction spends; a partial set would understate the input total and invent a fee that is not there.");
    var box = byId[want];
    delete byId[want];
    inputNano += BigInt(box.valueNano);
    for (var t = 0; t < box.tokens.length; t++) {
      var tk = box.tokens[t];
      if (!Object.prototype.hasOwnProperty.call(inTokens, tk.tokenId)) { inTokens[tk.tokenId] = 0n; inOrder.push(tk.tokenId); }
      inTokens[tk.tokenId] += BigInt(tk.amount);
    }
  }
  var leftover = Object.keys(byId);
  if (leftover.length > 0) {
    var extra = byId[leftover[0]];
    if (tx.dataInputs.indexOf(extra.boxId) !== -1) return fail("The pasted box " + extra.boxId + " is a data input of this transaction — data inputs are read by the scripts, never spent, so their ERG and tokens do not enter the balance. Remove it from the input boxes.");
    return fail("The pasted box " + extra.boxId + " is not an input of this transaction — the check covers exactly the boxes the transaction spends; an extra box would overstate the input total and invent a fee that is not there. Remove it.");
  }
  var feeNano = 0n;
  var feeOutputCount = 0;
  for (var o = 0; o < tx.outputs.length; o++) {
    if (tx.outputs[o].ergoTree === FEE_CONTRACT_HEX) { feeNano += BigInt(tx.outputs[o].valueNano); feeOutputCount++; }
  }
  var outTokens = {};
  for (var q = 0; q < tx.tokenTotals.length; q++) outTokens[tx.tokenTotals[q].tokenId] = BigInt(tx.tokenTotals[q].amount);
  var firstInputId = tx.inputs[0].boxId;
  var tokenBalances = [];
  var mintedTokens = [];
  var tokensConserved = true;
  var seenOut = {};
  var addBalance = function (tokenId) {
    var inAmt = Object.prototype.hasOwnProperty.call(inTokens, tokenId) ? inTokens[tokenId] : 0n;
    var outAmt = Object.prototype.hasOwnProperty.call(outTokens, tokenId) ? outTokens[tokenId] : 0n;
    var minted = inAmt === 0n && outAmt > 0n && tokenId === firstInputId;
    if (outAmt > inAmt && !minted) tokensConserved = false;
    if (minted) mintedTokens.push({ tokenId: tokenId, amount: outAmt.toString() });
    tokenBalances.push({ tokenId: tokenId, inAmount: inAmt.toString(), outAmount: outAmt.toString(), burnedAmount: (inAmt > outAmt ? inAmt - outAmt : 0n).toString(), minted: minted });
  };
  for (var a = 0; a < inOrder.length; a++) { seenOut[inOrder[a]] = true; addBalance(inOrder[a]); }
  for (var b = 0; b < tx.tokenTotals.length; b++) { if (!seenOut[tx.tokenTotals[b].tokenId]) addBalance(tx.tokenTotals[b].tokenId); }
  var outputNano = BigInt(tx.totalOutputNano);
  var difference = inputNano - outputNano;
  var differenceErg = (difference < 0n ? "-" : "") + nanoToErg((difference < 0n ? -difference : difference).toString());
  return {
    valid: true, reason: null,
    txId: tx.txId, signed: tx.signed,
    inputCount: tx.inputs.length,
    inputNano: inputNano.toString(), inputErg: nanoToErg(inputNano.toString()),
    outputNano: outputNano.toString(), outputErg: tx.totalOutputErg,
    differenceNano: difference.toString(), differenceErg: differenceErg,
    balanced: difference === 0n,
    feeNano: feeNano.toString(), feeErg: nanoToErg(feeNano.toString()), feeOutputCount: feeOutputCount,
    tokenBalances: tokenBalances, tokensConserved: tokensConserved,
    mintedTokens: mintedTokens,
    dataInputCount: tx.dataInputs.length
  };
}

/* ---------- Token-aware payment planner ---------- */
/* Tool 9 plans an ERG-only payment over box VALUES the user types.
   Real payments often need tokens as well, and tokens live inside
   specific boxes — a value-only plan cannot know which boxes carry
   them. This planner takes the boxes themselves (tool 15's bytes,
   one per line) plus a list of token requirements (token ID + raw
   amount, one per line) and selects deterministically in two
   phases, the way the phases are stated on the page:
     phase 1 (tokens): walk the boxes in listed order, selecting
       any box that holds a token whose remaining need is open,
       until every token need is covered or the boxes run out;
     phase 2 (ERG): walk the still-unselected boxes in listed
       order, selecting until the selected ERG covers payment+fee.
   Everything is exact BigInt over the parsed boxes (it composes
   parseErgoBox rather than re-deriving box maths). The report is
   complete about change: ERG change, each requested token's
   leftover, and any token the selected boxes carry that was never
   requested — unrequested tokens do not vanish when their box is
   spent, they ride into the change box, and a plan that hid them
   would lose them on paper. Two traps are flagged plainly: ERG
   change above zero but below the safe user minimum is dust
   (tool 9's rule), and leftover tokens with an ERG change of
   exactly zero have nothing to carry them — a change output
   holding tokens must itself hold ERG, so that plan needs one
   more input or a smaller payment. Shortfalls are reported per
   token and for ERG, never averaged away. Planning only: it
   fetches nothing, signs nothing and sends nothing. */
function planTokenPayment(boxesText, paymentStr, feeStr, tokensText) {
  var fail = function (reason) {
    return { valid: false, reason: reason, sufficient: null, selectedBoxIds: null, selectedCount: null, boxCount: null, unselectedCount: null, neededNano: null, neededErg: null, selectedNano: null, selectedErg: null, changeNano: null, changeErg: null, changeIsDust: null, ergShortfallNano: null, ergShortfallErg: null, tokens: null, tokensSufficient: null, changeTokens: null, tokenChangeWithoutErg: null };
  };
  var payment = ergToNano(paymentStr);
  var fee = ergToNano(feeStr);
  if (payment === null || fee === null) return fail("Enter the payment and fee as ERG amounts (for example 0.1 and 0.001) — the payment must be above zero and the fee zero or above; token amounts are entered separately, in raw units, below.");
  var payNano = BigInt(payment);
  var feeNano = BigInt(fee);
  if (payNano <= 0n || feeNano < 0n) return fail("The payment must be above zero and the fee zero or above — a plan to pay nothing, or to be paid by the fee, is not a payment plan.");
  var lines = (boxesText == null ? "" : String(boxesText)).split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ""; });
  if (lines.length === 0) return fail("Paste the boxes the payment may spend, one full serialized box per line (the bytes tool 15 reads — explorers link each box from an address's page). Token needs live inside specific boxes, so a plan over values alone cannot say which boxes carry them.");
  if (lines.length > 100) return fail("That is " + lines.length + " lines — this planner takes at most 100 boxes at a time, so a pasted set stays reviewable line by line.");
  var boxes = [];
  var seen = {};
  for (var i = 0; i < lines.length; i++) {
    var parsed = parseErgoBox(lines[i]);
    if (!parsed.valid) return fail("Line " + (i + 1) + " does not parse as a serialized box: " + parsed.reason + " The whole plan is refused rather than made without it — a skipped box could be the one carrying a needed token.");
    if (Object.prototype.hasOwnProperty.call(seen, parsed.boxId)) return fail("Line " + (i + 1) + " is the same box as line " + seen[parsed.boxId] + " (box ID " + parsed.boxId + ") — a box listed twice would be counted twice in the plan, and a box can only be spent once; remove the duplicate line.");
    seen[parsed.boxId] = i + 1;
    boxes.push(parsed);
  }
  var requirements = [];
  var reqSeen = {};
  var tokLines = (tokensText == null ? "" : String(tokensText)).split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ""; });
  if (tokLines.length > 100) return fail("That is " + tokLines.length + " token lines — at most 100 token requirements at a time.");
  for (var r = 0; r < tokLines.length; r++) {
    var parts = tokLines[r].split(/\s+/);
    if (parts.length !== 2 || !/^[0-9a-fA-F]{64}$/.test(parts[0]) || !/^[0-9]+$/.test(parts[1]) || BigInt(parts[1]) <= 0n) return fail("Token line " + (r + 1) + " is not in the form \"<64-hex token ID> <raw amount>\" with a positive whole raw amount — amounts are the raw on-chain integers (tool 6 converts a display amount once you know the token's decimals).");
    var tid = parts[0].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(reqSeen, tid)) return fail("Token line " + (r + 1) + " repeats token " + tid + " — state each token's total raw requirement on one line, so the plan's per-token accounting stays unambiguous.");
    reqSeen[tid] = true;
    requirements.push({ tokenId: tid, required: BigInt(parts[1]) });
  }
  var needed = payNano + feeNano;
  var remaining = requirements.map(function (q) { return q.required; });
  var chosen = boxes.map(function () { return false; });
  var selectedIdx = [];
  var a, b, t;
  for (a = 0; a < boxes.length; a++) {
    var allMet = true;
    for (var m = 0; m < remaining.length; m++) if (remaining[m] > 0n) { allMet = false; break; }
    if (allMet) break;
    var useful = false;
    for (t = 0; t < boxes[a].tokens.length; t++) {
      for (var q2 = 0; q2 < requirements.length; q2++) {
        if (boxes[a].tokens[t].tokenId === requirements[q2].tokenId && remaining[q2] > 0n) useful = true;
      }
    }
    if (useful) {
      chosen[a] = true; selectedIdx.push(a);
      for (t = 0; t < boxes[a].tokens.length; t++) {
        for (var q3 = 0; q3 < requirements.length; q3++) {
          if (boxes[a].tokens[t].tokenId === requirements[q3].tokenId) remaining[q3] -= BigInt(boxes[a].tokens[t].amount);
        }
      }
    }
  }
  var selectedNano = 0n;
  for (a = 0; a < selectedIdx.length; a++) selectedNano += BigInt(boxes[selectedIdx[a]].valueNano);
  for (b = 0; b < boxes.length && selectedNano < needed; b++) {
    if (!chosen[b]) { chosen[b] = true; selectedIdx.push(b); selectedNano += BigInt(boxes[b].valueNano); }
  }
  var selTokens = {};
  var selOrder = [];
  for (a = 0; a < selectedIdx.length; a++) {
    var bx = boxes[selectedIdx[a]];
    for (t = 0; t < bx.tokens.length; t++) {
      var tk = bx.tokens[t];
      if (!Object.prototype.hasOwnProperty.call(selTokens, tk.tokenId)) { selTokens[tk.tokenId] = 0n; selOrder.push(tk.tokenId); }
      selTokens[tk.tokenId] += BigInt(tk.amount);
    }
  }
  var tokenReport = requirements.map(function (q) {
    var got = Object.prototype.hasOwnProperty.call(selTokens, q.tokenId) ? selTokens[q.tokenId] : 0n;
    return {
      tokenId: q.tokenId, required: q.required.toString(), selected: got.toString(),
      change: (got > q.required ? got - q.required : 0n).toString(),
      shortfall: (got < q.required ? q.required - got : 0n).toString()
    };
  });
  var tokensSufficient = tokenReport.every(function (tr) { return tr.shortfall === "0"; });
  var changeTokens = [];
  for (a = 0; a < selOrder.length; a++) {
    if (!Object.prototype.hasOwnProperty.call(reqSeen, selOrder[a])) changeTokens.push({ tokenId: selOrder[a], amount: selTokens[selOrder[a]].toString() });
  }
  var change = selectedNano - needed;
  var ergShortfall = change < 0n ? -change : 0n;
  var changeClamped = change > 0n ? change : 0n;
  var anyTokenChange = changeTokens.length > 0 || tokenReport.some(function (tr) { return tr.change !== "0"; });
  return {
    valid: true, reason: null,
    sufficient: ergShortfall === 0n && tokensSufficient,
    selectedBoxIds: selectedIdx.map(function (ix) { return boxes[ix].boxId; }),
    selectedCount: selectedIdx.length, boxCount: boxes.length,
    unselectedCount: boxes.length - selectedIdx.length,
    neededNano: needed.toString(), neededErg: nanoToErg(needed.toString()),
    selectedNano: selectedNano.toString(), selectedErg: nanoToErg(selectedNano.toString()),
    changeNano: changeClamped.toString(), changeErg: nanoToErg(changeClamped.toString()),
    changeIsDust: change > 0n && change < SAFE_USER_MIN_BOX_NANO,
    ergShortfallNano: ergShortfall.toString(), ergShortfallErg: nanoToErg(ergShortfall.toString()),
    tokens: tokenReport, tokensSufficient: tokensSufficient,
    changeTokens: changeTokens,
    tokenChangeWithoutErg: ergShortfall === 0n && tokensSufficient && change === 0n && anyTokenChange
  };
}

/* ---------- Transaction output auditor ---------- */
/* A pre-sign audit of a transaction's OUTPUT side alone. Tool 34
   needs the input boxes pasted alongside the transaction, because a
   transaction's bytes never carry its input values; but a wallet,
   a reviewer or a counterparty often holds only the transaction —
   and everything on the output side is fully determined by those
   bytes, so it can be audited exactly, with no pasted boxes and no
   chain lookup. Per output: its standalone serialized size (the
   parser now reports it — the embedded form with its token
   indexes swapped for the full 32-byte token IDs, plus the
   creating transaction ID and the VLQ output index that complete
   a box's standalone serialization), the protocol minimum value
   for that size at
   360 nanoERG per byte (tool 5's figure) and the shortfall when an
   output sits below it — a below-minimum output can never be
   created on-chain, so spotting one before signing is the point.
   Fee outputs are the ones guarded by the miner fee contract
   (tool 34's definition) and are summed as the fee the outputs
   themselves pay; a transaction with no fee-contract output is
   flagged plainly — nothing in its outputs pays a miner, whatever
   its inputs hold. A token whose ID equals the first input's box
   ID is a mint (the protocol fixes a new token's ID that way —
   tools 34/37), reported with its amount and output. Differing
   creation heights across outputs are reported as a fact, not an
   error. What this audit can NOT see is stated in its own copy:
   whether inputs cover the outputs — that is tool 34, with the
   input boxes. Verified against an independent Python oracle
   (oracle-txaudit.py) over fleet's register-free vectors plus a
   from-scratch synthetic mint-and-dust transaction. */
function auditTxOutputs(txHex) {
  var fail = function (reason) {
    return { valid: false, reason: reason, txId: null, signed: null, byteLength: null, inputCount: null, dataInputCount: null, outputCount: null, totalOutputNano: null, totalOutputErg: null, tokenTotals: null, feeNano: null, feeErg: null, feeOutputIndexes: null, hasFeeOutput: null, outputs: null, mints: null, heightsDiffer: null, allMeetMinimum: null, belowMinimum: null };
  };
  var tx = parseErgoTransaction(txHex);
  if (!tx.valid) return fail(tx.reason);
  var mintId = tx.inputs.length ? tx.inputs[0].boxId : null;
  var fee = 0n;
  var feeIdx = [];
  var mints = [];
  var below = [];
  var heights = {};
  var outs = tx.outputs.map(function (o) {
    var minStr = minBoxValueNano(String(o.byteLength));
    var min = BigInt(minStr);
    var value = BigInt(o.valueNano);
    var isFee = o.ergoTree === FEE_CONTRACT_HEX;
    if (isFee) { fee += value; feeIdx.push(o.index); }
    heights[o.creationHeight] = true;
    var outMints = [];
    o.tokens.forEach(function (t) {
      if (mintId && t.tokenId === mintId) {
        var m = { tokenId: t.tokenId, amount: t.amount, outputIndex: o.index };
        mints.push(m); outMints.push(m);
      }
    });
    var meets = value >= min;
    if (!meets) below.push({ index: o.index, shortfallNano: (min - value).toString() });
    return {
      index: o.index, boxId: o.boxId, byteLength: o.byteLength,
      valueNano: o.valueNano, valueErg: o.valueErg,
      minNano: minStr, minErg: nanoToErg(minStr), meetsMinimum: meets,
      shortfallNano: meets ? "0" : (min - value).toString(),
      isFee: isFee, creationHeight: o.creationHeight,
      tokenCount: o.tokens.length, registerCount: o.registers.length,
      mints: outMints
    };
  });
  return {
    valid: true, reason: null,
    txId: tx.txId, signed: tx.signed, byteLength: tx.byteLength,
    inputCount: tx.inputs.length, dataInputCount: tx.dataInputs.length,
    outputCount: tx.outputs.length,
    totalOutputNano: tx.totalOutputNano, totalOutputErg: tx.totalOutputErg,
    tokenTotals: tx.tokenTotals,
    feeNano: fee.toString(), feeErg: nanoToErg(fee.toString()),
    feeOutputIndexes: feeIdx, hasFeeOutput: feeIdx.length > 0,
    outputs: outs, mints: mints,
    heightsDiffer: Object.keys(heights).length > 1,
    allMeetMinimum: below.length === 0, belowMinimum: below
  };
}

/* ---------- Transaction input auditor ---------- */
/* The input-side counterpart to tool 38's output audit, again from
   the transaction's bytes alone. What those bytes determine about
   the spending side, reported exactly: per input, whether a
   spending proof is present and its length in bytes, and the
   input's context extension entries decoded (key, type, value —
   the constants a script may read while it is being spent).
   Three structural faults are flagged plainly, because each one
   is visible in the bytes and each one matters before signing:
   the same box listed as a spent input twice (a box can be spent
   only once, so such a transaction can never be accepted);
   a context extension that repeats a key on one input (one key
   holds one constant — a second entry under the same key makes
   what the script reads ambiguous, and tool 30's builder refuses
   to assemble one); and the data-input list — boxes the scripts
   read but do not spend — repeating a box, or naming a box the
   transaction also spends (reported as facts: the overlap is
   visible in the bytes whether or not it was intended).
   The honesty boundary is stated in the tool's own copy and kept
   in its fields: a proof being PRESENT is all the bytes show —
   whether a proof is VALID is a question about the spent box's
   script and the Sigma protocol, which no byte count answers,
   and what the inputs are worth is in the input boxes, not the
   transaction (tool 34 checks fee and balance with them).
   Verified against an independent Python oracle
   (oracle-txinput.py): from-scratch input-side parsing of fleet
   vectors TX_V2 / TX_V4 / TX_SYNTH — its tx IDs reproduced the
   recorded ones exactly after a real oracle bug (it hashed the
   bytes after the data inputs instead of after the inputs) was
   caught by the disagreement — plus two from-scratch synthetic
   transactions carrying a duplicated spend, overlapping and
   duplicated data inputs, and a duplicated extension key. */
function auditTxInputs(txHex) {
  var fail = function (reason) {
    return { valid: false, reason: reason, txId: null, signed: null, byteLength: null, inputCount: null, distinctInputCount: null, signedInputCount: null, unsignedInputCount: null, totalProofBytes: null, extensionEntryCount: null, inputs: null, duplicateInputs: null, dataInputCount: null, dataInputs: null, duplicateDataInputs: null, dataInputsAlsoSpent: null, outputCount: null };
  };
  var tx = parseErgoTransaction(txHex);
  if (!tx.valid) return fail(tx.reason);
  var firstSeen = {};
  var duplicateInputs = [];
  var dupById = {};
  var inputs = tx.inputs.map(function (inp, i) {
    if (Object.prototype.hasOwnProperty.call(firstSeen, inp.boxId)) {
      if (!dupById[inp.boxId]) { dupById[inp.boxId] = { boxId: inp.boxId, indexes: [firstSeen[inp.boxId]] }; duplicateInputs.push(dupById[inp.boxId]); }
      dupById[inp.boxId].indexes.push(i);
    } else firstSeen[inp.boxId] = i;
    var keyCount = {};
    inp.extension.forEach(function (e) { keyCount[e.key] = (keyCount[e.key] || 0) + 1; });
    var dupKeys = Object.keys(keyCount).filter(function (k) { return keyCount[k] > 1; }).map(Number).sort(function (a, b) { return a - b; });
    return {
      index: i, boxId: inp.boxId, proofLength: inp.proofLength,
      proofBytes: inp.proofBytes, hasProof: inp.proofLength > 0,
      extension: inp.extension, duplicateExtensionKeys: dupKeys
    };
  });
  var diFirst = {};
  var duplicateDataInputs = [];
  var diDupById = {};
  tx.dataInputs.forEach(function (id, i) {
    if (Object.prototype.hasOwnProperty.call(diFirst, id)) {
      if (!diDupById[id]) { diDupById[id] = { boxId: id, indexes: [diFirst[id]] }; duplicateDataInputs.push(diDupById[id]); }
      diDupById[id].indexes.push(i);
    } else diFirst[id] = i;
  });
  var alsoSpent = [];
  var alsoSeen = {};
  tx.dataInputs.forEach(function (id) {
    if (Object.prototype.hasOwnProperty.call(firstSeen, id) && !alsoSeen[id]) { alsoSeen[id] = true; alsoSpent.push(id); }
  });
  var signedCount = inputs.filter(function (i) { return i.hasProof; }).length;
  return {
    valid: true, reason: null,
    txId: tx.txId, signed: signedCount > 0, byteLength: tx.byteLength,
    inputCount: inputs.length,
    distinctInputCount: Object.keys(firstSeen).length,
    signedInputCount: signedCount,
    unsignedInputCount: inputs.length - signedCount,
    totalProofBytes: inputs.reduce(function (s, i) { return s + i.proofLength; }, 0),
    extensionEntryCount: inputs.reduce(function (s, i) { return s + i.extension.length; }, 0),
    inputs: inputs, duplicateInputs: duplicateInputs,
    dataInputCount: tx.dataInputs.length, dataInputs: tx.dataInputs,
    duplicateDataInputs: duplicateDataInputs,
    dataInputsAlsoSpent: alsoSpent,
    outputCount: tx.outputs.length
  };
}

/* ---------- Signing round-trip checker ---------- */
/* Tools 38 and 39 audit one transaction. This compares TWO
   serializations of what is supposed to be the same transaction:
   the one a dApp or builder showed you before signing, and the
   one a wallet hands back after signing. Signing may change
   exactly one thing — the spending proofs. Everything else is
   pinned by the transaction ID, which is computed over the
   unsigned form (proof lengths zeroed, context extensions and
   every later byte verbatim — tool 29's parser computes it), so
   equal IDs prove the spent boxes, extensions, data inputs,
   token list and outputs are byte-identical outside the proofs,
   and different IDs mean something besides proofs moved. The
   report still diffs section by section (inputs, data inputs,
   outputs) and proof by proof (added / removed / changed), so
   when the IDs differ it says WHERE, and when they match it
   lists exactly which inputs gained proofs. A proof that was
   present before and is gone afterwards is flagged even though
   the ID cannot see it. Outputs are diffed as written, never
   by box ID — a box ID embeds the transaction ID, so diffing
   by it would report every output as changed whenever the ID
   moved for an unrelated reason (caught by the oracle pairs
   below before this shipped). The honesty boundary: this compares
   bytes — whether a changed transaction is legitimate, or a
   present proof valid, is not a question bytes alone answer.
   Verified against an independent Python oracle
   (oracle-txsign.py): from-scratch parsing of both sides over
   fleet vectors TX_V2 / TX_V4 (its tx IDs reproduced the
   recorded ones exactly) plus from-scratch synthetic pairs —
   signing-only, proof removed, proof changed, an output value
   moved by one nanoERG, an extension constant changed, and a
   data input added. */
function compareTxSigning(beforeHex, afterHex) {
  var fail = function (reason) {
    return { valid: false, reason: reason, verdict: null, txIdBefore: null, txIdAfter: null, sameTxId: null, identicalBytes: null, byteLengthBefore: null, byteLengthAfter: null, signedBefore: null, signedAfter: null, inputCountBefore: null, inputCountAfter: null, inputs: null, inputsSame: null, proofsAdded: null, proofsRemoved: null, proofsChanged: null, totalProofBytesBefore: null, totalProofBytesAfter: null, dataInputsBefore: null, dataInputsAfter: null, dataInputsSame: null, outputsSame: null, outputCountBefore: null, outputCountAfter: null, totalOutputNanoBefore: null, totalOutputNanoAfter: null, changedSections: null };
  };
  var before = parseErgoTransaction(beforeHex);
  if (!before.valid) return fail("The BEFORE transaction does not parse: " + before.reason);
  var after = parseErgoTransaction(afterHex);
  if (!after.valid) return fail("The AFTER transaction does not parse: " + after.reason);
  var bBytes = hexToBytes(beforeHex == null ? "" : String(beforeHex).replace(/\s+/g, ""));
  var aBytes = hexToBytes(afterHex == null ? "" : String(afterHex).replace(/\s+/g, ""));
  var identicalBytes = !!(bBytes && aBytes && bBytes.length === aBytes.length && bBytes.every(function (x, i) { return x === aBytes[i]; }));
  var n = Math.max(before.inputs.length, after.inputs.length);
  var inputs = [];
  var proofsAdded = [], proofsRemoved = [], proofsChanged = [];
  for (var i = 0; i < n; i++) {
    var ib = before.inputs[i] || null;
    var ia = after.inputs[i] || null;
    var pb = ib ? ib.proofBytes : null;
    var pa = ia ? ia.proofBytes : null;
    var pc;
    if (pb === pa) pc = "unchanged";
    else if (pb === null && pa !== null) pc = "added";
    else if (pb !== null && pa === null) pc = "removed";
    else pc = "changed";
    if (pc === "added") proofsAdded.push(i);
    if (pc === "removed") proofsRemoved.push(i);
    if (pc === "changed") proofsChanged.push(i);
    inputs.push({
      index: i,
      boxIdBefore: ib ? ib.boxId : null,
      boxIdAfter: ia ? ia.boxId : null,
      sameBox: !!(ib && ia && ib.boxId === ia.boxId),
      extensionSame: !!(ib && ia && JSON.stringify(ib.extension) === JSON.stringify(ia.extension)),
      proofLengthBefore: ib ? ib.proofLength : null,
      proofLengthAfter: ia ? ia.proofLength : null,
      proofChange: pc
    });
  }
  var inputsSame = before.inputs.length === after.inputs.length && inputs.every(function (x) { return x.sameBox && x.extensionSame; });
  var dataInputsSame = JSON.stringify(before.dataInputs) === JSON.stringify(after.dataInputs);
  /* Outputs are compared as WRITTEN (value, tree, height, tokens,
     registers) plus the token ID list — not by their parsed form,
     whose boxId field embeds the transaction ID itself, so any
     ID change would make identical outputs look different. */
  var writtenOutputs = function (tx) {
    return [tx.tokenIds, tx.outputs.map(function (o) {
      return { valueNano: o.valueNano, ergoTree: o.ergoTree, creationHeight: o.creationHeight, tokens: o.tokens, registers: o.registers };
    })];
  };
  var outputsSame = JSON.stringify(writtenOutputs(before)) === JSON.stringify(writtenOutputs(after));
  var changedSections = [];
  if (!inputsSame) changedSections.push("inputs");
  if (!dataInputsSame) changedSections.push("dataInputs");
  if (!outputsSame) changedSections.push("outputs");
  var sameTxId = before.txId === after.txId;
  return {
    valid: true, reason: null,
    verdict: identicalBytes ? "identical" : (sameTxId ? "signing-only" : "changed"),
    txIdBefore: before.txId, txIdAfter: after.txId, sameTxId: sameTxId,
    identicalBytes: identicalBytes,
    byteLengthBefore: before.byteLength, byteLengthAfter: after.byteLength,
    signedBefore: before.signed, signedAfter: after.signed,
    inputCountBefore: before.inputs.length, inputCountAfter: after.inputs.length,
    inputs: inputs, inputsSame: inputsSame,
    proofsAdded: proofsAdded, proofsRemoved: proofsRemoved, proofsChanged: proofsChanged,
    totalProofBytesBefore: before.inputs.reduce(function (s, x) { return s + x.proofLength; }, 0),
    totalProofBytesAfter: after.inputs.reduce(function (s, x) { return s + x.proofLength; }, 0),
    dataInputsBefore: before.dataInputs, dataInputsAfter: after.dataInputs, dataInputsSame: dataInputsSame,
    outputsSame: outputsSame,
    outputCountBefore: before.outputs.length, outputCountAfter: after.outputs.length,
    totalOutputNanoBefore: before.totalOutputNano, totalOutputNanoAfter: after.totalOutputNano,
    changedSections: changedSections
  };
}

/* Tools 15 and 17 read and build ONE box; tool 33 totals a set.
   This compares TWO serialized boxes field by field and says
   exactly what moved: value (with the signed nanoERG delta),
   ErgoTree, creation height (with the signed block delta), tokens
   (added / removed / amount-changed, per token ID), registers
   R4–R9 (added / removed / changed, compared by their raw
   constant bytes and reported with type and decoded value), and
   provenance — the creating transaction ID and output index,
   which together say whether the two boxes even claim the same
   origin. The box ID is deliberately NOT a diffed field: it is
   the Blake2b-256 of the whole serialization (tool 14), so any
   field change produces a different ID — diffing by it would
   report "everything changed" whenever anything did (the same
   trap tool 40 avoids for transaction outputs). Byte length is
   reported as a fact, not a field: it follows from the fields.
   The honesty boundary: this compares bytes — whether the
   second box is the "right" version of the first is not a
   question bytes alone answer. Verified against an independent
   Python oracle (oracle-boxdiff.py): a from-scratch box reader
   over fleet vectors BOX1 / BOX2 / BOX3 (its box IDs asserted
   against the recorded ones) plus a from-scratch writer that
   rebuilds BOX1 and the register-bearing SYNTH_A byte-for-byte
   and assembles the one-field variants — value, token amount,
   height, index, register added / changed / removed. */
function compareErgoBoxes(aHex, bHex) {
  var fail = function (reason) {
    return { valid: false, reason: reason, verdict: null, boxIdA: null, boxIdB: null, sameBoxId: null, identicalBytes: null, byteLengthA: null, byteLengthB: null, byteLengthDelta: null, valueNanoA: null, valueNanoB: null, valueDeltaNano: null, valueSame: null, ergoTreeA: null, ergoTreeB: null, ergoTreeSame: null, creationHeightA: null, creationHeightB: null, heightDelta: null, heightSame: null, tokens: null, tokensSame: null, tokensAdded: null, tokensRemoved: null, tokensChanged: null, registers: null, registersSame: null, registersAdded: null, registersRemoved: null, registersChanged: null, transactionIdA: null, transactionIdB: null, transactionIdSame: null, indexA: null, indexB: null, indexSame: null, sameProvenance: null, changedFields: null };
  };
  var a = parseErgoBox(aHex);
  if (!a.valid) return fail("The FIRST box does not parse: " + a.reason);
  var b = parseErgoBox(bHex);
  if (!b.valid) return fail("The SECOND box does not parse: " + b.reason);
  var aBytes = hexToBytes(aHex == null ? "" : String(aHex).replace(/\s+/g, ""));
  var bBytes = hexToBytes(bHex == null ? "" : String(bHex).replace(/\s+/g, ""));
  var identicalBytes = !!(aBytes && bBytes && aBytes.length === bBytes.length && aBytes.every(function (x, i) { return x === bBytes[i]; }));
  var changedFields = [];
  var valueSame = a.valueNano === b.valueNano;
  if (!valueSame) changedFields.push("value");
  var ergoTreeSame = a.ergoTree === b.ergoTree;
  if (!ergoTreeSame) changedFields.push("ergoTree");
  var heightSame = a.creationHeight === b.creationHeight;
  if (!heightSame) changedFields.push("creationHeight");
  /* tokens, unioned in A's order then B-only tokens in B's order */
  var aTok = {}, bTok = {};
  a.tokens.forEach(function (t) { aTok[t.tokenId] = t.amount; });
  b.tokens.forEach(function (t) { bTok[t.tokenId] = t.amount; });
  var tokOrder = a.tokens.map(function (t) { return t.tokenId; });
  b.tokens.forEach(function (t) { if (!(t.tokenId in aTok)) tokOrder.push(t.tokenId); });
  var tokens = [], tokensAdded = [], tokensRemoved = [], tokensChanged = [];
  tokOrder.forEach(function (tid) {
    var aa = tid in aTok ? aTok[tid] : null;
    var bb = tid in bTok ? bTok[tid] : null;
    var ch;
    if (aa === null) { ch = "added"; tokensAdded.push(tid); }
    else if (bb === null) { ch = "removed"; tokensRemoved.push(tid); }
    else if (aa !== bb) { ch = "changed"; tokensChanged.push(tid); }
    else ch = "unchanged";
    tokens.push({ tokenId: tid, amountA: aa, amountB: bb, change: ch });
  });
  var tokensSame = tokensAdded.length === 0 && tokensRemoved.length === 0 && tokensChanged.length === 0;
  if (!tokensSame) changedFields.push("tokens");
  /* registers, unioned in R4–R9 order, compared by raw constant */
  var aReg = {}, bReg = {};
  a.registers.forEach(function (r) { aReg[r.name] = r; });
  b.registers.forEach(function (r) { bReg[r.name] = r; });
  var regNames = ["R4", "R5", "R6", "R7", "R8", "R9"].filter(function (n) { return n in aReg || n in bReg; });
  var registers = [], registersAdded = [], registersRemoved = [], registersChanged = [];
  regNames.forEach(function (n) {
    var ra = n in aReg ? aReg[n] : null;
    var rb = n in bReg ? bReg[n] : null;
    var ch;
    if (ra === null) { ch = "added"; registersAdded.push(n); }
    else if (rb === null) { ch = "removed"; registersRemoved.push(n); }
    else if (ra.rawHex !== rb.rawHex) { ch = "changed"; registersChanged.push(n); }
    else ch = "unchanged";
    registers.push({
      name: n,
      typeA: ra ? ra.type : null, typeB: rb ? rb.type : null,
      valueA: ra ? ra.value : null, valueB: rb ? rb.value : null,
      rawHexA: ra ? ra.rawHex : null, rawHexB: rb ? rb.rawHex : null,
      change: ch
    });
  });
  var registersSame = registersAdded.length === 0 && registersRemoved.length === 0 && registersChanged.length === 0;
  if (!registersSame) changedFields.push("registers");
  var transactionIdSame = a.transactionId === b.transactionId;
  if (!transactionIdSame) changedFields.push("transactionId");
  var indexSame = a.index === b.index;
  if (!indexSame) changedFields.push("index");
  return {
    valid: true, reason: null,
    verdict: identicalBytes ? "identical" : "changed",
    boxIdA: a.boxId, boxIdB: b.boxId, sameBoxId: a.boxId === b.boxId,
    identicalBytes: identicalBytes,
    byteLengthA: a.byteLength, byteLengthB: b.byteLength,
    byteLengthDelta: b.byteLength - a.byteLength,
    valueNanoA: a.valueNano, valueNanoB: b.valueNano,
    valueDeltaNano: (BigInt(b.valueNano) - BigInt(a.valueNano)).toString(),
    valueSame: valueSame,
    ergoTreeA: a.ergoTree, ergoTreeB: b.ergoTree, ergoTreeSame: ergoTreeSame,
    creationHeightA: a.creationHeight, creationHeightB: b.creationHeight,
    heightDelta: b.creationHeight - a.creationHeight, heightSame: heightSame,
    tokens: tokens, tokensSame: tokensSame,
    tokensAdded: tokensAdded, tokensRemoved: tokensRemoved, tokensChanged: tokensChanged,
    registers: registers, registersSame: registersSame,
    registersAdded: registersAdded, registersRemoved: registersRemoved, registersChanged: registersChanged,
    transactionIdA: a.transactionId, transactionIdB: b.transactionId, transactionIdSame: transactionIdSame,
    indexA: a.index, indexB: b.index, indexSame: indexSame,
    sameProvenance: transactionIdSame && indexSame,
    changedFields: changedFields
  };
}

/* ---------- Transaction JSON converter ---------- */
/* The same unsigned transaction in the two forms Ergo developers
   actually move between: the EIP-12 / fleet-sdk JSON dialect (what
   dApps, wallets and fleet's builders exchange) and the serialized
   bytes tools 29/30 work in. The dialect, stated exactly: top level
   {id?, inputs, dataInputs?, outputs}; an input is {boxId,
   extension?} where extension maps a numeric-string key to one
   Sigma constant in hex, exactly as a register is written; a data
   input is {boxId}; an output is {value, ergoTree, creationHeight,
   assets?, additionalRegisters?} with value and asset amounts as
   decimal strings (JSON numbers are accepted only when they are
   safe integers, and are re-emitted as strings — a float or an
   unsafe integer is refused rather than rounded), and
   additionalRegisters maps R4–R9 to constant hex, positionally,
   with no gaps. The form is UNSIGNED by definition: it has no
   place for spending proofs, so a signed transaction is refused in
   both directions instead of having its proofs silently dropped —
   tool 29 shows a signed transaction's full contents, and tool 30
   builds signed bytes from pasted proofs. JSON -> bytes is
   assembled by tool 30's builder, which round-trips its own output
   through tool 29's parser before anything is shown; an "id" the
   pasted JSON carries is checked against the computed transaction
   ID and a mismatch is reported, never hidden. Bytes -> JSON is
   tool 29's parse re-emitted in the dialect. Verified in the tests
   against an independent Python build (oracle-txjson.py) whose
   box IDs were asserted against the fleet-recorded ones before its
   output was trusted. Conversion is just a change of notation:
   nothing here signs, broadcasts or spends anything. */
function convertTxJson(direction, text) {
  var fail = function (reason) {
    return { valid: false, reason: reason, direction: direction, txHex: null, json: null, txId: null, byteLength: null, inputCount: null, dataInputCount: null, outputCount: null, totalOutputNano: null, totalOutputErg: null, tokenIds: null, idMismatch: false, claimedId: null };
  };
  if (direction !== "json-to-bytes" && direction !== "bytes-to-json") return fail("Pick a direction: JSON to bytes, or bytes to JSON.");
  var raw = text == null ? "" : String(text).trim();
  if (raw === "") return fail(direction === "json-to-bytes" ? "Paste one unsigned transaction in the EIP-12 / fleet JSON form (a single JSON object with inputs and outputs)." : "Paste one unsigned transaction's serialized bytes as hex (tools 29 and 30 work in the same bytes).");
  if (direction === "bytes-to-json") {
    var parsed = parseErgoTransaction(raw);
    if (!parsed.valid) return fail("These bytes do not parse as a transaction (tool 29's reader): " + parsed.reason);
    if (parsed.signed) {
      var proofAt = 0;
      parsed.inputs.forEach(function (inp, ix) { if (proofAt === 0 && inp.proofLength > 0) proofAt = ix + 1; });
      return fail("This transaction is signed — input " + proofAt + " carries a spending proof — and the EIP-12 / fleet JSON form is an unsigned form with no place for proofs. Dropping them silently would produce JSON that describes a different, unsigned transaction, so the conversion is refused: tool 29 shows the signed bytes' full contents, and tool 30 rebuilds signed bytes from pasted proofs.");
    }
    var jInputs = parsed.inputs.map(function (inp) {
      var o = { boxId: inp.boxId };
      if (inp.extension.length > 0) {
        var ext = {};
        inp.extension.forEach(function (e) { ext[String(e.key)] = e.rawHex; });
        o.extension = ext;
      }
      return o;
    });
    var jObj = { id: parsed.txId, inputs: jInputs };
    if (parsed.dataInputs.length > 0) jObj.dataInputs = parsed.dataInputs.map(function (id) { return { boxId: id }; });
    jObj.outputs = parsed.outputs.map(function (op) {
      var o = { value: op.valueNano, ergoTree: op.ergoTree, creationHeight: op.creationHeight };
      if (op.tokens.length > 0) o.assets = op.tokens.map(function (tk) { return { tokenId: tk.tokenId, amount: tk.amount }; });
      if (op.registers.length > 0) {
        var regs = {};
        op.registers.forEach(function (rg) { regs[rg.name] = rg.rawHex; });
        o.additionalRegisters = regs;
      }
      return o;
    });
    return {
      valid: true, reason: null, direction: direction,
      txHex: null, json: JSON.stringify(jObj, null, 2), txId: parsed.txId,
      byteLength: parsed.byteLength, inputCount: parsed.inputs.length,
      dataInputCount: parsed.dataInputs.length, outputCount: parsed.outputs.length,
      totalOutputNano: parsed.totalOutputNano, totalOutputErg: parsed.totalOutputErg,
      tokenIds: parsed.tokenIds, idMismatch: false, claimedId: null
    };
  }
  /* --- json-to-bytes --- */
  var doc;
  try { doc = JSON.parse(raw); } catch (err) { return fail("That is not valid JSON (" + err.message + ") — paste a single JSON object, exactly as a wallet, fleet-sdk or a dApp connector emits it."); }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return fail("The JSON must be a single object with \"inputs\" and \"outputs\" — an array or a bare value is not a transaction in this dialect.");
  var amountStr = function (x, what) {
    if (typeof x === "string" && /^\d+$/.test(x.trim())) return x.trim();
    if (typeof x === "number" && Number.isSafeInteger(x) && x >= 0) return String(x);
    return null;
  };
  if (!Array.isArray(doc.inputs)) return fail("The JSON carries no \"inputs\" list — the dialect is {inputs: [{boxId, extension?}], dataInputs?, outputs: [...]}.");
  var inFields = [];
  for (var i = 0; i < doc.inputs.length; i++) {
    var jin = doc.inputs[i] || {};
    var iWhat = "Input " + (i + 1);
    if (typeof jin !== "object" || Array.isArray(jin)) return fail(iWhat + " is not an object — each input is {boxId, extension?}.");
    if (jin.proofBytes != null && String(jin.proofBytes) !== "") return fail(iWhat + " carries proofBytes — this dialect is the unsigned form, which has no place for spending proofs, so a signed JSON transaction is refused rather than have its proofs dropped silently. Tool 30 builds signed bytes from pasted proofs.");
    if (jin.spendingProof != null) return fail(iWhat + " carries a spendingProof — this dialect is the unsigned EIP-12 / fleet form, which has no place for proofs, so the transaction is refused rather than have its proofs dropped silently. Tool 30 builds signed bytes from pasted proofs.");
    if (typeof jin.boxId !== "string" || !/^[0-9a-fA-F]{64}$/.test(jin.boxId.trim())) return fail(iWhat + ": a box ID is 64 hex characters — got \"" + jin.boxId + "\".");
    var extList = [];
    if (jin.extension != null) {
      if (typeof jin.extension !== "object" || Array.isArray(jin.extension)) return fail(iWhat + ": \"extension\" maps numeric-string keys to Sigma constants in hex, e.g. {\"0\": \"0e02cafe\"}.");
      var eKeys = Object.keys(jin.extension);
      for (var e = 0; e < eKeys.length; e++) {
        if (!/^\d+$/.test(eKeys[e])) return fail(iWhat + ": extension key \"" + eKeys[e] + "\" is not a number — keys are numeric strings (\"0\", \"1\", …).");
        if (typeof jin.extension[eKeys[e]] !== "string") return fail(iWhat + ", extension key " + eKeys[e] + ": the value is one Sigma constant as a hex string (tool 18 reads them).");
        extList.push({ key: eKeys[e], value: jin.extension[eKeys[e]] });
      }
    }
    inFields.push({ boxId: jin.boxId.trim().toLowerCase(), proofHex: null, extension: extList });
  }
  var diFields = [];
  if (doc.dataInputs != null) {
    if (!Array.isArray(doc.dataInputs)) return fail("\"dataInputs\" is a list of {boxId} objects (boxes the scripts read but do not spend).");
    for (var d = 0; d < doc.dataInputs.length; d++) {
      var jdi = doc.dataInputs[d];
      var diId = typeof jdi === "string" ? jdi : (jdi && typeof jdi === "object" ? jdi.boxId : null);
      if (typeof diId !== "string" || !/^[0-9a-fA-F]{64}$/.test(diId.trim())) return fail("Data input " + (d + 1) + ": a box ID is 64 hex characters — each data input is {boxId: \"…\"}.");
      diFields.push(diId.trim().toLowerCase());
    }
  }
  if (!Array.isArray(doc.outputs)) return fail("The JSON carries no \"outputs\" list — each output is {value, ergoTree, creationHeight, assets?, additionalRegisters?}.");
  var outFields = [];
  for (var o = 0; o < doc.outputs.length; o++) {
    var jout = doc.outputs[o] || {};
    var oWhat = "Output " + (o + 1);
    if (typeof jout !== "object" || Array.isArray(jout)) return fail(oWhat + " is not an object — each output is {value, ergoTree, creationHeight, assets?, additionalRegisters?}.");
    var oVal = amountStr(jout.value, oWhat);
    if (oVal === null) return fail(oWhat + ": \"value\" is the box value in nanoERG as a decimal string (a safe-integer number is also accepted) — got " + JSON.stringify(jout.value) + ", and an amount is never rounded to fit.");
    if (typeof jout.ergoTree !== "string" || !/^(0x)?[0-9a-fA-F]+$/.test(jout.ergoTree.trim()) || jout.ergoTree.replace(/^0x/, "").length % 2 !== 0) return fail(oWhat + ": \"ergoTree\" is the guarding script as hex (an even number of 0-9/a-f characters).");
    var oHeight = amountStr(jout.creationHeight, oWhat);
    if (oHeight === null) return fail(oWhat + ": \"creationHeight\" is a whole block number (a number, or digits as a string).");
    var oTokens = [];
    if (jout.assets != null) {
      if (!Array.isArray(jout.assets)) return fail(oWhat + ": \"assets\" is a list of {tokenId, amount} pairs.");
      for (var t = 0; t < jout.assets.length; t++) {
        var ja = jout.assets[t] || {};
        if (typeof ja.tokenId !== "string" || !/^[0-9a-fA-F]{64}$/.test(ja.tokenId.trim())) return fail(oWhat + ", asset " + (t + 1) + ": a token ID is 64 hex characters.");
        var aAmt = amountStr(ja.amount, oWhat);
        if (aAmt === null) return fail(oWhat + ", asset " + (t + 1) + ": \"amount\" is the raw token amount as a decimal string (a safe-integer number is also accepted) — never rounded to fit.");
        oTokens.push({ tokenId: ja.tokenId.trim().toLowerCase(), amount: aAmt });
      }
    }
    var oRegs = [];
    if (jout.additionalRegisters != null) {
      if (typeof jout.additionalRegisters !== "object" || Array.isArray(jout.additionalRegisters)) return fail(oWhat + ": \"additionalRegisters\" maps register names to Sigma constants in hex, e.g. {\"R4\": \"0e04deadbeef\"}.");
      var rKeys = Object.keys(jout.additionalRegisters);
      for (var r = 0; r < rKeys.length; r++) {
        if (!/^R[4-9]$/.test(rKeys[r])) return fail(oWhat + ": register key \"" + rKeys[r] + "\" is not one of R4–R9 — a box's non-mandatory registers are exactly R4 through R9.");
        var expect = "R" + (4 + r);
        var sorted = rKeys.slice().sort(function (a, b) { return Number(a.slice(1)) - Number(b.slice(1)); });
        if (sorted[r] !== expect) return fail(oWhat + ": registers are positional and must start at R4 with no gaps — got " + sorted.join(", ") + ", so " + expect + " is missing. A register cannot be skipped: R5's bytes would be read as R4.");
        if (typeof jout.additionalRegisters[rKeys[r]] !== "string") return fail(oWhat + ", register " + rKeys[r] + ": the value is one Sigma constant as a hex string (tool 18 reads them).");
      }
      var ordered = rKeys.slice().sort(function (a, b) { return Number(a.slice(1)) - Number(b.slice(1)); });
      oRegs = ordered.map(function (k) { return jout.additionalRegisters[k]; });
    }
    outFields.push({ valueNano: oVal, ergoTree: jout.ergoTree.trim(), creationHeight: oHeight, tokens: oTokens, registers: oRegs });
  }
  var built = buildErgoTransaction({ inputs: inFields, dataInputs: diFields, outputs: outFields });
  if (!built.valid) return fail("The JSON is well-formed, but the transaction it describes does not assemble (tool 30's builder): " + built.reason);
  var claimed = typeof doc.id === "string" ? doc.id.trim().toLowerCase() : null;
  return {
    valid: true, reason: null, direction: direction,
    txHex: built.txHex, json: null, txId: built.txId,
    byteLength: built.byteLength, inputCount: inFields.length,
    dataInputCount: diFields.length, outputCount: outFields.length,
    totalOutputNano: built.totalOutputNano, totalOutputErg: built.totalOutputErg,
    tokenIds: built.tokenIds, idMismatch: claimed !== null && claimed !== built.txId, claimedId: claimed
  };
}

/* --- Tool 37: token mint planner (issuance designer) ---
   A new Ergo token gets its ID from the chain, not from its
   metadata: the token ID is the box ID of the FIRST input of
   the minting transaction (EIP-4; fleet-sdk's builder takes
   inputs[0].boxId as the minting token id, and its mock chain
   enforces the same rule). That is what makes the ID unique —
   a box can be spent only once, so no second mint can ever
   reuse it. Given that first input's box ID plus the token's
   name, description, decimals, optional EIP-4 asset type and
   raw amount, this plans the whole issuance box content: the
   token ID, the EIP-4 registers (composed from tool 27's
   encoder, never re-derived), the display amount (tool 6's
   converter), and the exact field text tools 17 and 30 take —
   the issuance box's token line ("<tokenId> <rawAmount>") and
   its register lines in R4-first order. The registers are
   decoded back through tool 27's decoder before anything is
   shown, and a decoded mismatch stops the plan. Semantics
   verified against an independent Python build
   (oracle-mintplan.py) over the fleet-recorded box IDs before
   any JS. Planning only: it builds no transaction, signs
   nothing and mints nothing — the token exists only once a
   real minting transaction spending that first input confirms,
   and whether that box is still unspent is a chain fact only
   an explorer can tell you. */
function planTokenMint(firstInputId, nameStr, descStr, decStr, amountStr, typeStr) {
  var fail = function (reason) {
    return { valid: false, reason: reason, tokenId: null, name: null, description: null, decimals: null, assetType: null, amountRaw: null, displayAmount: null, registers: null, registerLines: null, boxbuildTokens: null, boxbuildRegisters: null, boxspecRegisters: null };
  };
  var id = (firstInputId == null ? "" : String(firstInputId)).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) return fail("The first input's box ID is 64 hex characters — it becomes the token ID, so it has to be exact. Find it on the box itself (tools 15 and 33 show a box's ID) or as the first input of the minting transaction (tool 29).");
  var regs = buildEip4Registers(nameStr, descStr, decStr, typeStr);
  if (!regs) return fail("The metadata does not encode (tool 27's EIP-4 rules): the name must be non-empty, the decimals a whole number written without a leading zero (0–999), and the asset type one of the listed EIP-4 types.");
  var amt = (amountStr == null ? "" : String(amountStr)).trim();
  if (!/^\d+$/.test(amt)) return fail("The amount is the raw token amount as a whole decimal number — on-chain token amounts are integers; the decimals only shape how the amount is displayed.");
  if (BigInt(amt) === 0n) return fail("The amount is zero — a mint that creates zero tokens creates nothing. Give the raw amount to issue (with " + regs.decimals + " decimals, raw 1 is the smallest displayable step).");
  var registers = { R4: regs.r4Hex };
  if (regs.r5Hex) registers.R5 = regs.r5Hex;
  registers.R6 = regs.r6Hex;
  if (regs.r7Hex) registers.R7 = regs.r7Hex;
  var back = decodeEip4Registers(registers.R4 || "", registers.R5 || "", registers.R6 || "", registers.R7 || "");
  if (!back || back.name !== regs.name || back.description !== (regs.description === "" ? null : regs.description) || back.decimals !== regs.decimals || back.assetType !== regs.assetType) return fail("The EIP-4 registers did not decode back to the metadata they were built from, so nothing is shown.");
  var keys = Object.keys(registers);
  /* Tool 17's box builder takes typed specs, not raw constants —
     every EIP-4 register is a Coll[Byte] constant, which is
     exactly tool 17's bytes:<payload> spec. Tool 30's
     transaction builder takes the raw constant hex instead, so
     the plan carries both forms. */
  var specOf = function (hex) {
    var b = hexToBytes(hex);
    var n = 0, i = 1;
    for (;;) { var byte = b[i]; i++; n = n * 128 + (byte & 0x7f); if (!(byte & 0x80)) break; }
    return "bytes:" + bytesToHex(b.slice(i, i + n));
  };
  return {
    valid: true, reason: null, tokenId: id,
    name: regs.name, description: regs.description, decimals: regs.decimals, assetType: regs.assetType,
    amountRaw: BigInt(amt).toString(), displayAmount: tokenRawToDisplay(amt, regs.decimals),
    registers: registers,
    registerLines: keys.map(function (k) { return k + " " + registers[k]; }),
    boxbuildTokens: id + " " + BigInt(amt).toString(),
    boxbuildRegisters: keys.map(function (k) { return registers[k]; }).join("\n"),
    boxspecRegisters: keys.map(function (k) { return specOf(registers[k]); }).join("\n")
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { blake2b256, base58Decode, base58Encode, p2pkAddressFromPublicKey, checkErgoAddress, ergToNano, nanoToErg, NANO_PER_ERG, ADDRESS_TYPES, storageRentNano, analyzeStorageRent, STORAGE_FEE_FACTOR_NANO_PER_BYTE, STORAGE_PERIOD_BLOCKS, minBoxValueNano, analyzeMinBoxValue, MIN_VALUE_PER_BYTE_NANO, SAFE_USER_MIN_BOX_NANO, BLOCKS_PER_DAY, HASHRATE_UNITS, hashrateToHps, estimateMining, fmtEstimate, TOKEN_MAX_DECIMALS, parseTokenDecimals, tokenRawToDisplay, tokenDisplayToRaw, parseChainHeight, analyzeRentCountdown, parseBoxList, planPayment, hexToBytes, bytesToHex, readVlqSize, addressFromContent, analyzeErgoTree, decodeErgoAddress, buildP2SAddress, convertAddressNetwork, ERGOTREE_SIZE_FLAG, ERGOTREE_SEGREGATION_FLAG, P2SH_HASH_BYTES, parseBabelPrice, analyzeBabelFee, analyzeBoxId, FEE_CONTRACT_HEX, SIGMA_PRIMITIVE_NAMES, readVlqBig, zigzagDecode, zigzagDecode32, sigmaTypeName, parseSigmaType, parseSigmaData, parseErgoBox, writeVlqBig, zigzagEncode, sigmaIntZigzag, bigIntToSigmaBytes, encodeSigmaConstant, buildErgoBox, decodeSigmaConstant, buildP2PKTree, buildP2SHAddress, utf8Bytes, analyzeBlake2b, analyzeBase58, analyzeVlq, analyzeZigZag, analyzeBoxHealth, EMISSION_FIXED_RATE_PERIOD, EMISSION_FIXED_RATE_NANO, EMISSION_EPOCH_LENGTH, EMISSION_ONE_EPOCH_REDUCTION_NANO, EMISSION_TOTAL_NANO, EIP27_ACTIVATION_HEIGHT, EIP27_REEMISSION_START_HEIGHT, emissionAtHeight, foundationRewardAtHeight, minersRewardAtHeight, issuedAfterHeight, analyzeEmission, EIP4_ASSET_TYPES, EIP4_ASSET_LABELS, buildEip4Registers, decodeEip4Registers, ADH_TYPE_CODE, buildAdhRepresentation, decodeAdhRepresentation, parseErgoTransaction, sigmaConstantBytes, buildErgoTransaction, sha512, hmacSha512, secp256k1PublicKey, deriveHdAddresses, HD_COIN_TYPE, inspectPublicKey, summarizeBoxSet, analyzeTxFee, planTokenPayment, convertTxJson, planTokenMint, auditTxOutputs, auditTxInputs, compareTxSigning, compareErgoBoxes };
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

    /* --- box health checker --- */
    document.getElementById("health-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("health-result");
      var res = analyzeBoxHealth(document.getElementById("health-bytes").value, document.getElementById("health-erg").value, document.getElementById("health-created").value, document.getElementById("health-current").value);
      if (res === null) {
        out.textContent = "Enter the box's serialized size in bytes, the ERG it holds, and its creation and current heights as whole numbers, with the current height at or above the creation height — the size and heights are on the box's explorer page.";
        return;
      }
      var msg;
      if (res.verdict === "below-minimum") {
        msg = "⛔ Below the protocol minimum. A box of this size must hold at least " + res.minErg + " ERG (" + res.minNano + " nanoERG); this one is short by " + res.differenceErg + " ERG (" + res.differenceNano + " nanoERG). A transaction creating a box like this would be rejected — if you read these figures off an explorer, re-check the serialized size.";
      } else if (res.verdict === "consumable-now") {
        msg = "⚠ At risk now. This box is " + res.ageBlocks + " blocks old — past its storage-rent eligibility height " + res.eligibilityHeight + " — and holds " + res.valueErg + " ERG, at or below one rent payment of " + res.rentErg + " ERG for its size, so a miner may spend the whole box, ERG and any tokens in it. Spend it into a fresh box to protect it. (It does meet its size minimum of " + res.minErg + " ERG — the risk is the rent, not the minimum.)";
      } else if (res.verdict === "consumable-at-eligibility") {
        msg = "⚠ Funded for now, consumable later. The box holds " + res.valueErg + " ERG — above its size minimum of " + res.minErg + " ERG, but at or below one storage-rent payment of " + res.rentErg + " ERG. It becomes rent-eligible at height " + res.eligibilityHeight + ", " + res.blocksRemaining + " blocks away (roughly " + fmtEstimate(res.approxDaysRemaining) + " days at the 2-minute block target), and from then a miner may spend it whole. Top it up above one rent payment, or plan to move it before then.";
      } else {
        msg = "✅ Funded. The box covers " + res.payments + " full storage-rent payments of " + res.rentErg + " ERG each (roughly " + res.approxYears + " years of rent cycles) before its value would fall to one payment or below, and it clears its size minimum of " + res.minErg + " ERG" + (res.meetsSafeUserMin ? ", plus the 0.001 ERG safe user minimum." : " — though it sits under the 0.001 ERG safe user minimum wallets aim for.");
        if (res.eligible) {
          msg += " It is already past its eligibility height " + res.eligibilityHeight + ", so a miner may deduct one rent payment now, which would leave " + res.valueAfterRentErg + " ERG in the recreated box.";
        } else {
          msg += " It becomes rent-eligible at height " + res.eligibilityHeight + ", " + res.blocksRemaining + " blocks away (roughly " + fmtEstimate(res.approxDaysRemaining) + " days at the 2-minute block target).";
        }
      }
      out.textContent = msg;
    });

    /* --- emission & supply calculator --- */
    document.getElementById("emission-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("emission-result");
      var res = analyzeEmission(document.getElementById("emission-height").value);
      if (res === null) {
        out.textContent = "Enter a block height as a whole number from 1 up — heights are on the explorer's blocks page.";
        return;
      }
      var msg;
      if (res.phase === "reemission") {
        msg = "Block " + res.height + " is past the end of emission: the last new coins were issued at block 2,080,799, and the full maximum of " + res.totalErg + " ERG is in circulation. This block instead pays the miner " + res.reemissionErg + " ERG from the EIP-27 re-emission contract — recycled coins collected during the declining era, not new issuance. The EIP sized that contract to last about 4,566,336 blocks (roughly 17.4 years) from block 2,080,800.";
      } else {
        msg = "Block " + res.height + (res.phase === "fixed" ? " is in the fixed-rate era (blocks below 525,600)" : " is in declining epoch " + res.epoch + " (the rate drops 3 ERG every 64,800 blocks)") + ": it issues " + res.emissionErg + " ERG of new coins";
        if (res.eip27) {
          msg += ". Under EIP-27 (active since block 777,217), " + res.divertedErg + " ERG of that reward is diverted to the re-emission contract instead of the miner, so the miner keeps " + res.minerErg + " ERG and the foundation receives " + res.foundationErg + " ERG.";
        } else {
          msg += " — " + res.minerErg + " ERG to the miner and " + res.foundationErg + " ERG to the foundation.";
        }
        msg += " By the end of this block, " + res.issuedErg + " ERG of the " + res.totalErg + " ERG maximum has been issued (" + fmtEstimate(res.percentIssued) + "%), with " + res.remainingErg + " ERG left to issue.";
      }
      out.textContent = msg;
    });

    /* --- EIP-4 token metadata codec --- */
    document.getElementById("eip4-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("eip4-result");
      var dir = document.getElementById("eip4-direction").value;
      if (dir === "encode") {
        var enc = buildEip4Registers(
          document.getElementById("eip4-name").value,
          document.getElementById("eip4-desc").value,
          document.getElementById("eip4-decimals").value,
          document.getElementById("eip4-type").value);
        if (enc === null) {
          out.textContent = "To encode: give a token name, and decimals as a whole number from 0 to 999 with no leading zeros (EIP-4 writes it as text). The description is optional — leave it empty and R5 is simply omitted.";
          return;
        }
        var emsg = "Your EIP-4 issuance registers — R4 (name): " + enc.r4Hex + " · R5 (description): " + (enc.r5Hex === null ? "omitted (no description given)" : enc.r5Hex) + " · R6 (decimals): " + enc.r6Hex + (enc.r7Hex === null ? " · R7 (asset type): not set" : " · R7 (asset type, " + enc.assetType + "): " + enc.r7Hex) + ".";
        emsg += " Each one is a Coll[Byte] constant — 0e, a VLQ byte-length, then the UTF-8 bytes — and R6 carries the decimals as text (\"" + enc.decimals + "\"), exactly as EIP-4's own worked example does; it is not an Int constant. These registers describe the token in its issuance box; the token's ID is the box ID of that transaction's first input, a chain fact no register contains. Registers only — this builds no transaction and mints nothing.";
        out.textContent = emsg;
        return;
      }
      var dec = decodeEip4Registers(
        document.getElementById("eip4-r4").value,
        document.getElementById("eip4-r5").value,
        document.getElementById("eip4-r6").value,
        document.getElementById("eip4-r7").value);
      if (dec === null) {
        out.textContent = "To decode: paste at least one register's hex exactly as an explorer or node API shows it (R4, R5 and R7 are Coll[Byte] constants starting 0e; R6 is either that or an Int constant starting 04). A register that does not parse is refused rather than guessed at — leave the ones you don't have empty.";
        return;
      }
      var parts = [];
      if (dec.name !== null) parts.push("R4 name: \"" + dec.name + "\"" + (dec.nameValidUtf8 ? "" : " (the bytes are not clean UTF-8, so treat this reading with care)"));
      if (dec.description !== null) parts.push("R5 description: \"" + dec.description + "\"" + (dec.descriptionValidUtf8 ? "" : " (the bytes are not clean UTF-8, so treat this reading with care)"));
      if (dec.decimals !== null) parts.push("R6 decimals: " + dec.decimals + (dec.decimalsForm === "int" ? " (carried as an Int constant — a form some tokens use in the wild; EIP-4's own form is the text string)" : " (carried as text, EIP-4's own form)"));
      if (dec.assetType !== null) parts.push("R7 asset type: " + dec.assetType + " (category " + dec.assetCategory + (dec.assetSubcategory !== null ? ", subcategory " + dec.assetSubcategory : ", no subcategory") + ")");
      out.textContent = "Decoded — " + parts.join(" · ") + ". Registers read locally; nothing was fetched or verified against the chain, so check the token ID on the explorer for the full picture.";
    });

    /* --- EIP-44 ADH codec --- */
    document.getElementById("adh-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("adh-result");
      var dir = document.getElementById("adh-direction").value;
      if (dir === "encode") {
        var enc = buildAdhRepresentation(
          document.getElementById("adh-data").value,
          document.getElementById("adh-mode").value,
          document.getElementById("adh-network").value);
        if (enc === null) {
          out.textContent = "To encode: enter the data — any text, or hex bytes in hex mode (an even number of hex digits). Empty data has nothing to stamp, so it is refused rather than hashed.";
          return;
        }
        out.textContent = "Your " + enc.network + " ADH representation: " + enc.representation + " — head byte 0x" + enc.prefix.toString(16) + " (network + type 4), then the Blake2b-256 hash of your " + enc.byteLength + "-byte data: " + enc.dataHash + ", then the 4-byte checksum. A wallet following EIP-44 would sign these bytes: " + enc.signedBytesHex + " (00 invalidator + network byte + hash). Remember: this is a proposed standard's data representation, not a payment address — never send ERG to it, and the data itself cannot be recovered from the hash.";
        return;
      }
      var dec = decodeAdhRepresentation(document.getElementById("adh-rep").value);
      if (dec === null) {
        out.textContent = "To decode: paste one complete ADH representation exactly as written — Base58, 37 decoded bytes (head byte + 32-byte hash + 4-byte checksum), head type 4 with a valid checksum. Payment addresses (types 1-3), truncated strings and tampered checksums are refused rather than guessed at.";
        return;
      }
      out.textContent = "Decoded — " + dec.network + " ADH (type 4) carrying data hash " + dec.dataHash + ". The bytes a wallet would sign for this data are " + dec.signedBytesHex + " (00 invalidator + network byte + hash). The hash is one-way: the original data cannot be recovered from this string, only re-hashed and compared. And it is not a payment address — never send ERG to it.";
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

    document.getElementById("b58-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("b58-result");
      var res = analyzeBase58(document.getElementById("b58-input").value, document.getElementById("b58-direction").value);
      if (!res) {
        out.textContent = "I could not convert that: encode needs even-length hex bytes, and decode needs one unbroken Base58 string — the alphabet has no 0, O, I or l, and no spaces. Nothing was converted.";
        return;
      }
      if (res.direction === "encode") {
        out.textContent = "✓ Those " + res.byteLength + " byte(s) encode to Base58: " + (res.encoded === "" ? "(empty — zero bytes encode to the empty string)" : res.encoded) + ". Plain Base58, not Base58Check: no checksum was added — an address's checksum (tool 2) is part of the bytes themselves. Computed locally; nothing was fetched, signed or sent.";
      } else {
        out.textContent = "✓ That Base58 decodes to " + res.byteLength + " byte(s): " + (res.hex === "" ? "(empty — the empty string decodes to zero bytes)" : res.hex) + ". If those bytes were an address, they are prefix + content + the stored checksum verbatim — decoding does not verify the checksum; paste the address into tool 2 for that. Computed locally; nothing was fetched, signed or sent.";
      }
    });

    document.getElementById("vlq-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("vlq-result");
      var res = analyzeVlq(document.getElementById("vlq-input").value, document.getElementById("vlq-direction").value);
      if (!res) {
        out.textContent = "I could not convert that: encode needs a whole non-negative number in plain decimal (VLQ has no negative or fractional form), and decode needs exactly one canonical VLQ as hex — no truncated encoding, no trailing bytes, and no overlong spelling like 8000 for zero. Nothing was converted.";
        return;
      }
      if (res.direction === "encode") {
        out.textContent = "✓ " + res.value + " encodes as VLQ hex " + res.hex + " (" + res.byteLength + (res.byteLength === 1 ? " byte" : " bytes") + ") — 7 bits per byte, least-significant group first, the high bit marking every byte but the last. That is the byte form this integer takes as a box value, height, token amount or count inside a serialized box (tools 15 and 17). Computed locally; nothing was fetched, signed or sent.";
      } else {
        out.textContent = "✓ That VLQ hex decodes to " + res.value + " — and it is the canonical spelling: re-encoding the value reproduces those exact bytes, so no shorter or longer form of the same number is hiding in it. Decoded locally; nothing was fetched, signed or sent.";
      }
    });

    document.getElementById("zigzag-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("zigzag-result");
      var res = analyzeZigZag(document.getElementById("zigzag-input").value, document.getElementById("zigzag-direction").value, document.getElementById("zigzag-width").value);
      if (!res) {
        out.textContent = "I could not convert that: encode needs a whole signed number inside the chosen width's range (64-bit: -9223372036854775808 to 9223372036854775807; 32-bit: -2147483648 to 2147483647), and decode needs exactly one canonical ZigZag VLQ as hex — no truncated encoding, no trailing bytes, no overlong spelling, and no value wider than the chosen width can hold. Nothing was converted.";
        return;
      }
      var kind = res.width === "64" ? "an SLong" : "an SShort or SInt";
      if (res.direction === "encode") {
        var msg = "✓ " + res.value + " zig-zags to unsigned " + res.unsigned + " and writes as VLQ hex " + res.hex + " (" + res.byteLength + (res.byteLength === 1 ? " byte" : " bytes") + ") at " + res.width + "-bit width. That is the byte form this value takes as " + kind + " inside a serialized box or register (tools 15, 17 and 18). ";
        if (res.width === "32" && res.byteLength > 5) msg += "The long form is fleet-sdk's real spelling, not a mistake: a 32-bit zig-zag result that lands negative is written widened to its unsigned 64-bit form. ";
        msg += "Computed locally; nothing was fetched, signed or sent.";
        out.textContent = msg;
      } else {
        out.textContent = "✓ That VLQ hex is unsigned " + res.unsigned + ", which un-zig-zags to " + res.value + " at " + res.width + "-bit width — and re-encoding that value reproduces those exact bytes, so the spelling is canonical for this width, the way a box parser must read " + kind + ". Decoded locally; nothing was fetched, signed or sent.";
      }
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

    /* --- serialized transaction parser --- */
    document.getElementById("txparse-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("txparse-result");
      var res = parseErgoTransaction(document.getElementById("txparse-bytes").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Parsed " + res.byteLength + " bytes — transaction ID " + res.txId + ", recomputed the way the chain defines it: the Blake2b-256 of the unsigned serialization (proofs stripped, extensions kept), so it is the same ID whether the copy you pasted was signed or not. This copy is " + (res.signed ? "signed — at least one input carries a spending proof." : "unsigned — no input carries a spending proof yet.") + " ";
      msg += "Inputs (" + res.inputs.length + "): " + res.inputs.map(function (inp, i) {
        var s = "#" + (i + 1) + " spends box " + inp.boxId + (inp.proofLength > 0 ? " (proof " + inp.proofLength + " bytes)" : " (no proof)");
        if (inp.extension.length > 0) s += " with context extension " + inp.extension.map(function (x) { return "key " + x.key + " = " + x.value + " (" + x.type + ", raw " + x.rawHex + ")"; }).join("; ");
        return s;
      }).join("; ") + ". ";
      msg += res.dataInputs.length === 0
        ? "Data inputs: none. "
        : "Data inputs (" + res.dataInputs.length + ", read by the scripts but not spent): " + res.dataInputs.join(", ") + ". ";
      msg += "Outputs (" + res.outputs.length + "), totalling " + res.totalOutputErg + " ERG (" + res.totalOutputNano + " nanoERG): " + res.outputs.map(function (o) {
        var s = "#" + (o.index + 1) + " box " + o.boxId + " — " + o.valueErg + " ERG (" + o.valueNano + " nanoERG), created at height " + o.creationHeight + ", guarded by ErgoTree " + o.ergoTree;
        if (o.tokens.length > 0) s += ", holding " + o.tokens.map(function (tk) { return tk.amount + " raw of token " + tk.tokenId; }).join("; ");
        if (o.registers.length > 0) s += ", registers " + o.registers.map(function (rg) { return rg.name + " = " + rg.value + " (" + rg.type + ", raw " + rg.rawHex + ")"; }).join("; ");
        return s;
      }).join("; ") + ". ";
      if (res.tokenTotals.length > 0) msg += "Token totals across all outputs: " + res.tokenTotals.map(function (tt) { return tt.amount + " raw of " + tt.tokenId; }).join("; ") + " — raw on-chain integers; tool 6 converts them once you know each token's decimals. ";
      msg += "No fee is shown: a fee is inputs minus outputs, and the input boxes' values are not part of a transaction's bytes — only their IDs are. Each output's box ID is recomputed from its standalone serialization (tool 14's rule), so pasting one into an explorer should find exactly that box. Parsed locally, field by field; nothing was fetched, signed or sent.";
      out.textContent = msg;
    });

    /* --- serialized transaction builder --- */
    document.getElementById("txbuild-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("txbuild-result");
      var parseInputs = function (text) {
        return text.split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ""; }).map(function (line) {
          var parts = line.split(/\s+/);
          var inp = { boxId: parts[0], proofHex: null, extension: [] };
          if (parts.length > 1 && parts[1] !== "-") inp.proofHex = parts[1];
          if (parts.length > 2) {
            inp.extension = parts.slice(2).join(" ").split(";").map(function (e) { return e.trim(); }).filter(function (e) { return e !== ""; }).map(function (e) {
              var eq = e.indexOf("=");
              return { key: eq < 0 ? e : e.slice(0, eq).trim(), value: eq < 0 ? "" : e.slice(eq + 1).trim() };
            });
          }
          return inp;
        });
      };
      var parseOutputs = function (text) {
        return text.split(/\n\s*\n/).map(function (b) { return b.trim(); }).filter(function (b) { return b !== ""; }).map(function (block) {
          var o = { valueNano: "", ergoTree: "", creationHeight: "", tokens: [], registers: [] };
          block.split(/\n+/).forEach(function (line) {
            var m = line.trim().match(/^([a-z]+)\s*:\s*(.*)$/);
            if (!m) return;
            var k = m[1].toLowerCase(), v = m[2].trim();
            if (k === "value") o.valueNano = v;
            else if (k === "tree") o.ergoTree = v;
            else if (k === "height") o.creationHeight = v;
            else if (k === "token") { var tp = v.split(/\s+/); o.tokens.push({ tokenId: tp[0] || "", amount: tp[1] || "" }); }
            else if (k === "register") o.registers.push(v);
          });
          return o;
        });
      };
      var res = buildErgoTransaction({
        inputs: parseInputs(document.getElementById("txbuild-inputs").value),
        dataInputs: document.getElementById("txbuild-datainputs").value.split(/\n+/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ""; }),
        outputs: parseOutputs(document.getElementById("txbuild-outputs").value)
      });
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Built a " + res.byteLength + "-byte " + (res.signed ? "signed-form" : "unsigned") + " transaction locally — ID " + res.txId + ", the Blake2b-256 of its unsigned serialization (proofs stripped, extensions kept), so it keeps this ID once real proofs replace any placeholders. ";
      msg += "Outputs (" + res.outputs.length + "), totalling " + res.totalOutputErg + " ERG (" + res.totalOutputNano + " nanoERG): " + res.outputs.map(function (o) { return "#" + (o.index + 1) + " box " + o.boxId + " — " + o.valueErg + " ERG"; }).join("; ") + ". ";
      if (res.tokenIds.length > 0) msg += "Distinct token IDs, in first-appearance order: " + res.tokenIds.join(", ") + " — the outputs name their tokens by index into this list. ";
      msg += "Serialized bytes: " + res.txHex + " ";
      msg += "The bytes were round-tripped through tool 29's parser field-for-field before being shown. Building is not broadcasting: this transaction exists on no chain until it is signed with real proofs and accepted by a node, and no fee check is possible here — a fee is inputs minus outputs, and the input boxes' values are not part of what you entered, only their IDs. Nothing was fetched, signed or sent.";
      out.textContent = msg;
    });

    /* --- HD address derivation (EIP-3) --- */
    document.getElementById("hd-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("hd-result");
      var res = deriveHdAddresses(
        document.getElementById("hd-seed").value,
        document.getElementById("hd-account").value,
        document.getElementById("hd-change").value,
        document.getElementById("hd-count").value
      );
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Derived " + res.rows.length + " address(es) locally on the EIP-3 path (account " + res.account + ", " + (res.change === 0 ? "receiving" : "change") + " branch). " + res.rows.map(function (r) {
        return "#" + r.index + " — " + r.path + " — public key " + r.publicKey + " — mainnet " + r.mainnet + " — testnet " + r.testnet;
      }).join("; ") + ". ";
      msg += "Only public keys and addresses are shown — no private key ever leaves the derivation, and the seed you typed never left this page: it was not stored, logged or sent anywhere. Prefer a test seed for trying this out; a real seed belongs in a wallet, not a website.";
      out.textContent = msg;
    });

    /* --- Public key inspector --- */
    document.getElementById("pubkey-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("pubkey-result");
      var res = inspectPublicKey(document.getElementById("pubkey-in").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ That is a real point on the curve: x " + res.x + ", y " + res.y + " (" + res.yParity + ", as its " + res.publicKey.slice(0, 2) + " prefix claims) — y² = x³ + 7 (mod p) holds and the point re-compresses to exactly this key. ";
      msg += "Uncompressed form: " + res.uncompressedHex + ". As a Sigma constant it is the SGroupElement " + res.sigmaConstantHex + " (tool 18). Its P2PK addresses (tools 8 and 19 build the same): mainnet " + res.mainnet + " — testnet " + res.testnet + ", round-tripped through tool 11's decoder before being shown. ";
      msg += "Inspection only: a public key is public — this proves the point is real, and proves no ownership of the key; the private half is never asked for and cannot be found from the point. Nothing was fetched, signed or sent.";
      out.textContent = msg;
    });

    /* --- Box set summarizer --- */
    document.getElementById("boxset-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("boxset-result");
      var res = summarizeBoxSet(document.getElementById("boxset-boxes").value, document.getElementById("boxset-height").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Summarized " + res.boxCount + (res.boxCount === 1 ? " box" : " boxes") + " (" + res.totalBytes + " serialized bytes in total): " + res.totalErg + " ERG (" + res.totalNano + " nanoERG) across the set. " +
        "Per box: " + res.boxes.map(function (b) { return "line " + b.line + " — " + b.valueErg + " ERG, " + b.byteLength + " bytes, created at height " + b.creationHeight + ", box " + b.boxId; }).join("; ") + ". ";
      if (res.tokenTotals.length === 0) {
        msg += "Tokens: none in any box. ";
      } else {
        msg += "Token totals (" + res.distinctTokens + " distinct): " + res.tokenTotals.map(function (tt) { return tt.amount + " raw of " + tt.tokenId + " (in " + tt.boxCount + (tt.boxCount === 1 ? " box" : " boxes") + ")"; }).join("; ") + " — raw on-chain integers; tool 6 converts them to display form once you know each token's decimals. ";
      }
      msg += res.allMeetMinimum
        ? "Every box meets its size-based protocol minimum (tool 5's rule; the set's minimums total " + res.minTotalErg + " ERG). "
        : "Below the size-based protocol minimum (tool 5): " + res.belowMinimum.map(function (b) { return "box " + b.boxId + " is " + b.shortfallNano + " nanoERG under its " + b.minNano + " nanoERG minimum"; }).join("; ") + ". ";
      if (res.currentHeight !== null) {
        msg += "At height " + res.currentHeight + ", " + res.eligibleCount + " of " + res.boxCount + (res.boxCount === 1 ? " box is" : " boxes are") + " old enough for storage rent (created + 1,051,200 blocks, tool 7's rule), holding " + res.eligibleErg + " ERG between them. ";
      }
      msg += "Summarized locally from the bytes you pasted — nothing was fetched, signed or sent, and this is a statement about those bytes, not a live wallet balance: a box may since have been spent, which only the chain can tell you.";
      out.textContent = msg;
    });

    /* --- Transaction fee & balance checker --- */
    document.getElementById("txfee-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("txfee-result");
      var res = analyzeTxFee(document.getElementById("txfee-tx").value, document.getElementById("txfee-boxes").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Transaction " + res.txId + " (" + (res.signed ? "signed" : "unsigned") + ", " + res.inputCount + (res.inputCount === 1 ? " input" : " inputs") + (res.dataInputCount > 0 ? " plus " + res.dataInputCount + " data input(s), read but not spent" : "") + "): inputs hold " + res.inputErg + " ERG (" + res.inputNano + " nanoERG), outputs hold " + res.outputErg + " ERG (" + res.outputNano + " nanoERG). ";
      msg += res.balanced
        ? "The ERG balances exactly — inputs minus outputs is 0, as it must be: a transaction creates no ERG. "
        : "⚠ The ERG does NOT balance: inputs minus outputs is " + res.differenceNano + " nanoERG (" + res.differenceErg + " ERG), which no valid non-coinbase transaction can do — the pasted boxes are not this transaction's real inputs, or the bytes are not a valid transaction. The figures below are the arithmetic of what was pasted, not a verdict on a real transaction. ";
      msg += res.feeOutputCount > 0
        ? "Fee paid: " + res.feeErg + " ERG (" + res.feeNano + " nanoERG), locked in " + res.feeOutputCount + (res.feeOutputCount === 1 ? " output" : " outputs") + " guarded by the miner fee contract — the fee is that output, not an inputs-minus-outputs remainder. "
        : "No output is guarded by the miner fee contract, so no fee is paid inside this transaction's own outputs. ";
      if (res.tokenBalances.length === 0) {
        msg += "Tokens: none on either side. ";
      } else {
        msg += "Tokens: " + res.tokenBalances.map(function (tb) {
          if (tb.minted) return "minted " + tb.outAmount + " raw of new token " + tb.tokenId + " (a minted token's ID is the first input's box ID — this one matches)";
          var s = tb.inAmount + " raw in, " + tb.outAmount + " raw out of " + tb.tokenId;
          if (BigInt(tb.burnedAmount) > 0n) s += " — " + tb.burnedAmount + " raw burned";
          if (BigInt(tb.outAmount) > BigInt(tb.inAmount)) s += " — ⚠ more out than in, which no valid transaction can do for a token it does not mint";
          return s;
        }).join("; ") + ". ";
        if (!res.tokensConserved) msg += "⚠ At least one token does not conserve, so as pasted this cannot be a valid transaction. ";
      }
      msg += "Checked locally from the bytes you pasted — nothing was fetched, signed or sent, and the pasted input boxes are taken as the transaction's inputs because their box IDs match its input list; only the chain can confirm they are the boxes it really spent.";
      out.textContent = msg;
    });

    /* --- Token-aware payment planner --- */
    document.getElementById("tokenplan-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("tokenplan-result");
      var res = planTokenPayment(document.getElementById("tokenplan-boxes").value, document.getElementById("tokenplan-payment").value, document.getElementById("tokenplan-fee").value, document.getElementById("tokenplan-tokens").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = res.sufficient
        ? "✓ Plan: spend " + res.selectedCount + " of your " + res.boxCount + (res.boxCount === 1 ? " box" : " boxes") + " — " + res.selectedBoxIds.join(", ") + " — holding " + res.selectedErg + " ERG (\"" + res.selectedNano + "\" nanoERG) against the " + res.neededErg + " ERG (\"" + res.neededNano + "\" nanoERG) the payment + fee need. "
        : "✗ These boxes cannot cover that payment as listed. The closest plan spends " + res.selectedCount + " of your " + res.boxCount + (res.boxCount === 1 ? " box" : " boxes") + " holding " + res.selectedErg + " ERG against the " + res.neededErg + " ERG the payment + fee need";
      if (!res.sufficient && BigInt(res.ergShortfallNano) > 0n) msg += " — ERG shortfall " + res.ergShortfallErg + " ERG (\"" + res.ergShortfallNano + "\" nanoERG)";
      if (!res.sufficient) msg += ". ";
      if (res.tokens.length === 0) {
        msg += "No token requirements were stated. ";
      } else {
        msg += "Tokens: " + res.tokens.map(function (tr) {
          var s = tr.selected + " raw selected of " + tr.tokenId + " against " + tr.required + " required";
          if (tr.shortfall !== "0") s += " — ⚠ short by " + tr.shortfall + " raw";
          else if (tr.change !== "0") s += " — " + tr.change + " raw comes back as change";
          else s += " — exact";
          return s;
        }).join("; ") + ". ";
      }
      if (res.changeTokens.length > 0) msg += "Also riding into the change box, because the selected boxes carry them and spent tokens never vanish: " + res.changeTokens.map(function (ct) { return ct.amount + " raw of " + ct.tokenId; }).join("; ") + ". ";
      if (res.sufficient) {
        msg += "ERG change: " + res.changeErg + " ERG (\"" + res.changeNano + "\" nanoERG)";
        if (res.changeIsDust) msg += " — ⚠ dust: above zero but below the 0.001 ERG safe user minimum, so a wallet would normally fold it into the fee or select differently";
        msg += ". ";
        if (res.tokenChangeWithoutErg) msg += "⚠ But the ERG change is exactly zero while tokens are left over — a change output holding those tokens must itself hold ERG, so a real transaction needs one more input (or a slightly smaller payment) to carry them. ";
      }
      msg += "Selected in two phases — boxes carrying still-needed tokens first, in your listed order, then the rest in order until the ERG covered — and planned locally from the bytes you pasted: nothing was fetched, signed or sent, and a pasted box may since have been spent, which only the chain can tell you.";
      out.textContent = msg;
    });

    /* --- Transaction JSON converter --- */
    document.getElementById("txjson-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("txjson-result");
      var box = document.getElementById("txjson-output");
      var dir = document.getElementById("txjson-direction").value;
      var res = convertTxJson(dir, document.getElementById("txjson-input").value);
      if (!res.valid) {
        box.value = "";
        out.textContent = "✗ " + res.reason;
        return;
      }
      if (dir === "json-to-bytes") {
        box.value = res.txHex;
        out.textContent = "✓ Converted to serialized bytes: transaction " + res.txId + " — " + res.byteLength + " bytes, " + res.inputCount + (res.inputCount === 1 ? " input" : " inputs") + (res.dataInputCount > 0 ? ", " + res.dataInputCount + " data input(s)" : "") + ", " + res.outputCount + (res.outputCount === 1 ? " output" : " outputs") + " holding " + res.totalOutputErg + " ERG (" + res.totalOutputNano + " nanoERG) in total" + (res.tokenIds.length > 0 ? ", with " + res.tokenIds.length + " distinct token ID(s)" : "") + "." + (res.idMismatch ? " ⚠ The pasted JSON claimed id " + res.claimedId + ", which does NOT match the computed transaction ID above — the JSON's id was stale or wrong; the bytes and the computed ID are what the fields actually describe." : (res.claimedId ? " The pasted JSON's id matches the computed transaction ID." : "")) + " Converted locally: nothing was fetched, signed or sent.";
      } else {
        box.value = res.json;
        out.textContent = "✓ Converted to EIP-12 / fleet JSON: transaction " + res.txId + " — " + res.inputCount + (res.inputCount === 1 ? " input" : " inputs") + (res.dataInputCount > 0 ? ", " + res.dataInputCount + " data input(s)" : "") + ", " + res.outputCount + (res.outputCount === 1 ? " output" : " outputs") + " holding " + res.totalOutputErg + " ERG (" + res.totalOutputNano + " nanoERG) in total, from " + res.byteLength + " serialized bytes. Converted locally: nothing was fetched, signed or sent.";
      }
    });

    /* --- Token mint planner --- */
    document.getElementById("mintplan-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("mintplan-result");
      var res = planTokenMint(
        document.getElementById("mintplan-first-input").value,
        document.getElementById("mintplan-name").value,
        document.getElementById("mintplan-desc").value,
        document.getElementById("mintplan-decimals").value,
        document.getElementById("mintplan-amount").value,
        document.getElementById("mintplan-type").value
      );
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Mint plan for \"" + res.name + "\": token ID " + res.tokenId + " — the box ID of the minting transaction's first input, which is what makes the ID unique (that box can be spent only once). ";
      msg += "The issuance box carries " + res.amountRaw + " raw tokens (displayed as " + res.displayAmount + " with " + res.decimals + " decimals) and registers " + res.registerLines.join(", ") + (res.assetType ? " — asset type: " + res.assetType : "") + ". ";
      msg += "To assemble the issuance box: tool 30's transaction builder takes the token line \"" + res.boxbuildTokens + "\" and the register hexes above, one per line in R4-first order; tool 17's box builder takes the same token line and the registers as typed specs — " + res.boxspecRegisters.split("\n").join(", ") + ". ";
      msg += "Planned locally from what you typed: nothing was fetched, signed, sent or minted — the token exists only once a real transaction spending that first input confirms, and whether the box is still unspent is a chain fact to check on an explorer.";
      out.textContent = msg;
    });

    document.getElementById("txaudit-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("txaudit-result");
      var res = auditTxOutputs(document.getElementById("txaudit-tx").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Transaction " + res.txId + " (" + res.byteLength + " bytes, " + (res.signed ? "signed" : "unsigned") + "): " + res.inputCount + " input(s), " + res.dataInputCount + " data input(s), " + res.outputCount + " output(s) holding " + res.totalOutputErg + " ERG in total. ";
      msg += res.hasFeeOutput
        ? "Fee paid by its outputs: " + res.feeErg + " ERG in the miner-fee-contract output(s) at index " + res.feeOutputIndexes.join(", ") + ". "
        : "⚠ No output is guarded by the miner fee contract — nothing in this transaction's outputs pays a miner. ";
      msg += res.allMeetMinimum
        ? "Every output meets the protocol minimum for its size. "
        : "⚠ Output(s) below the protocol minimum for their size: " + res.belowMinimum.map(function (b) { return "#" + b.index + " short by " + b.shortfallNano + " nanoERG"; }).join(", ") + " — a below-minimum output can never be created on-chain. ";
      if (res.mints.length) msg += "This transaction mints: " + res.mints.map(function (m) { return m.amount + " of token " + m.tokenId + " in output #" + m.outputIndex; }).join("; ") + " (a new token's ID is its minting transaction's first input's box ID). ";
      if (res.heightsDiffer) msg += "Its outputs carry differing creation heights — reported as a fact; wallets normally stamp them all with one height. ";
      msg += "Per output: " + res.outputs.map(function (o) { return "#" + o.index + " " + o.valueErg + " ERG, " + o.byteLength + " bytes (minimum " + o.minErg + " ERG)" + (o.isFee ? ", fee contract" : "") + (o.tokenCount ? ", " + o.tokenCount + " token(s)" : "") + (o.registerCount ? ", " + o.registerCount + " register(s)" : ""); }).join(" · ") + ". ";
      msg += "Output side only, from the bytes you pasted: whether the inputs cover these outputs needs the input boxes — that is tool 34. Nothing was fetched, signed or sent.";
      out.textContent = msg;
    });

    document.getElementById("txinput-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("txinput-result");
      var res = auditTxInputs(document.getElementById("txinput-tx").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg = "✓ Transaction " + res.txId + " (" + res.byteLength + " bytes): " + res.inputCount + " spent input(s) (" + res.distinctInputCount + " distinct box(es)), " + res.dataInputCount + " data input(s), " + res.outputCount + " output(s). ";
      msg += res.signedInputCount === 0
        ? "No input carries a spending proof — this transaction is unsigned. "
        : res.unsignedInputCount === 0
          ? "Every input carries a spending proof (" + res.totalProofBytes + " proof byte(s) in total). A present proof is not a verified one: validity is a question about each spent box's script, which the bytes alone cannot answer. "
          : res.signedInputCount + " of " + res.inputCount + " inputs carry a spending proof (" + res.totalProofBytes + " proof byte(s) in total); " + res.unsignedInputCount + " input(s) still have none. A present proof is not a verified one: validity is a question about each spent box's script, which the bytes alone cannot answer. ";
      if (res.duplicateInputs.length) msg += "⚠ The same box is listed as a spent input more than once: " + res.duplicateInputs.map(function (d) { return d.boxId + " at input indexes " + d.indexes.join(", "); }).join("; ") + " — a box can be spent only once, so this transaction can never be accepted as it stands. ";
      if (res.duplicateDataInputs.length) msg += "⚠ Data input(s) listed more than once: " + res.duplicateDataInputs.map(function (d) { return d.boxId + " at data-input indexes " + d.indexes.join(", "); }).join("; ") + " — the repeat reads the same box again and adds nothing. ";
      if (res.dataInputsAlsoSpent.length) msg += "Note: data input(s) " + res.dataInputsAlsoSpent.join(", ") + " also appear as spent inputs — reported as a fact visible in the bytes. ";
      var dupKeyNotes = [];
      res.inputs.forEach(function (i) { if (i.duplicateExtensionKeys.length) dupKeyNotes.push("input #" + i.index + " repeats extension key(s) " + i.duplicateExtensionKeys.join(", ")); });
      if (dupKeyNotes.length) msg += "⚠ " + dupKeyNotes.join("; ") + " — one key holds one constant, so a repeat makes what the script reads ambiguous. ";
      msg += "Per input: " + res.inputs.map(function (i) { return "#" + i.index + " " + i.boxId.slice(0, 12) + "…, " + (i.hasProof ? "proof " + i.proofLength + " byte(s)" : "no proof") + (i.extension.length ? ", extension " + i.extension.map(function (e) { return "key " + e.key + " = " + e.type + " " + e.value; }).join(", ") : ""); }).join(" · ") + ". ";
      msg += "Input side only, from the bytes you pasted: what these inputs are worth lives in the input boxes — tool 34 checks fee and balance with them, and tool 38 audits the output side. Nothing was fetched, signed or sent.";
      out.textContent = msg;
    });

    document.getElementById("txsign-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("txsign-result");
      var res = compareTxSigning(document.getElementById("txsign-before").value, document.getElementById("txsign-after").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg;
      if (res.verdict === "identical") {
        msg = "✓ The two serializations are byte-for-byte identical (" + res.byteLengthBefore + " bytes, transaction " + res.txIdBefore + ") — the wallet handed back exactly what it was shown" + (res.signedAfter ? "." : ", and it is still unsigned: no input carries a proof.") + " ";
      } else if (res.verdict === "signing-only") {
        msg = "✓ Signing only: both serializations carry transaction ID " + res.txIdBefore + ", so the spent inputs, context extensions, data inputs, token list and outputs are byte-identical — the only differences are spending proofs (" + res.totalProofBytesBefore + " proof byte(s) before, " + res.totalProofBytesAfter + " after). ";
        if (res.proofsAdded.length) msg += "Proofs added on input(s) " + res.proofsAdded.map(function (i) { return "#" + i; }).join(", ") + ". ";
        if (res.proofsChanged.length) msg += "Proofs replaced on input(s) " + res.proofsChanged.map(function (i) { return "#" + i; }).join(", ") + ". ";
        if (res.proofsRemoved.length) msg += "⚠ Proofs REMOVED on input(s) " + res.proofsRemoved.map(function (i) { return "#" + i; }).join(", ") + " — a proof that was there before signing is gone afterwards; the transaction ID cannot see proofs, so only this comparison catches it. ";
      } else {
        msg = "⚠ CHANGED beyond signing: the transaction IDs differ (before " + res.txIdBefore + ", after " + res.txIdAfter + "), so this is not the transaction that was shown before signing. Differing section(s): " + res.changedSections.join(", ") + ". ";
        res.inputs.forEach(function (inp) {
          if (!inp.sameBox) msg += "Input #" + inp.index + " spends a different box (before " + (inp.boxIdBefore ? inp.boxIdBefore.slice(0, 12) + "…" : "none") + ", after " + (inp.boxIdAfter ? inp.boxIdAfter.slice(0, 12) + "…" : "none") + "). ";
          else if (!inp.extensionSame) msg += "Input #" + inp.index + " keeps its box but its context extension changed. ";
        });
        if (!res.dataInputsSame) msg += "Data inputs differ (before " + res.dataInputsBefore.length + ", after " + res.dataInputsAfter.length + "). ";
        if (!res.outputsSame) msg += "Outputs differ (before " + res.outputCountBefore + " output(s) holding " + res.totalOutputNanoBefore + " nanoERG, after " + res.outputCountAfter + " output(s) holding " + res.totalOutputNanoAfter + " nanoERG). ";
        msg += "Do not treat the after version as the transaction you approved — compare it with tools 38 and 39 before signing anything. ";
      }
      msg += "Comparison only, over the bytes you pasted: whether a change is legitimate, or a proof valid, is not something bytes alone can answer. Nothing was fetched, signed or sent.";
      out.textContent = msg;
    });

    document.getElementById("boxdiff-calc").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var out = document.getElementById("boxdiff-result");
      var res = compareErgoBoxes(document.getElementById("boxdiff-a").value, document.getElementById("boxdiff-b").value);
      if (!res.valid) {
        out.textContent = "✗ " + res.reason;
        return;
      }
      var msg;
      if (res.verdict === "identical") {
        msg = "✓ The two serializations are byte-for-byte identical (" + res.byteLengthA + " bytes) — both are box " + res.boxIdA + ", holding " + res.valueNanoA + " nanoERG, created at height " + res.creationHeightA + " by transaction " + res.transactionIdA + " at index " + res.indexA + ". ";
      } else {
        msg = "⚠ The boxes differ — changed field(s): " + res.changedFields.join(", ") + ". First box " + res.boxIdA + " (" + res.byteLengthA + " bytes), second box " + res.boxIdB + " (" + res.byteLengthB + " bytes" + (res.byteLengthDelta !== 0 ? ", " + (res.byteLengthDelta > 0 ? "+" : "") + res.byteLengthDelta : "") + "). ";
        if (!res.valueSame) msg += "Value: " + res.valueNanoA + " → " + res.valueNanoB + " nanoERG (" + (res.valueDeltaNano.charAt(0) === "-" ? "" : "+") + res.valueDeltaNano + "). ";
        if (!res.ergoTreeSame) msg += "ErgoTree differs — the two boxes are guarded by different scripts. ";
        if (!res.heightSame) msg += "Creation height: " + res.creationHeightA + " → " + res.creationHeightB + " (" + (res.heightDelta > 0 ? "+" : "") + res.heightDelta + " blocks). ";
        res.tokens.forEach(function (t) {
          if (t.change === "added") msg += "Token " + t.tokenId + " added with amount " + t.amountB + ". ";
          else if (t.change === "removed") msg += "Token " + t.tokenId + " removed (was " + t.amountA + "). ";
          else if (t.change === "changed") msg += "Token " + t.tokenId + " amount " + t.amountA + " → " + t.amountB + ". ";
        });
        res.registers.forEach(function (r) {
          if (r.change === "added") msg += "Register " + r.name + " added: " + r.valueB + " (" + r.typeB + ", raw " + r.rawHexB + "). ";
          else if (r.change === "removed") msg += "Register " + r.name + " removed (was " + r.valueA + ", " + r.typeA + ", raw " + r.rawHexA + "). ";
          else if (r.change === "changed") msg += "Register " + r.name + " changed: " + r.valueA + " (" + r.typeA + ", raw " + r.rawHexA + ") → " + r.valueB + " (" + r.typeB + ", raw " + r.rawHexB + "). ";
        });
        if (!res.transactionIdSame) msg += "Creating transaction differs (" + res.transactionIdA + " → " + res.transactionIdB + "). ";
        if (!res.indexSame) msg += "Output index differs (" + res.indexA + " → " + res.indexB + "). ";
        msg += res.sameProvenance
          ? "Both boxes still claim the same origin (same creating transaction and index) — the content moved, not the claimed provenance. "
          : "The two boxes do not claim the same origin — treat them as different boxes that happen to be compared, not two versions of one box, unless you have another reason to pair them. ";
      }
      msg += "Comparison only, over the bytes you pasted: a box's ID is the hash of its bytes, so any field change makes a different box — this shows which fields moved, and whether the second box is the right version of the first is not a question bytes alone answer. Nothing was fetched, signed or sent.";
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
