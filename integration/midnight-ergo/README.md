# Bringing Cardano's Midnight to Ergo — integration design & code

**Status: Phase 0 (design + read-only code) plus Phase 1 step 1 (the on-chain commitment and testnet intent-box plan, offline code only). No bridge is live. No real funds move through anything in this folder.**

Built by Kyle Cox (@kshot9000) — independent builder, not affiliated with the Ergo Foundation, the Ergo Platform team, IOG, or the Midnight Foundation.

## The honest starting point

There is **no Ergo⇄Midnight bridge today**, and Midnight does not connect to Ergo directly. What exists:

- **Rosen Bridge** is the real, live bridge between **Ergo and Cardano** (watchers report events on one chain, guards co-sign releases on the other; it is a federation, not a trustless protocol).
- **Midnight is Cardano's partner chain.** Its token NIGHT originated on Cardano (Glacier Drop), and DUST generation is tied to Cardano addresses — the Midnight indexer even exposes a `CardanoRewardAddress` type for DUST generation queries. Cardano is therefore Midnight's anchor chain, and it is Ergo's bridge neighbour. The only honest route between Ergo and Midnight runs **through Cardano**.

So "bringing Midnight to Ergo" means building, in order:

```
ERG on Ergo ──(Rosen Bridge, live)──► wrapped ERG on Cardano ──(leg to build)──► value/claims on Midnight
```

and the reverse for Midnight→Ergo. The Cardano→Midnight leg and the end-to-end intent protocol are the new work. Anyone claiming a one-hop Ergo→Midnight transfer today is skipping the hard part.

## Target design (what the code here grows into)

1. **Intent box (Ergo side).** A sender locks ERG in an Ergo box guarded by an ErgoScript contract. The box's registers carry a *commitment* — Blake2b-256 of the Midnight recipient address string, the amount, and a nonce — never the recipient in cleartext on the Ergo side beyond what settlement needs. The box can be spent two ways: (a) by a settlement transaction that presents proof the Midnight-side claim was fulfilled, or (b) by the sender after a timeout height (refund path). This mirrors how the hub's audited tools treat escrow: release or refund, nothing else.
2. **Watchers (off-chain).** Services that observe both chains — Ergo via the explorer/node API, Midnight via its indexer GraphQL API (`/api/v4/graphql`) — and attest that an intent box exists, is funded, and has reached an agreed confirmation depth. This is the Rosen watcher pattern applied to a second destination chain.
3. **Claim contract (Midnight side).** A Compact contract that records fulfilled intents: given an intent ID and the watchers' attestation set, it marks the intent claimed and releases the Midnight-side value to the committed recipient — whose shielded/unshielded address stays private on Ergo's side because only its hash crossed over. Midnight's ZK model is the point of the whole route: the Ergo leg is public, the Midnight leg doesn't have to be.
4. **Trust model, stated plainly.** Like Rosen, this design is a **watcher/guard federation**, not trustless. It is only safe for real value after the guard set, the ErgoScript guard, and the Compact circuits are independently audited. Until then: testnet and zero-value proofs only.

## Phases

- **Phase 0 — observation & planning (this folder, shipped 2026-10-13).** A dependency-free Node module (`dual-chain.js`) that reads both chains read-only — Ergo height/boxes/balances via the explorer API, Midnight blocks and contract actions via the indexer GraphQL API — plus a **bridge intent planner** that turns "send X ERG to this Midnight recipient" into the exact leg-by-leg plan with each leg's real status labelled (live / design / missing). Midnight recipients are validated as real Bech32m (BIP-350 checksum, not a format guess), so a corrupted recipient address is refused before an intent is planned. Offline tests (`test-dual-chain.js`) pin every behaviour against mocked chain responses.
- **Phase 1 — testnet prototype.** Intent boxes on Ergo testnet + a Compact claim contract on Midnight Preprod, watchers run by us, zero real value. Success = an intent created on Ergo testnet is observed, attested, and claimed on Preprod with the refund path also exercised.
  - **Step 1 (shipped 2026-10-13): the commitment + intent-box plan** — `intent-box.js`. Defines the canonical commitment the guard stores: `Blake2b-256("EMI1" || u32be(len) || recipient || u64be(amount) || nonce32)`, pinned by an independent Python oracle (hashlib) including amounts above float53 and at the u64 max. `buildIntentBoxPlan` turns an intent into the testnet box plan (value, R4 = the commitment as a serialized `Coll[Byte]`, R5 = refund timeout height, R6 = sender) and **refuses mainnet outright**; `inspectIntentBox` is the watcher-side check that an explorer-shaped box really carries the plan's commitment and at least the planned value before anyone attests. The draft ErgoScript guard travels with the plan, labelled `draft-source-not-compiled`: its settlement path reveals the commitment's canonical preimage and hashes exactly those bytes, so the on-chain check cannot drift from the encoding here. 36 offline tests, all passing.
  - **Next:** compile the guard with a testnet toolchain and create the first intent box on Ergo testnet; then the Compact claim contract on Preprod.
- **Phase 2 — guarded settlement.** Federation design, audits, and only then a mainnet conversation — gated on Kyle's explicit go-ahead and external review. Nothing in Phase 0–1 custodies or moves real funds.

## Why this matters for Ergo

Ergo gets a privacy destination it doesn't natively have: value earned or held on Ergo (mining, DeFi, payments) gains a route into Midnight's shielded state through Ergo's existing Cardano bridge — and Midnight builders get a path to Ergo's eUTXO/Sigma ecosystem in return. Every leg built here is open-source in this repo so both communities can inspect, fork, and improve it.

## Running the Phase 0 code

```sh
node integration/midnight-ergo/test-dual-chain.js   # Phase 0 offline tests, no network
node integration/midnight-ergo/test-intent-box.js   # Phase 1 step 1 offline tests, no network
```

Live reads (read-only, public endpoints):

```js
const { getErgoHeight, getMidnightHeight, planBridgeIntent } = require('./dual-chain');
```

Endpoints are configurable; defaults are the public Ergo explorer API and the Midnight **Preprod** indexer (`https://indexer.preprod.midnight.network/api/v4/graphql`). Testnet/Preprod first — always.

---

Independent builder — not affiliated with the Ergo Foundation, Ergo Platform, IOG, or the Midnight Foundation.
Built by @kshot9000 (https://x.com/kshot9000) · github.com/Kshot3000
Ergo donations: 9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy
