'use strict';
/*
 * dual-chain.js — read-only observation of Ergo and Midnight from one module,
 * plus a bridge intent planner for the Ergo -> Cardano (Rosen) -> Midnight route.
 *
 * Phase 0 of the Midnight<->Ergo integration (see README.md in this folder).
 * Nothing here signs, sends, or custodies anything. All network functions are
 * read-only and take an injectable fetch implementation so the offline tests
 * can pin behaviour against mocked chain responses.
 *
 * Built by Kyle Cox (@kshot9000), independent builder.
 */

const crypto = require('node:crypto');

const ERGO_EXPLORER_DEFAULT = 'https://api.ergoplatform.com/api/v1';
// Midnight indexer GraphQL (schema v4): POST /api/v4/graphql.
// Preprod is the default on purpose: testnet first, always.
const MIDNIGHT_INDEXER_DEFAULTS = {
  preprod: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  preview: 'https://indexer.preview.midnight.network/api/v4/graphql',
  local: 'http://localhost:8088/api/v4/graphql',
};

function pickFetch(fetchImpl) {
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('no fetch implementation available (pass fetchImpl)');
  return f;
}

async function getJson(url, fetchImpl) {
  const f = pickFetch(fetchImpl);
  const res = await f(url);
  if (!res || res.ok !== true) {
    throw new Error('GET ' + url + ' failed with status ' + (res ? res.status : 'no response'));
  }
  return res.json();
}

/* ---------------- Ergo (explorer API, read-only) ---------------- */

async function getErgoHeight({ explorerBase = ERGO_EXPLORER_DEFAULT, fetchImpl } = {}) {
  const page = await getJson(explorerBase + '/blocks?limit=1&offset=0&sortBy=height&sortDirection=desc', fetchImpl);
  const items = page && page.items;
  if (!Array.isArray(items) || items.length === 0 || typeof items[0].height !== 'number') {
    throw new Error('unexpected Ergo explorer blocks response');
  }
  return items[0].height;
}

async function getErgoBox(boxId, { explorerBase = ERGO_EXPLORER_DEFAULT, fetchImpl } = {}) {
  if (typeof boxId !== 'string' || boxId.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(boxId)) {
    throw new Error('boxId must be 64 hex characters');
  }
  return getJson(explorerBase + '/boxes/' + boxId, fetchImpl);
}

async function getErgoAddressBalance(address, { explorerBase = ERGO_EXPLORER_DEFAULT, fetchImpl } = {}) {
  if (typeof address !== 'string' || address.length === 0) throw new Error('address required');
  const bal = await getJson(
    explorerBase + '/addresses/' + encodeURIComponent(address) + '/balance/confirmed',
    fetchImpl
  );
  if (!bal || typeof bal.nanoErgs !== 'number') throw new Error('unexpected Ergo balance response');
  return bal; // { nanoErgs, tokens: [...] } exactly as the explorer reports it
}

/* ---------------- Midnight (indexer GraphQL, read-only) ---------------- */

async function midnightGraphQL(query, variables, { endpoint = MIDNIGHT_INDEXER_DEFAULTS.preprod, fetchImpl } = {}) {
  const f = pickFetch(fetchImpl);
  const res = await f(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  if (!res || res.ok !== true) {
    throw new Error('Midnight indexer request failed with status ' + (res ? res.status : 'no response'));
  }
  const payload = await res.json();
  if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error('Midnight indexer GraphQL errors: ' + payload.errors.map((e) => e.message || 'unknown').join('; '));
  }
  if (!payload || payload.data == null) throw new Error('Midnight indexer returned no data');
  return payload.data;
}

const MIDNIGHT_LATEST_BLOCK_QUERY = 'query { block { height hash timestamp } }';

async function getMidnightHeight(opts = {}) {
  const data = await midnightGraphQL(MIDNIGHT_LATEST_BLOCK_QUERY, {}, opts);
  if (!data.block || typeof data.block.height !== 'number') {
    throw new Error('unexpected Midnight block response');
  }
  return data.block.height;
}

const MIDNIGHT_CONTRACT_ACTION_QUERY =
  'query($address: HexEncoded!) { contractAction(address: $address) { address state zswapState } }';

async function getMidnightContractAction(address, opts = {}) {
  if (typeof address !== 'string' || !/^[0-9a-fA-F]+$/.test(address)) {
    throw new Error('Midnight contract address must be hex (HexEncoded)');
  }
  const data = await midnightGraphQL(MIDNIGHT_CONTRACT_ACTION_QUERY, { address }, opts);
  return data.contractAction; // may be null when the indexer has no action for it
}

/* ---------------- Address format checks (format only, not proof) ---------------- */

// Ergo mainnet P2PK addresses are Base58 and start with '9'. This is a format
// check only; the real Blake2b-256 checksum validation lives in hub tool 2.
function looksLikeErgoAddress(address) {
  return (
    typeof address === 'string' &&
    address.length >= 30 &&
    address.length <= 60 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(address)
  );
}

// Midnight unshielded addresses are Bech32m (BIP-350) with an mn_addr HRP
// (e.g. mn_addr_test1... on test networks); DUST addresses use mn_dust.
// The old check was a loose regex over [0-9a-z]: Bech32's data charset
// excludes 'b', 'i', 'o' and '1', and the regex never verified the
// 6-character checksum, so a corrupted or mistyped recipient passed and an
// intent could be planned for an address no wallet accepts. This is a real
// Bech32m validation instead — HRP, charset, separator and the polymod
// checksum (Bech32m constant 0x2bc830a3): any single-character change to a
// valid address fails. Verified against an independent Python
// implementation of BIP-350 (fixtures and mutation sweep in the tests).
const BECH32M_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;
const BECH32M_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32mPolymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk ^= BECH32M_GENERATORS[i];
    }
  }
  return chk >>> 0;
}

