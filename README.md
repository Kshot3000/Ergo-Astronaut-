# Ergo Astronaut 🚀

My builder hub for the **Ergo blockchain** — new websites and apps, fixes and
improvements, built and maintained by Kyle Cox (@kshot9000).

**Live hub:** https://kshot3000.github.io/Ergo-Astronaut-/

> Tagging the Ergo team: @ergoplatform (GitHub) · @ergo_platform (X) —
> this is an independent community builder hub for the Ergo ecosystem.
> Team feedback and corrections welcome.

## My mission here

- **Build new** websites and apps for Ergo — tools, dashboards and dApp
  front-ends, shipped open source and verified live.
- **Fix and improve** Ergo code wherever it lives: across my own Ergo repos
  (starting with my Airlock DEX), and across the wider Ergo ecosystem —
  upstream work goes through forks and pull requests, substance only, and I
  respect each project's contribution and AI policies.
- **Work on integration** between Ergo and the other chains I build on:
  Ergo ⇄ Cardano is already real via Rosen Bridge, and my integration lab
  explores connecting my Ergo tooling with my Cardano dApps (NightDream,
  Cardano4All) and my Midnight privacy projects (Privacy4All, Night
  Messenger) — planned/lab work, labelled as such until it ships.

## What is Ergo?

Ergo is a proof-of-work blockchain (Autolykos) built on the **eUTXO** model:
funds live in boxes that can carry data and native tokens, and contracts are
written in **ErgoScript** on top of **Sigma protocols** — composable
zero-knowledge proofs native to the language. Ergo adds ideas few other chains
have: **storage rent** (long-untouched boxes pay a small rent, so lost coins
recycle), **Babel fees** (pay a transaction fee in a native token instead of
ERG) and **NIPoPoWs** (compact proofs of proof-of-work for light clients and
cross-chain verification). Fair launch in 2019 — no ICO, no pre-mine sale.

- Official site: https://ergoplatform.org/
- Developer docs: https://docs.ergoplatform.com/
- This builder repo: https://github.com/Kshot3000/Ergo-Astronaut-

## Flagship: my own Ergo work

