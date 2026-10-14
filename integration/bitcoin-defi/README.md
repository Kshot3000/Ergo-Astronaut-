# Native Bitcoin DeFi on Ergo — design & code

**Status: Phase 0 and Phase 1 verification shipped. No new bridge is live. Nothing here moves funds.**

Built by Kyle Cox (@kshot9000) — independent builder, not affiliated with the Ergo Foundation, the Ergo Platform team, or the Rosen Bridge team. This folder is MIT-licensed like the rest of this repo — use and change anything here to benefit Ergo.

## What "native Bitcoin DeFi on Ergo" honestly means

Bitcoin has the largest idle capital base in crypto and almost no native DeFi — its script can't express the contracts. Ergo can: eUTXO, ErgoScript and Sigma protocols are a natural DeFi execution layer for BTC. There are three routes, in order of how real they are today:

1. **rsBTC via Rosen Bridge — LIVE.** Rosen's Bitcoin bridge went live on 2024-06-14: BTC locks on Bitcoin under Rosen's watcher/guard federation and rsBTC is issued on Ergo (and Cardano), where it can trade on Ergo DEXes and sit in Ergo contracts. This is the route that exists; it is federated, not trustless, and its security is the guard set's.
2. **SPV-verified BTC on Ergo — DESIGN (this folder starts the primitives).** ErgoScript can verify Bitcoin block headers and Merkle inclusion proofs inside a contract. A box that only releases when a Bitcoin payment is proven included in a header chain with enough accumulated work gives a much thinner trust story than a federation for one-way flows (BTC payments into Ergo contracts, atomic-swap legs, hashlock/timelock constructions Ergo already does well). It cannot move BTC *out* of Bitcoin by itself — Bitcoin still can't verify Ergo — so outflows remain federation/threshold territory. Anyone claiming a fully trustless two-way peg is skipping that fact.
3. **Threshold-Schnorr BTC vaults coordinated by Ergo contracts — RESEARCH.** Ergo's Sigma protocols and Bitcoin's BIP-340 Schnorr share discrete-log foundations, so an Ergo contract can coordinate a threshold signing set that custodies BTC and settles DeFi logic on Ergo. Kushti has his own Bitcoin relay work in this direction; this is the long game, not a deliverable.

## What ships here

- **Phase 0 (`btc-spv.js`)** — the verification primitive everything in route 2 needs, as dependency-free Node code: Bitcoin header parsing, double-SHA256 block hashing, nBits→target conversion and PoW checking, Merkle root computation, and transaction-inclusion proof verification. Pinned by tests against the real Bitcoin genesis block and an independent Python (hashlib) oracle — the same oracle-first discipline as the rest of this repo's integration code. Plus a route planner that labels each leg live or design, like the Midnight planner.
- **Phase 1 (`btc-chain.js`)** — header-chain verification on top of Phase 0: prev-hash linkage, every header's hash against its own target, targets confined to (0, pow-limit], bits frozen between retargets, and the 2016-block retarget itself checked exactly as Bitcoin Core computes it (actual timespan clamped to [two weeks / 4, two weeks × 4], result capped at the pow limit), plus cumulative work in Core's GetBlockProof units (floor(2^256 / (target + 1)) per block). When a segment starts mid-period, the retarget at its boundary is reported as *unverified* unless the caller supplies the period's first timestamp — the check is never silently assumed. Tests are pinned against real Bitcoin headers (genesis through block 3, and the retargets at 2016 — capped at the limit — and 32256, the first difficulty increase in Bitcoin's history) and an independent Python oracle implementing the same consensus rules from the spec. The folder also carries an ErgoScript guard sketch that consumes a verified chain and an inclusion proof, honestly labelled draft-source-not-compiled until it can be compiled and tested on testnet.
- **Phase 2** — a worked one-way flow on testnet: a tBTC payment proven via SPV releases a testnet Ergo box. Federation/threshold outflow design only after that, with audits before any real value.

## Why this matters for Ergo

Every BTC holder who wants yield without giving up self-custody stories is a potential Ergo user. Route 1 already works and deserves better tooling and visibility; route 2 is where Ergo's tech (Sigma, NiPoPoW research, script-expressible SPV) can genuinely beat the wrapped-asset crowd on trust. Building the primitives in the open, with tests anyone can re-run, is how that starts.

## Running the Phase 0 code

```sh
node integration/bitcoin-defi/test-btc-spv.js    # Phase 0, offline tests, no network
node integration/bitcoin-defi/test-btc-chain.js  # Phase 1, offline tests, no network
```

---

Independent builder — not affiliated with the Ergo Foundation, Ergo Platform, or Rosen Bridge.
Built by @kshot9000 (https://x.com/kshot9000) · github.com/Kshot3000
Ergo donations: 9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy
BTC: 3GnR7TWBXAB3pPztBWpNF4LMNEX5yX8vZK