// Returns { hrp, payload } (payload = 5-bit values, checksum stripped) or
// null when the string is not valid Bech32m. Lowercase only: Bech32 strings
// must be single-case and Midnight addresses are lowercase.
function decodeBech32m(address) {
  if (typeof address !== 'string' || address.length < 8 || address.length > 200) return null;
  if (address !== address.toLowerCase()) return null;
  const pos = address.lastIndexOf('1');
  if (pos < 1 || pos + 7 > address.length) return null; // HRP + '1' + >=6 checksum chars
  const hrp = address.slice(0, pos);
  for (let i = 0; i < hrp.length; i++) {
    const c = hrp.charCodeAt(i);
    if (c < 33 || c > 126) return null;
  }
  const data = [];
  for (let i = pos + 1; i < address.length; i++) {
    const v = BECH32M_CHARSET.indexOf(address[i]);
    if (v === -1) return null;
    data.push(v);
  }
  const expanded = [];
  for (let i = 0; i < hrp.length; i++) expanded.push(hrp.charCodeAt(i) >> 5);
  expanded.push(0);
  for (let i = 0; i < hrp.length; i++) expanded.push(hrp.charCodeAt(i) & 31);
  if (bech32mPolymod(expanded.concat(data)) !== BECH32M_CONST) return null;
  return { hrp, payload: data.slice(0, data.length - 6) };
}

function looksLikeMidnightAddress(address) {
  const decoded = decodeBech32m(address);
  if (!decoded || decoded.payload.length === 0) return false;
  return (
    decoded.hrp === 'mn_addr' ||
    decoded.hrp === 'mn_dust' ||
    decoded.hrp.startsWith('mn_addr_') ||
    decoded.hrp.startsWith('mn_dust_')
  );
}

/* ---------------- Bridge intent planner ---------------- */

/*
 * planBridgeIntent({ nanoErg, ergoSender, midnightRecipient, nonce })
 * Returns the leg-by-leg plan for moving value Ergo -> Midnight with each
 * leg's real status labelled. Builds no transaction and moves no funds.
 * The intentId is an off-chain reference: SHA-256 of the canonical intent
 * string. (The Phase 1 ErgoScript guard will store a Blake2b-256 commitment
 * to the recipient on-chain; the planner's ID exists so watchers, claims and
 * refunds can all reference the same intent before any contract exists.)
 */
function planBridgeIntent({ nanoErg, ergoSender, midnightRecipient, nonce } = {}) {
  if (typeof nanoErg !== 'bigint' && !(typeof nanoErg === 'number' && Number.isSafeInteger(nanoErg))) {
    throw new Error('nanoErg must be a BigInt or a safe integer');
  }
  const amount = BigInt(nanoErg);
  if (amount <= 0n) throw new Error('nanoErg must be positive');
  if (!looksLikeErgoAddress(ergoSender)) throw new Error('ergoSender is not an Ergo address (format check)');
  if (!looksLikeMidnightAddress(midnightRecipient)) {
    throw new Error('midnightRecipient is not a Midnight address (format check)');
  }
  const nonceStr = nonce == null ? '0' : String(nonce);
  const canonical = ['ergo->midnight', ergoSender, midnightRecipient, amount.toString(), nonceStr].join('|');
  const intentId = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  return {
    intentId,
    direction: 'ergo->midnight',
    amountNanoErg: amount.toString(),
    ergoSender,
    midnightRecipient,
    nonce: nonceStr,
    status: 'design', // the end-to-end route is not live; legs below say why
    legs: [
      {
        leg: 1,
        from: 'Ergo',
        to: 'Cardano',
        via: 'Rosen Bridge',
        status: 'live',
        note: 'Rosen Bridge operates Ergo<->Cardano with watcher/guard federation. ERG locks on Ergo; the wrapped representation is released on Cardano.',
      },
      {
        leg: 2,
        from: 'Cardano',
        to: 'Midnight',
        via: 'Midnight claim contract (Compact) + watcher attestations',
        status: 'design',
        note: 'No public Cardano->Midnight value bridge exists yet. This leg is the Phase 1 prototype: a Compact claim contract on Midnight Preprod records fulfilled intents attested by watchers watching both chains.',
      },
      {
        leg: 3,
        from: 'Midnight claim',
        to: 'Midnight recipient',
        via: 'shielded/unshielded release to the committed address',
        status: 'design',
        note: 'Only the Blake2b-256 commitment to the recipient crosses to the Ergo side; the address itself stays on Midnight, which is the privacy point of the route.',
      },
    ],
    refund: {
      chain: 'Ergo',
      rule: 'If the intent is not claimed by the agreed timeout height, the intent box is spendable back to ergoSender (refund path is part of the Phase 1 guard design).',
      status: 'design',
    },
  };
}

module.exports = {
  ERGO_EXPLORER_DEFAULT,
  MIDNIGHT_INDEXER_DEFAULTS,
  getErgoHeight,
  getErgoBox,
  getErgoAddressBalance,
  midnightGraphQL,
  getMidnightHeight,
  getMidnightContractAction,
  looksLikeErgoAddress,
  decodeBech32m,
  looksLikeMidnightAddress,
  planBridgeIntent,
};