| Project | Status | What it is |
|---|---|---|
| [Airlock — my Ergo DEX](https://kshot3000.github.io/MY-ERGO-DEX/) | ✅ live | My decentralised exchange for Ergo, in the separate MY-ERGO-DEX repo: live market quotes, token catalogue, Nautilus wallet connect. Quote-and-preview today; on-chain settlement is the next, honestly-labelled phase. ([source](https://github.com/Kshot3000/MY-ERGO-DEX)) |

## Ecosystem catalogue (not my work — linked for credit)

| Project | What it does |
|---|---|
| [Ergo Platform](https://ergoplatform.org/) | Official home of Ergo |
| [Ergo Explorer](https://explorer.ergoplatform.com/) | Official mainnet block explorer |
| [Ergo Documentation](https://docs.ergoplatform.com/) | Official developer docs |
| [Spectrum DEX](https://spectrum.fi/) | Cross-chain AMM DEX on Ergo and Cardano |
| [SigmaUSD](https://sigmausd.io/) | AgeUSD algorithmic stablecoin (SigUSD / SigRSV) |
| [Rosen Bridge](https://rosen.tech/) | Decentralised Ergo ⇄ Cardano bridge ([app](https://app.rosen.tech/)) |
| [Paideia](https://paideia.im/) | DAO governance tooling on Ergo |
| [ErgoPad](https://github.com/ergopad) | Token launchpad — IDOs and staking |
| [Nautilus Wallet](https://github.com/nautls/nautilus-wallet) | Browser wallet for Ergo dApps |
| [DuckPools](https://duckpools.io/) | Lending and borrowing pools |
| [SkyHarbor](https://skyharbor.io/) | NFT marketplace |
| [Mew Finance](https://mewfinance.com/) | Community toolbox of Ergo dApps |
| [Fleet SDK](https://fleet-sdk.github.io/docs/) | TypeScript SDK for Ergo dApps |

Every catalogue link was checked live (HTTP 200) when this page was written.

## Tools on the hub (local only, no wallet needed)

- **ERG ⇄ nanoERG converter** — exact BigInt maths (1 ERG = 1,000,000,000
  nanoERG), no floating-point drift.
- **Ergo address checker** — Base58-decodes an address in your browser,
  verifies its real checksum (the first 4 bytes of Blake2b-256 over the
  address bytes, stored as the last 4 bytes) and reports the network and
  address type (P2PK / P2SH / P2S) from the prefix byte.
- **Storage rent estimator** — the protocol fee for a box left unspent for
  1,051,200 blocks (~4 years) is its serialized size × the storage fee
  factor (1,250,000 nanoERG per byte on mainnet — a votable chain
  parameter, verified against live network params on 2026-10-06). The
  estimator shows the rent per cycle, how many full payments a box's ERG
  covers, and warns when a box — tokens and NFTs included — could be
  consumed whole at its first rent date.
- **Autolykos mining-share estimator** — your expected share of blocks
  equals your share of total network hashrate at Ergo's 2-minute block
  target (~720 blocks/day). You supply your hashrate, the network
  hashrate and the current block reward; the tool fetches nothing,
  claims no live network data, and labels its output an estimate
  (pool fees, tx fees, difficulty drift and luck all move real results).
- **Minimum box value checker** — a box's value must be at least its
  serialized size × the minimum value per byte (360 nanoERG per byte —
  the rate set at launch, verified against live mainnet epoch params
  on 2026-10-07; a votable chain parameter). Exact BigInt maths: the
  checker shows the exact minimum for a box's size, whether a value
  clears it (and by how much, or the shortfall), and how it compares
  with the recommended safe user minimum of 0.001 ERG per box.
- **Token amount converter** — on-chain token amounts are whole integers;
  a token's display amount is its raw integer divided by 10^decimals,
  with the decimals declared in the token's own metadata (ERG itself is
  the 9-decimal case: nanoERG is the raw unit). Exact BigInt maths both
  ways; display amounts smaller than one raw unit are rejected because
  they cannot exist on-chain.
- **Storage rent countdown** — a box becomes eligible for storage rent
  once the chain height reaches its creation height + 1,051,200 blocks
  (~4 years at the 2-minute block target). You supply both heights from
  a block explorer; the tool fetches nothing, claims no live chain
  data, and shows the box's age, its eligibility height, and the
  blocks (and approximate days) remaining — or warns that it is already
  rent-eligible. Exact BigInt maths for the heights.
- **P2PK address builder** — the inverse of the address checker: a
  33-byte compressed public key (66 hex characters, starting 02 or 03)
  becomes its P2PK address — network prefix byte (0x01 mainnet /
  0x11 testnet) + key + the first 4 bytes of Blake2b-256 over both,
  Base58-encoded, exactly as Ergo defines it. Verified against the
  documented mainnet/testnet P2PK test vectors and cross-checked with
  an independent Python build. Public keys only — the page warns
  against ever entering a private key or seed phrase anywhere.
- **UTXO payment planner** — Ergo spends boxes whole: a wallet selects
  input boxes until their total covers payment + transaction fee, and
  the leftover returns as a change box. You list your boxes' ERG
  values in order and the planner walks them in that order with exact
  BigInt maths — how many boxes a payment takes, the total selected,
  and the change — and flags dust change (above zero but below the
  recommended 0.001 ERG safe minimum per box) that a real wallet
  would usually fold into the fee. Planning only: it fetches nothing,
  signs nothing, and sends nothing; real wallets may select boxes in
  a different order.
- **ErgoTree inspector** — paste a box's ErgoTree hex and it reads the
  header byte locally (version, the 0x08 size flag with its VLQ-encoded
  proposition size, the 0x10 constant-segregation flag), recognises
  the standard P2PK proposition (08 cd + a 33-byte compressed key) and
  shows that key's P2PK address, and derives the script's P2SH address
  — prefix byte + the first 24 bytes of Blake2b-256 over the
  proposition bytes + checksum. Hashing the full tree bytes instead of
  the proposition is the funds-at-risk bug I reported as
  fleet-sdk/fleet#219 (fixed by fleet-sdk/fleet#220); the inspector's
  P2SH output is verified against that issue's reference vectors
  (testnet qQqAgn6N…, mainnet 7HP8obUp…), cross-checked with an
  independent Python build. Constant-segregated trees are reported
  honestly with no address derived: their reference hash needs the
  constants substituted back into the proposition, which raw tree
  bytes alone cannot reconstruct.
- **Address-to-ErgoTree decoder** — the inverse of the inspector and
  the P2PK builder: paste any Ergo address and it verifies the
  checksum, reads the network from the address itself, and shows what
  the address's content actually is, exactly as sigmastate's and
  fleet-sdk's ErgoAddress encode it. A P2PK address's content is its
  33-byte public key, so its ErgoTree (00 08 cd + the key) comes
  straight back — feeding it to the inspector derives the same
  address again. A P2S address's content is the script's full
  ErgoTree bytes verbatim (the decoder runs them through the
  inspector's parser, segregated trees included). A P2SH address's
  content is only the 24-byte script hash, and a hash is one-way:
  the decoder shows the hash and says the script cannot be recovered
  from it, rather than inventing one. Verified against Kyle's P2PK
  address, the fleet #219 P2SH reference addresses on both networks,
  and the fleet-sdk fee-contract P2S address.
- **Babel fee calculator** — Babel fees let a transaction pay its fee in
  a native token instead of ERG, swapped through a babel box holding
  ERG. The box's price is stated in its R5 register in nanoERG per raw
  token unit; you supply the ERG amount you need, that price, and the
  token's decimals (from its explorer listing), and the calculator works
  out the smallest whole number of raw tokens whose swap covers the
  amount — exact BigInt ceiling maths — plus the ERG that swap releases
  and any overhang above the amount (one token fewer would come up
  short). Planning only: it fetches nothing, claims no live babel-box
  data, and does not check a box's ERG balance or current price — both
  are on the box's explorer page.
- **Address network converter** — the same address on the other network.
  Only the prefix byte's high nibble carries the network (0x0 mainnet,
  0x1 testnet); the content bytes are identical on both, so the
  converter verifies the checksum, swaps the nibble, and recomputes the
  checksum over the new prefix. Works for P2PK, P2SH and P2S addresses,
  with the warning stated plainly on the page: the converted address
  guards boxes on that network only, and sending mainnet ERG to a
  testnet address loses it. Verified against the fleet #219 P2PK and
  P2SH address pairs published on both networks, Kyle's address, and
  the fee-contract P2S address, cross-checked with an independent
  Python (hashlib) build.
- **Box ID calculator** — a box's ID is derived, not stored: it is the
  Blake2b-256 of the box's serialized bytes, the full serialization
  (candidate, then the creating transaction's ID and the box's output
  index) — exactly how fleet-sdk's `ErgoBox.boxId` derives and
  validates it. Paste the full serialized box bytes and the calculator
  hashes them locally and shows the ID, with an optional expected-ID
  field that reports a match or a plain mismatch; it also notes the
  naming rule that a minted token's ID is the box ID of the creating
  transaction's first input. Candidate-only bytes are called out as
  hashing to something that is not the box ID. Verified against three
  of the fleet-sdk serializer's published box test vectors and
  cross-checked with an independent Python (hashlib) build.
- **Serialized box parser** — the full read-back of the box ID
  calculator: paste a box's full serialized bytes and it parses them
  locally in the exact layout fleet-sdk's `serializeBox` /
  `deserializeBox` use — value, ErgoTree, creation height, every
  token's ID and raw amount, the R4–R9 registers decoded as the Sigma
  constants they hold (primitives, collections and tuples, with
  zigzag-VLQ integers), the creating transaction's ID and the output
  index — and recomputes the box ID from the same bytes. The tree is
  delimited exactly as fleet's reader delimits it (fee contract by
  its exact bytes, P2PK by its 0008cd prefix, otherwise the 0x08 size
  flag); a no-size-field tree that is neither recognised form, and a
  register holding an exotic constant type (Option, Box, AvlTree),
  both stop the parse with the reason stated plainly rather than a
  guessed field boundary. Integer registers decode at fleet's own
  widths — Short/Int through its 32-bit zigzag (its `readI16` /
  `readI32` truncate the raw VLQ to 32 bits first, which matters at
  the extremes, where fleet's encoder emits a 64-bit-wide VLQ) and
  Long through its 64-bit zigzag. Verified against fleet-sdk's published box
  test vectors — all six parseable vectors reproduce their recorded
  fields and box IDs, including the 24-token box — and cross-checked
  with an independent Python parser.
- **P2S address builder** — the encode-side inverse of the
  address-to-ErgoTree decoder: a P2S (pay-to-script) address carries
  the script itself, its content being the full ErgoTree bytes
  verbatim under prefix byte 0x03 (mainnet) / 0x13 (testnet) plus the
  Blake2b-256 checksum, exactly sigmastate's `Pay2SAddress`
  construction. The opposite trade from P2SH: the address is as long
  as the script and reveals it, and it carries constant-segregated
  trees exactly — the case the inspector's P2SH derivation honestly
  declines. The tree is parsed first and anything unparseable is
  refused, and the built address is round-tripped through the decoder
  before it is shown. Verified against the fleet-sdk fee-contract P2S
  address on both networks and the fleet #219 P2PK tree,
  cross-checked with an independent Python (hashlib) build.
- **Serialized box builder** — the encode-side inverse of the
  serialized box parser: supply a box's fields — value, ErgoTree,
  creation height, tokens, the creating transaction's ID and the
  output index — and it assembles the serialized bytes locally in
  exactly the layout fleet-sdk's `serializeBox` writes, then derives
  the box ID from them. Registers R4–R9 are entered as typed values
  (`long:430550309`, `int:852574`, `bytes:<hex>` for a Coll[SByte],
  `bigint:…`, `group:…`, `dlog:…`, `ints:…`, `longs:…`, `bool:…`,
  `byte:…`, `short:…`) and encoded as Sigma constants the way
  fleet-sdk's `dataSerializer` encodes them — including its SInt
  zigzag quirk at the 32-bit extremes, mirrored deliberately because
  fleet's published constant vectors are the compatibility target.
  The assembled bytes are round-tripped through the box parser and
  every field must read back exactly before anything is shown.
  Verified by rebuilding fleet-sdk's published box test vectors
  byte-for-byte from their recorded fields and fleet's published
  Sigma constant vectors for every register type, cross-checked with
  an independent Python build. Construction only — it signs and
  sends nothing.
- **Sigma constant inspector** — one register ⇄ its hex, standalone.
  A box's R4–R9 registers each hold one Sigma constant (a type byte
  plus the value's bytes), which is exactly how explorers and node
  APIs display a register on its own — a babel box's R5 price, say.
  Paste one constant's hex and it is decoded with the same reader
  the box parser uses, at the same integer widths (Short/Int
  through fleet-sdk's 32-bit zigzag, Long through its 64-bit one),
  so an SInt at a 32-bit extreme reads back as written; enter a
  typed value in the box builder's register form (`long:430550309`,
  `int:852574`, `bytes:<hex>`, `bigint:…`, `group:…`, `dlog:…`,
  `ints:…`, `longs:…`, `bool:…`, `byte:…`, `short:…`) and it is
  encoded and round-tripped through the decoder before being
  shown. The constant must consume the input exactly — trailing
  bytes are reported, not ignored — and the parser's stated limits
  apply unchanged: an Option, Box or AvlTree constant type, and a
  SigmaProp that is not the ProveDlog form, stop the decode plainly
  rather than being guessed past. Verified against fleet-sdk's
  published Sigma constant vectors in both directions and the
  register raw hexes the box parser tests already record.
- **P2PK ErgoTree builder** — public key → ErgoTree, the encode
  direction the other tools were missing (key → address, tree →
  address, address → tree and tree → P2S were already covered).
  The standard P2PK tree is header `0x00` plus the ProveDlog
  proposition (`08 cd`) plus the 33-byte compressed public key —
  the script Ergo builds for a P2PK box and the one the
  address-to-tree decoder reverses. The tree carries no network,
  so it is identical on both; the chosen network only picks the
  derived addresses shown alongside it (the P2PK address and the
  P2SH address). The built tree is round-tripped through the
  ErgoTree inspector and the address through the address decoder
  before anything is shown. Verified against the documented P2PK
  vectors and the fleet-sdk/fleet#219 reference P2SH addresses on
  both networks. Public keys only — construction only, it signs
  and sends nothing.
- **P2SH address builder** — ErgoTree → pay-to-script-hash address,
  the dedicated form of the derivation the ErgoTree inspector
  reports. The address is prefix `0x02`/`0x12` plus the first
  24 bytes of Blake2b-256 over the script's proposition (the tree
  without its header byte, and without the VLQ size field when the
  header carries one) plus the checksum — never over the full tree
  bytes, the fleet-sdk/fleet#219 bug that made boxes unspendable.
  Constant-segregated trees are refused plainly, exactly as in the
  fleet PR #220 fix, because their reference hash needs constants
  substituted back in; the P2S builder carries those trees instead.
  The built address is round-tripped through the address decoder
  before being shown. Verified against the fleet #219 sigmastate
  reference addresses on both networks, a size-flagged tree and a
  generic script, cross-checked with an independent Python
  (hashlib) build. Construction only — it signs and sends nothing.
- **Blake2b-256 hash calculator** — the primitive underneath the
  rest of the hub, exposed on its own: hex bytes or UTF-8 text in,
  the full 32-byte digest plus its first 24 bytes (the hash192 form
  a P2SH address carries) out, with an optional expected digest
  reported as a plain match or mismatch. A box ID is this hash of
  the box bytes, an address checksum is its first 4 bytes, and a
  P2SH script hash is its first 24 bytes over the proposition.
  Empty input is hashed, not rejected — the digest of zero bytes
  is well-defined. Verified against Python (hashlib) vectors,
  including the empty input and the fleet #219 proposition whose
  digest starts with the known script hash, and it agrees with
  the box ID calculator on the published box vectors by
  construction. Hashing only — it signs and sends nothing.
- **Base58 codec** — the encoding every Ergo address is written
  in, exposed on its own: hex bytes to Base58 or a Base58 string
  back to the exact bytes it carries, leading zero bytes and all
  (each one is a leading "1"). Plain Base58, not Base58Check — it
  adds no checksum and verifies none; an address decodes to prefix
  + content + its stored checksum bytes verbatim, and the address
  checker is the tool that verifies that checksum. Empty input
  converts to the empty result. Verified against an independent
  Python build, including the classic `00eb1523…06647` vector and
  my own address's bytes round-tripping exactly. Encoding only —
  it signs and sends nothing.
- **VLQ codec** — the variable-length encoding almost every
  integer inside a serialized box is written in (box value,
  creation height, token amounts, counts, output index, and a
  size-flagged tree's proposition size), exposed on its own:
  a whole non-negative number to its VLQ hex, or VLQ hex back
  to the number — unsigned LEB128 exactly as fleet-sdk writes
  it, 7 bits per byte, least-significant group first, exact
  BigInt at any size. Decode is strict: exactly one VLQ, no
  truncation, no trailing bytes, and the canonical spelling
  only — an overlong form like `8000` for zero is rejected.
  Verified against fleet-sdk's published VLQ vectors and an
  independent Python build. Encoding only — it signs and
  sends nothing.

## Cross-chain integration

**Live today (ecosystem):** Ergo ⇄ Cardano runs through
[Rosen Bridge](https://rosen.tech/) — watchers and guards, live app at
https://app.rosen.tech/. Any serious Ergo ⇄ Cardano work builds on it.

**Planned lab work (not live features):** connecting my Ergo tooling with my
Cardano dApps — [NightDream](https://nightdream.xyz/) and
[Cardano4All](https://kshot3000.github.io/Cardano4all/) — and exploring what
Midnight's privacy model in [Privacy4All](https://kshot3000.github.io/Privacy4All/)
and [Night Messenger](https://kshot3000.github.io/Night-Messenger-/) could mean
for Ergo users. Each piece gets labelled here when it actually ships.

## Guides

- [Getting started with Ergo](guides/getting-started-ergo.md) — official
  resources, wallets and docs, in learning order.

## How the hourly builder loop works

1. An hourly loop works this mission: building new Ergo apps, fixing and
   improving Ergo code in my repos and the wider ecosystem, and the
   Cardano/Midnight integration lab — correctness first, then new tools,
   accessibility, performance and docs accuracy.
2. Anything shipped is tested (`node tests/test-site.js`) and verified
   against the live GitHub Pages site before it's claimed done. A run that
   can't produce a genuine improvement ships nothing — quiet runs beat
   mediocre changes.
3. Finished work is committed and pushed to `main` with a descriptive
   message — the commit history is the run log.
4. Every user-facing surface carries my Ergo donation address and X account,
   and tags the Ergo team (@ergoplatform on GitHub, @ergo_platform on X)
   where the platform supports it.

## Support

Ergo (ERG) donations (click-copy on the hub):
`9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy`

Built by Kyle Cox — [@kshot9000 on X](https://x.com/kshot9000) ·
[github.com/Kshot3000](https://github.com/Kshot3000)

*Independent builder project — not affiliated with the Ergo Foundation or
the Ergo Platform team.*
