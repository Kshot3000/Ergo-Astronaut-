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
- **ZigZag codec** — how signed integers are written inside a
  box, exposed on its own: a signed number is zig-zagged
  (0 → 0, −1 → 1, 1 → 2, −2 → 3, negatives folded into the
  odd numbers) and the result written as a VLQ — the two-step
  form every signed box/register value takes, an SLong
  through the 64-bit zig-zag and an SShort/SInt through
  fleet-sdk's 32-bit one. Both widths, both directions, and
  they genuinely differ at the extremes: 2147483647 is
  `feffffff0f` at 64-bit width but `feffffffffffffffff01`
  at 32-bit width, where fleet writes a negative 32-bit
  result widened to its unsigned 64-bit form. Decode is
  strict: exactly one canonical VLQ, and re-encoding the
  decoded value at the chosen width must reproduce the
  input byte-for-byte, so over-wide VLQs are refused.
  Verified against fleet-sdk's published ZigZag spec
  vectors and an independent Python build. Encoding only —
  it signs and sends nothing.
- **Box health checker** — the storage rent estimator, the
  minimum box value checker and the storage rent countdown
  answered together for one box: given its serialized size,
  the ERG it holds and its creation and current heights, it
  reports one plain verdict — below the protocol minimum for
  its size (bytes × 360 nanoERG), consumable by a miner now
  (rent-eligible and holding at most one rent payment of
  bytes × 1,250,000 nanoERG), consumable when eligibility
  arrives at creation + 1,051,200 blocks, or funded for a
  stated number of full rent payments, with what one rent
  deduction would leave if it is already eligible. Both
  per-byte rates are votable chain parameters, re-verified
  against live mainnet network params on 2026-10-07. It
  composes the three tools' own analysers, so its figures
  can never disagree with theirs; all inputs are
  user-supplied and it claims no live chain data. Analysis
  only — it signs and sends nothing.
- **Emission & supply calculator** — given any block height,
  the new coins that block issues and the total issued by its
  end, worked out with the chain's own monetary rules (the
  reference node's monetary settings run through its
  EmissionRules): a flat 75 ERG per block below height
  525,600, then 3 ERG less every 64,800-block epoch until the
  rate reaches 0 at block 2,080,800 and the full 97,739,925
  ERG maximum supply stands issued. The foundation's share
  (7.5 ERG in the fixed era, then 4.5 and 1.5 ERG, then
  nothing) and the miner's are reported separately, and the
  EIP-27 layer is applied on top: from block 777,217, 12 ERG
  of each reward of 15 ERG or more — or all but 3 ERG of a
  smaller one — is diverted to the re-emission contract, and
  from block 2,080,800 that contract pays the miner 3 ERG a
  block in recycled coins rather than new issuance. The
  schedule is protocol-fixed, so it fetches nothing and
  claims no live chain data; the height is user-supplied and
  the arithmetic is exact BigInt, cross-checked against a
  brute-force sum over every block. Schedule only — it signs
  and sends nothing.
- **EIP-4 token metadata codec** — encodes a token's name,
  description and decimals (plus an optional R7 asset type)
  into the exact issuance-box register hex EIP-4 specifies,
  and decodes registers pasted from an explorer back into
  readable metadata. R4, R5 and R6 are Coll[Byte] constants
  (0x0e + VLQ byte-length + UTF-8 bytes) holding the TEXT of
  each value — decimals included: EIP-4's own worked example
  (the "USD" token from block 98,288) encodes 2 decimals as
  the string "2", hex 0e0132, not as an Int constant. The
  decoder also accepts the Int-constant R6 form some tokens
  carry in the wild, and says which form it found. Encodings
  verified against the EIP's own published examples with an
  independent Python build. Registers only — it builds no
  transaction, signs nothing and mints nothing.
- **EIP-44 data-hash codec** — encodes arbitrary data (text or
  hex bytes) into its ADH representation under the proposed
  EIP-44 arbitrary-data signing standard: head byte = network
  byte + type 4, content = Blake2b-256(data), then the usual
  4-byte Blake2b-256 checksum, Base58-written — and decodes a
  representation back to the hash it carries. It also shows
  the exact bytes a wallet would sign (0x00 invalidator +
  network byte + hash), so a data signature can never double
  as a transaction signature. Verified against an independent
  Python (hashlib) build. Labelled honestly everywhere:
  EIP-44 is a Proposed standard, not an adopted one — an ADH
  string is a data representation for message signing, NOT a
  payment address, and the hash is one-way. It holds no keys,
  signs nothing and sends nothing.
- **Serialized transaction parser** — parses a whole
  transaction's serialized bytes in the layout fleet-sdk's
  transaction serializer writes: inputs (spent box ID, spending
  proof, context extension constants), data inputs, the
  distinct token ID list, and the outputs as embedded boxes
  whose tokens are named by index into that list. Recomputes
  the transaction ID as the Blake2b-256 of the unsigned
  serialization (proofs stripped, extensions kept — a signed
  and an unsigned copy share one ID) and each output's box ID
  from its standalone serialization, and totals the outputs'
  ERG and tokens exactly. Verified against fleet-sdk's
  published transaction vectors — the ones its own
  deserializer round-trips — and an independent Python build.
  Honest limits, both fleet-sdk's own: an output script with
  no size field that is not the P2PK tree or the miner fee
  contract cannot be delimited, and an exotic register or
  extension constant stops the parse plainly. No fee is shown:
  input box values are not in a transaction's bytes, only
  their IDs. It signs and sends nothing.
- **Serialized transaction builder** — the encode-side
  inverse of the parser: assembles a transaction's serialized
  bytes from its fields (input box IDs with optional pasted
  proofs and context extension constants, data inputs, and
  output candidates), building the distinct token ID list in
  first-appearance order and writing each output's tokens as
  indexes into it, exactly as fleet-sdk's serializer does.
  Registers and extension constants take a typed spec
  (long:100) or the constant's raw hex, so tuple constants —
  which real transactions carry — work too. The assembled
  bytes are round-tripped through the parser field-for-field
  before they are shown, so an output whose script the parser
  cannot delimit is refused, the same subset fleet-sdk itself
  round-trips. Verified byte-for-byte against fleet-sdk's
  published transaction vectors, including its signed raffle
  transaction, and an independent Python build. A proof field
  is pasted data, never a signature this tool makes; it signs,
  broadcasts and sends nothing.
- **HD address derivation** — where wallet addresses come
  from: BIP32 child-key derivation (HMAC-SHA512 master and
  steps, hardened and normal branches, ergo-wallet's
  retry-with-next-index rule included) down EIP-3's path
  m/44'/429'/account'/change/index, with a pure-JS SHA-512,
  HMAC-SHA512 and secp256k1 implementation built for this
  tool. The seed is pasted as hex (never a mnemonic — words
  to seed is a wallet's job), only public keys and addresses
  are displayed, no private key is ever shown, and every
  derived address is round-tripped through the address
  decoder before it appears. Verified against FIPS SHA-512
  and RFC 4231 HMAC known answers, the well-known secp256k1
  private-key 1/2 public keys, and an independent Python
  oracle fed with the published BIP39 test seed and two
  further seeds across accounts, branches and both networks.
  The page warns in plain words never to type a real seed
  into any website, this one included.
- **Public key inspector** — the curve-membership check the
  address builders do not make: a compressed secp256k1 key
  (02/03 prefix + x) is only a real key if x names a point on
  the curve, y² = x³ + 7 (mod p). This tool recovers y as
  (x³ + 7)^((p+1)/4) mod p (valid because p ≡ 3 mod 4), pins
  the prefix's parity, refuses x ≥ p and non-residue x (x = 0
  among them) as keys no private key can exist for, and shows
  the full point, the uncompressed form, the SGroupElement
  Sigma constant, and both networks' P2PK addresses,
  round-tripped through the address decoder. Verified
  against an independent Python oracle (pure-Python EC
  multiplication, pow-based decompression, hashlib address
  construction): the generator point, its negation, the keys
  of private keys 2 and 3, and my own address's key, which
  re-encodes to that exact address. Inspecting a public key
  proves no ownership of it.
- **Box set summarizer** — a whole set of boxes at once, one
  full serialized box per line: exact BigInt totals for ERG
  and for each token (aggregated by token ID across every box
  carrying it), a per-box check against the size-based
  protocol minimum, and — given a current height — per-box
  storage-rent eligibility with the eligible ERG totalled. It
  composes the single-box tools (the box parser, the minimum
  checker, the rent countdown) rather than re-deriving their
  maths, so its figures cannot disagree with theirs. The set
  is strict: an unparseable line stops the summary with the
  line named, and a duplicated box is refused rather than
  double-counted. It fetches nothing and is labelled as a
  statement about the pasted bytes, not a live balance.
  Verified against an independent Python oracle over
  fleet-sdk's published box vectors.
- **Transaction fee & balance checker** — a serialized
  transaction plus the boxes it spends (matched by box ID
  against the transaction's input list, strictly both ways):
  exact input/output ERG totals, a plain verdict on whether
  the ERG balances to zero as every valid non-coinbase
  transaction must, the fee as the ERG locked in outputs
  guarded by the miner fee contract (not a field, and not an
  inputs-minus-outputs remainder), and per-token accounting —
  in, out, burned, and minted, where a minted token's ID must
  equal the first input's box ID or it is flagged. Data
  inputs are read, not spent, and never enter the sums.
  It composes the transaction parser and the box parser
  rather than re-deriving their maths. Verified against an
  independent Python oracle that builds transactions from
  scratch over fleet-sdk's published box vectors: a balanced
  fee-paying case, a burn-and-mint case, an unbalanced case,
  and a data-input case.
- **Token-aware payment planner** — your serialized boxes
  plus a payment that needs ERG and specific raw token
  amounts: deterministic two-phase selection (boxes carrying
  still-needed tokens first, in listed order, then the rest
  in order until payment + fee is covered), exact BigInt
  throughout. The change accounting is complete: ERG change
  (with the dust flag), each requested token's leftover,
  and any unrequested token the selected boxes carry —
  spent tokens never vanish, they ride into the change
  box. Leftover tokens with an ERG change of exactly zero
  are flagged (a change output holding tokens must itself
  hold ERG), and shortfalls are reported per token and for
  ERG. It composes the box parser rather than re-deriving
  box maths. Verified against an independent Python oracle
  over fleet-sdk's published box vectors: token-phase
  ordering, a one-box cover, token and ERG shortfalls, an
  unrequested token riding into change, and the
  zero-ERG-change trap.
- **Transaction JSON converter** — the same unsigned
  transaction in the two notations Ergo developers move
  between: the EIP-12 / fleet-sdk JSON dialect (inputs with
  optional context extensions, data inputs, outputs with
  string amounts and R4–R9 registers as Sigma-constant hex)
  and the serialized bytes the parser and builder tools
  work in, converted either way. The JSON form is unsigned
  by definition, so a signed transaction is refused in
  both directions rather than have its spending proofs
  silently dropped; amounts are never rounded (a JSON
  number is accepted only as a safe integer and re-emitted
  as a string); registers must start at R4 with no gaps,
  because they are positional; and an `id` in pasted JSON
  that disagrees with the computed transaction ID is
  reported, never hidden. It composes the transaction
  builder and parser rather than re-deriving their maths.
  Verified against an independent Python oracle that
  builds the transaction and its Blake2b-256 ID from
  scratch over fleet-sdk's published box vectors, with the
  extracted box IDs asserted against the recorded ones.
- **Token mint planner** — the issuance side of a new
  token, planned before anything is built: a token's ID
  is the box ID of the minting transaction's first input
  (the EIP-4 rule fleet-sdk's builder follows — a box can
  be spent only once, so the ID can never be reused), so
  from that box ID plus the token's name, description,
  decimals, optional asset type and raw amount, the
  planner returns the token ID, the EIP-4 issuance
  registers, the display amount, and the exact token and
  register field text the box and transaction builders
  take for the issuance box. It composes the EIP-4 codec
  and the token amount converter rather than re-deriving
  their maths, and decodes its own registers back before
  showing them. Planning only — it builds no transaction
  and mints nothing. Verified against an independent
  Python oracle over the fleet-recorded box IDs.
- **Transaction output auditor** — a pre-sign audit of a
  transaction's output side alone, from its bytes only:
  tool 34's fee-and-balance check needs the input boxes
  pasted alongside, but everything a transaction creates
  is determined by the transaction itself. Per output it
  reports the standalone serialized size and the protocol
  minimum value for that size (360 nanoERG per byte),
  flagging any below-minimum output — which can never be
  created on-chain — with its exact shortfall; the
  miner-fee-contract outputs are summed as the fee the
  outputs pay, and a transaction with no fee-contract
  output is flagged plainly; a token whose ID equals the
  first input's box ID is reported as a mint, with its
  amount and output. What it cannot see is stated in its
  own copy: whether the inputs cover the outputs is
  tool 34, with the input boxes. It composes the
  transaction parser and the minimum-value figure rather
  than re-deriving their maths. Verified against an
  independent Python oracle over fleet-sdk's published
  transaction vectors plus a from-scratch synthetic
  mint-and-dust transaction.
- **Transaction input auditor** — the input-side
  counterpart: a pre-sign audit of everything a
  transaction spends, from its bytes alone. Per input it
  reports whether a spending proof is present and its
  length, and decodes the input's context extension
  entry by entry (key, type, value). It flags the same
  box listed as a spent input twice (a box can be spent
  only once), a context extension repeating a key on one
  input, and a data-input list that repeats a box or
  names a box the transaction also spends. What it
  cannot see is stated in its own copy: a present proof
  is not a verified one — validity belongs to the spent
  box's script and the Sigma protocol — and the inputs'
  value lives in the input boxes (tool 34). It composes
  the transaction parser rather than re-deriving its
  maths. Verified against an independent Python oracle
  over fleet-sdk's published transaction vectors plus
  two from-scratch synthetic transactions carrying a
  duplicated spend, overlapping and duplicated data
  inputs, and a duplicated extension key.
- **Signing round-trip checker** — compares two
  serializations of what should be the same transaction:
  the one shown before signing and the one a wallet
  returns after. Signing may change only the spending
  proofs; everything else is pinned by the transaction
  ID (computed over the unsigned form), so equal IDs
  prove the inputs, extensions, data inputs, token list
  and outputs are byte-identical outside the proofs,
  and the report lists which inputs gained, replaced or
  lost a proof — a removed proof being the case the ID
  itself cannot see. Different IDs are diffed section
  by section (inputs, data inputs, outputs) so the
  report says where the transaction moved. It composes
  the transaction parser rather than re-deriving its
  maths. Verified against an independent Python oracle
  over fleet-sdk's published transaction vectors plus
  from-scratch synthetic pairs: signing-only, proof
  removed, proof changed, an output value moved by one
  nanoERG, an extension constant changed, and a data
  input added.
- **Box differ** — compares two serialized boxes field
  by field and names exactly what moved: the value
  (with the signed nanoERG delta), the ErgoTree, the
  creation height (with the signed block delta), the
  tokens per token ID (added, removed, or amount
  changed), the registers R4–R9 (compared by their raw
  constant bytes, reported with type and decoded
  value), and the claimed provenance — creating
  transaction ID and output index. The box ID is
  reported for both sides but deliberately not diffed
  as a field: it is the hash of the whole
  serialization, so any change makes a different ID
  and diffing by it would report everything changed
  whenever anything did. It composes the box parser
  rather than re-deriving its maths. Verified against
  an independent Python oracle over fleet-sdk's
  published box vectors plus from-scratch one-field
  variants: value, token amount, height, index, and a
  register added, changed and removed.
- **Transaction size breakdown** — breaks one serialized
  transaction's byte length into the four sections the
  serialization carries, each with its share of the
  total: inputs (per input the 32-byte box ID, the
  proof and the context extension, count bytes
  included), data inputs and distinct token IDs
  (32 bytes each plus their counts), and outputs in
  their embedded form — smaller than the standalone
  form by exactly the creating transaction ID, the
  output index, and a full token ID per token in place
  of a short index. The sections are checked to sum to
  the byte length before anything is shown. It also
  reports the total proof bytes and their share, and
  the unsigned size — the length of the form the
  transaction ID is computed over. Size is stated as a
  fact about the bytes, never as a protocol limit or a
  cost figure. Verified against an independent Python
  oracle measuring the sections by raw byte offsets
  over fleet-sdk's published transaction vectors plus
  a from-scratch synthetic carrying a proof, extension
  entries, a data input, a token output and a register.
- **Transaction differ** — compares two serialized
  transactions field by field and names exactly what
  moved: inputs and outputs paired by position (one
  existing on only one side is added or removed at its
  position), per input the spent box, the proof
  classified as in the signing round-trip checker, and
  the context extension diffed per key by raw constant
  bytes; the data inputs and distinct token IDs diffed
  as sequences and as sets, so a pure reordering is
  named as one even though it still changes the
  transaction ID; per output the value with its signed
  nanoERG delta, the ErgoTree, the creation height with
  its signed block delta, the tokens per token ID and
  the registers by raw constant bytes — compared as
  written, never by the outputs' box IDs, which embed
  the transaction ID itself. The verdict follows the
  signing checker: identical, signing-only, or changed
  with the changed sections named. It composes the
  transaction parser rather than re-deriving its maths.
  Verified against an independent Python oracle over
  fleet-sdk's published transaction vectors plus
  from-scratch synthetic pairs: signing-only, an output
  value moved, a token amount moved, a register
  changed, an extension constant changed, data inputs
  reordered and removed, an input added and an output
  added.
- **Box set differ** — compares two sets of serialized
  boxes (one box per line in each) and names what
  changed between them: the boxes in both, the boxes
  that left and the boxes that arrived, and how the
  sets' ERG and per-token totals moved, with exact
  signed deltas. A box's identity is its box ID, so a
  box whose contents changed at all appears as one
  removed plus one added — the field-by-field story of
  two single boxes is the box differ's job. Membership
  ignores the pasted order, but a different order is
  reported as a fact. Both sides are totalled by the
  box set summarizer itself, with its strictness
  carried over: an unparseable line or a duplicated box
  on either side refuses the whole comparison with the
  side and line named. It fetches nothing and is not a
  live wallet balance. Verified against an independent
  Python oracle over fleet-sdk's published box vectors
  plus a from-scratch token-amount variant: identical,
  reordered, one box swapped, a token total changed and
  a strict subset.
- **Unsigned-form extractor** — takes one serialized
  transaction and returns the unsigned form its
  transaction ID is computed over: every input's
  spending proof replaced by a single zero length byte,
  everything else verbatim, as hex ready to paste into
  the transaction parser, the JSON converter or the
  differ. The extraction is verified before it is
  shown — the result must hash (Blake2b-256) to the
  transaction's own ID and re-parse as the same
  transaction, unsigned. It reports which inputs were
  stripped and how many bytes were removed in total,
  counting any proof-length VLQ bytes that shrank (a
  proof over 127 bytes has a multi-byte length). The
  unsigned form cannot be spent and the removed proofs
  are gone from the copy; no proof that was present
  was verified, only removed. Verified against an
  independent Python oracle: the fleet unsigned vectors
  are the identity, the fleet signed vector and two
  synthetics strip back to their exact unsigned forms
  (one of them to the differ's unsigned base vector,
  byte for byte), and a from-scratch 200-byte proof
  strips 201 bytes.
- **Transaction proof attacher** — the exact inverse of
  the extractor: takes an unsigned serialized
  transaction plus one spending proof per input, in
  input order (a single dash leaves an input
  unsigned), and splices each proof in as its VLQ
  length plus bytes, keeping box IDs, context
  extensions and every remaining byte verbatim.
  Attaching never changes the transaction ID — the
  ID is computed over the unsigned form — and the
  assembly is verified before it is shown: the
  result must re-parse with the same ID, every
  pasted proof must read back on its own input,
  every context extension must be unchanged, and
  the signing round-trip checker must agree the
  pair differs by signing only. A transaction that
  already carries a proof is refused plainly rather
  than have its proofs silently replaced. The
  proofs are spliced, never verified — a present
  proof is not a valid one. Verified against an
  independent Python oracle: strip-then-attach
  round-trips reproduce the fleet signed vector, the
  size section's synthetic, the differ's signed
  vector and a 200-byte-proof synthetic byte for
  byte (the 200-byte proof adds 201 bytes, its VLQ
  length included), a partial attach signs only the
  first of two inputs, and all-dash lines leave the
  fleet unsigned vectors byte-for-byte unchanged.

- **Transaction output box extractor** — takes a
  serialized transaction plus an output number and
  rebuilds that output as a standalone serialized
  box. Inside a transaction an output travels in an
  embedded form — no creating transaction ID, no
  output index, and each token named by an index
  into the transaction's distinct-token-ID list —
  which the box tools cannot read; the standalone
  form restores each token's full 32-byte ID, keeps
  the value, ErgoTree, creation height and registers
  verbatim, and appends the creating transaction's
  ID and the output index, which is exactly the byte
  string whose Blake2b-256 is the box ID the
  transaction parser already reports. Verified
  before it is shown: the rebuilt bytes must
  re-parse through the box parser with that same
  box ID and every field equal to the embedded
  output. Signing a transaction changes none of its
  output boxes (the signed and unsigned differ
  vectors extract identically). Honest boundary: the
  extracted box is the box the transaction creates
  if it is the one on chain — a pasted transaction
  may be unsubmitted, and bytes alone do not prove
  a box exists or is still unspent. Verified against
  an independent Python oracle over every output of
  the fleet vectors and the hub synthetics.

- **Transaction input proof extractor** — takes a
  serialized transaction plus an input number and
  returns that input's spending proof as hex (or the
  single dash the proof attacher takes as a proof
  line, when the input is unsigned), together with
  the box it spends and its context extension
  constants. The transaction parser reports a proof's
  length but not the proof itself, and the
  unsigned-form extractor lists proofs only as a side
  table — this lifts one proof out on its own, e.g.
  to carry into the proof attacher or to compare
  against a wallet's signing output. Verified before
  it is shown: the proof is located twice (parser and
  an independent raw-offset re-walk of the input
  section) and the two must agree byte-for-byte, and
  re-attaching every input's extracted proof line to
  the unsigned form must reproduce the pasted
  transaction exactly. Honest boundary: a proof is
  copied, never verified — extraction copies bytes,
  and bytes alone do not prove a proof satisfies the
  spent box's script. Verified against an independent
  Python oracle over the fleet vectors and the hub
  synthetics, including a 200-byte proof whose length
  VLQ is two bytes.

- **Transaction data-input extractor** — takes a
  serialized transaction plus a data-input number and
  returns that data input's box ID. A data input is a
  box a transaction's scripts read but never spend:
  it carries no proof, and its ERG and tokens do not
  enter the balance. The parser and the input auditor
  show data inputs only as an inline list; this lifts
  one out with its position, flags the odd case of a
  data input that is also spent by the same
  transaction, and returns the full list in order —
  the lines the transaction builder's data-inputs
  field takes, one box ID per line. Verified before
  it is shown: the box ID is located twice (parser
  and an independent raw-offset re-walk that must
  skip every input's proof and context extension
  constants to reach the data-input section at all)
  and the two must agree byte-for-byte, and the
  unsigned form must re-parse to the same
  transaction ID with the same data inputs in the
  same order — data inputs are signed over verbatim,
  so signing can never change them (the signed and
  unsigned differ vectors extract identically).
  Honest boundary: a data input is a reference, never
  content — extraction reads the ID from the pasted
  bytes and does not prove the named box exists on
  chain, is unspent, or holds what a script expects.
  Verified against an independent Python oracle over
  the fleet vectors and the hub synthetics.

- **Transaction token extractor** — takes a
  serialized transaction plus a token number and
  returns that entry of the transaction's
  distinct-token-ID list: the full token ID, the
  outputs that carry it with their amounts, its
  exact total across outputs, and whether this
  transaction mints it (a token whose ID equals the
  first input's box ID is minted by the transaction
  — exactly how a new token's ID is defined; every
  other listed token must have come in with the
  inputs). Every output names its tokens by index
  into this list, so the list is what gives every
  other token figure its meaning, yet the parser
  and the differ show it only inline. Verified
  before it is shown: the ID is located twice
  (parser and an independent raw-offset re-walk that
  must skip every input's proof and context
  extension constants and every data input to reach
  the token section at all) and the two must agree
  byte-for-byte, the unsigned form must re-parse to
  the same transaction ID with the same list in the
  same order — the list is signed over verbatim, so
  signing can never change it (the signed and
  unsigned differ vectors extract identically) — and
  the per-output amounts must sum exactly to the
  parser's total for the token. Honest boundary: an
  ID is an identifier, never a token — extraction
  reads it from the pasted bytes and does not prove
  the token exists on chain, what its name or
  decimals are, or that the inputs actually carried
  a non-minted token. Verified against an
  independent Python oracle over the fleet vectors
  and a from-scratch synthetic carrying two tokens
  split across outputs, one of them minted.

- **Transaction register extractor** — takes a
  serialized transaction plus an output number and
  a register name (R4–R9) and returns that one
  register of that one output: its Sigma type, its
  decoded value, its raw constant bytes (exactly
  what the sigma constant inspector takes on its
  own), the output's box ID, and the register's
  text when it is a Coll[SByte] holding printable
  UTF-8 — the form EIP-4 name, description and
  decimals registers take. Registers are where a
  box keeps its data, yet the parser and the
  output auditor only show them inline inside a
  whole output. Verified before it is shown: the
  register is located three times (the transaction
  parser, an independent raw-offset re-walk that
  must skip every input, data input, listed token
  ID and earlier output to reach this output's
  register section at all, and the output
  extractor's standalone box re-parsed with the
  box parser) and all three must agree on type,
  value and raw bytes byte-for-byte, and the
  unsigned form must re-parse to the same
  transaction ID carrying the same register —
  registers are signed over verbatim, so signing
  can never change them (the signed and unsigned
  differ vectors extract identically). Honest
  boundary: a register is content, never proof —
  extraction reads it from the pasted bytes and
  does not prove the output exists on chain as a
  box, that bytes shown as text were meant as
  text, or that any script reads the value the
  way a reader expects. Verified against an
  independent Python oracle over the fleet vectors
  and a from-scratch synthetic minting-style
  transaction whose issuance output carries
  EIP-4-style R4/R5/R6 byte-collection registers
  and an SLong R7.

- **Transaction context-extension extractor** —
  takes a serialized transaction plus an input
  number and an extension key (0–255) and returns
  that one entry of that one input's context
  extension: its Sigma type, its decoded value,
  its raw constant bytes (exactly what the sigma
  constant inspector takes on its own), the spent
  box's ID, the keys the input carries in total,
  and the entry's text when it is a Coll[SByte]
  holding printable UTF-8. A context extension is
  the key → constant map an input carries
  alongside its proof — the spent box's script
  reads those values by key when it runs — yet
  the parser and the input auditor only show the
  entries inline inside a whole input, and the
  input proof extractor returns the whole
  extension only alongside the proof. Verified
  before it is shown: the entry is located three
  times (the transaction parser, an independent
  raw-offset re-walk that must skip every earlier
  input exactly and decodes this input's whole
  extension again, and the input proof
  extractor's view of the same input) and all
  three must agree on every entry's key, type,
  value and raw bytes byte-for-byte, the raw
  constant must decode standalone to the same
  type and value, and the unsigned form must
  re-parse to the same transaction ID carrying
  the same entry — extensions are kept verbatim
  in the unsigned form, so signing can never
  change them (the signed and unsigned differ
  vectors extract identically). A key carried
  twice extracts its first entry and the result
  says how many times it occurs. Honest boundary:
  an extension value is content, never proof —
  extraction reads it from the pasted bytes and
  does not prove the spent box's script reads
  this key, or reads it as this type. Verified
  against an independent Python oracle over the
  fleet vectors, the hub synthetics and a
  from-scratch synthetic whose single input
  carries four entries (an SLong, two
  Coll[SByte]s — one holding the text "Ergo" —
  and an SInt at a higher key).

- **Transaction ErgoTree extractor** — takes a
  serialized transaction plus an output number
  and a network and returns that one output's
  ErgoTree on its own, in the exact form the
  ErgoTree inspector takes: the tree hex and
  byte length, its header analysis (version,
  size flag, constant segregation, declared
  size, proposition length), the output's box
  ID and value, and the addresses the tree
  corresponds to on the chosen network (an
  ErgoTree carries no network of its own, so
  only the addresses depend on the choice) —
  the P2PK address when the proposition is the
  standard ProveDlog form, the P2SH address
  the inspector derives, and the P2S address
  carrying the tree verbatim. A
  constant-segregated tree gets no P2SH
  address: its reference hash is taken over
  the proposition with its constants
  substituted back in, which raw tree bytes
  cannot reconstruct. Verified before it is
  shown: the tree is located three times (the
  transaction parser, an independent
  raw-offset re-walk that must skip every
  input, data input, listed token ID and
  earlier output exactly and delimits this
  output's tree the same three ways — fee
  contract, plain P2PK shortcut, header + VLQ
  size — and the standalone-box extractor's
  output re-parsed with the box parser) and
  all three must agree byte-for-byte, the
  tree must analyse through the ErgoTree
  inspector with agreeing header fields, its
  P2S form must build through the P2S builder,
  and the unsigned form must re-parse to the
  same transaction ID carrying the same tree —
  signing can never change an output (the
  signed and unsigned differ vectors extract
  identically). Honest boundary: an ErgoTree
  is the guard, never the proof — extraction
  reads it from the pasted bytes and does not
  prove the output exists on chain as a box or
  that anyone can satisfy the script. Verified
  against an independent Python oracle over
  the fleet vectors, the hub synthetics, the
  differ pair and a from-scratch synthetic
  carrying a size-flagged tree alongside a
  plain P2PK output.

- **Transaction output token extractor** — takes a
  serialized transaction plus an output number
  and a token number within that output and
  returns that one token entry expanded: its
  full 32-byte token ID (an embedded output
  names its tokens only by index into the
  transaction's distinct-token list), its
  exact raw amount, its position inside the
  output and its index in the distinct-token
  list, the output's box ID and ERG value, the
  output's full token list in order, and
  whether this transaction mints the token
  (its ID equals the transaction's first
  input's box ID). Verified before it is
  shown: the token is located three times (the
  transaction parser, an independent
  raw-offset re-walk that expands this output's
  token index through the distinct-token list
  it re-read, and the standalone-box
  extractor's output re-parsed with the box
  parser), the transaction-level token
  extractor's view of the same token must
  place the same amount in this output, and
  the unsigned form must re-parse to the same
  transaction ID carrying the same token in
  the same position — signing can never change
  an output. Honest boundary: a token entry is
  copied from the pasted bytes, never verified
  against the chain — extraction does not
  prove the output exists on chain as a box.
  Verified against an independent Python
  oracle over the fleet vectors, the differ
  pair and a from-scratch synthetic with two
  tokens split across two outputs, the second
  of them minted.

- **Transaction output register-set extractor** — takes a
  serialized transaction plus an output number
  and returns that output's complete register
  set in order: every register R4–R9 it
  carries, each with its Sigma type, decoded
  value, raw constant bytes and — for a
  Coll[SByte] holding printable UTF-8, the
  EIP-4 case — its text, alongside the
  output's box ID, ERG value and creation
  height, and the raw register-section hex
  exactly as serialized (register-count byte
  included). Where the register extractor
  lifts one register, this lifts the set as
  one record — a minting output's EIP-4 name,
  description and decimals only mean anything
  together. An output carrying no registers is
  refused plainly. Verified before it is
  shown: the set is located three times (the
  transaction parser, an independent
  raw-offset re-walk that skips every input,
  data input, listed token ID and earlier
  output, and the standalone-box extractor's
  output re-parsed with the box parser), every
  register must also extract on its own
  through the register extractor, and the
  unsigned form must re-parse to the same
  transaction ID carrying the same set —
  signing can never change an output. Honest
  boundary: a register set is content, never
  proof — extraction reads it from the pasted
  bytes and does not prove the output exists
  on chain as a box, that bytes shown as text
  were meant as text, or that any script will
  read the values the way you expect.
  Verified against an independent Python
  oracle over the fleet vectors, the differ
  pair and a from-scratch synthetic with two
  register-carrying outputs, the second
  holding a negative SLong and a text
  register.

- **Transaction input extension-set extractor** — takes a
  serialized transaction plus an input number
  and returns that input's complete context
  extension in order: every entry it carries,
  each with its key, Sigma type, decoded
  value, raw constant bytes and — for a
  Coll[SByte] holding printable UTF-8 — its
  text, alongside the spent box's ID, the
  input's key list, any key carried twice
  (reported, never merged), and the raw
  extension-section hex exactly as serialized
  (entry-count byte included). Where the
  context-extension extractor lifts one entry,
  this lifts the set as one record — an oracle
  or dApp input's parameters only mean
  anything together. An input carrying no
  entries is refused plainly. Verified before
  it is shown: the set is located three times
  (the transaction parser, an independent
  raw-offset re-walk that skips every earlier
  input and decodes this input's whole
  extension again, and the input proof
  extractor's view of the same input), every
  entry's raw constant must decode standalone
  through the Sigma constant inspector, every
  distinct key must extract on its own through
  the context-extension extractor, and the
  unsigned form must re-parse to the same
  transaction ID carrying the same set —
  extensions are kept verbatim in the unsigned
  form and signing can never change them.
  Honest boundary: an extension set is
  content, never proof — extraction reads it
  from the pasted bytes and does not prove
  the spent box's script reads these keys or
  reads them as these types. Verified against
  an independent Python oracle over the fleet
  vectors, the differ pair and a from-scratch
  synthetic with two extension-carrying
  inputs.

- **Transaction output token-set extractor** — takes a
  serialized transaction plus an output number
  and returns that output's complete token set
  in order: every token it carries, each
  expanded to its full 32-byte token ID with
  its position inside the output, its index in
  the transaction's distinct-token list, its
  exact raw amount and whether this transaction
  mints it (its ID equals the first input's box
  ID), alongside the output's box ID, ERG value
  and creation height, and the raw token-section
  hex exactly as serialized inside the output
  (token-count byte included — the section
  names tokens by index, so the hex is the
  compact form, not the expanded IDs). Where
  the output token extractor lifts one entry,
  this lifts the set as one record — a payment
  output's assets move together, and a minting
  output's set is the issuance itself. An
  output carrying no tokens is refused plainly.
  Verified before it is shown: the set is
  located three times (the transaction parser,
  an independent raw-offset re-walk that skips
  every input, data input and earlier output,
  re-reads the distinct-token list itself and
  expands this output's indexes through that
  re-read list, and the standalone-box
  extractor's output re-parsed with the box
  parser), every token must also extract on
  its own through the output token extractor,
  the transaction-level token extractor's view
  of each token must place the same amount in
  this output with the same minted flag, and
  the unsigned form must re-parse to the same
  transaction ID carrying the same set —
  signing can never change an output. Honest
  boundary: a token set is content, never
  proof — extraction reads it from the pasted
  bytes and does not prove the output exists
  on chain as a box or that the tokens are
  genuine instances of the assets their IDs
  name. Verified against an independent Python
  oracle over the fleet vectors, the differ
  pair and a from-scratch synthetic with two
  multi-token outputs whose first output's
  token indexes are out of distinct-list order
  and which carries one minted token.

- **Transaction data-input-set extractor** — takes a
  serialized transaction and returns its complete
  data-input set in order: every box ID the
  transaction's scripts read without spending, each
  flagged when the same transaction also spends that
  box, alongside the raw data-input-section hex
  exactly as serialized (count byte included) and
  the set in the transaction builder's
  one-box-ID-per-line form. Where the data-input
  extractor lifts one entry, this lifts the set as
  one record — a script reads its data inputs
  together, and their order is part of the signed
  bytes. A transaction carrying no data inputs is
  refused plainly. Verified before it is shown:
  the set is located twice (the transaction
  parser, and an independent raw-offset re-walk
  that skips every input exactly — box ID, proof
  and context extension constants — to reach the
  data-input section at all), every entry must
  also extract on its own through the data-input
  extractor with the same ID and also-spent flag,
  the input auditor must list the same set, and
  the unsigned form must re-parse to the same
  transaction ID carrying the same set —
  signing can never change a data input. Honest
  boundary: a data-input set is a list of
  references, never content — extraction reads
  the IDs from the pasted bytes and does not
  prove the named boxes exist on chain, are
  unspent, or hold what a script expects.
  Verified against an independent Python oracle
  over the fleet vectors, the differ pair and a
  from-scratch synthetic whose three-entry set
  carries the also-spent case in the middle.

- **Transaction input-set extractor** — takes a
  serialized transaction and returns its complete
  input set in order: every box the transaction
  spends, each with its proof length and proof
  bytes (or plainly none), its context extension's
  count, keys and every entry's type, value and
  raw constant, and its own raw serialized slice,
  alongside the signed-input count, total proof
  bytes, total extension entries, the raw
  input-section hex exactly as serialized (count
  byte included) and the spent box IDs one per
  line. Where the proof, extension and
  extension-set extractors lift one input or one
  entry, this lifts the set as one record — a
  transaction spends its inputs together, their
  order is part of the signed bytes, and the
  first input's box ID is also the ID of any
  token the transaction mints. Verified before
  it is shown: the set is located twice (the
  transaction parser, and an independent
  raw-offset re-walk of the input section that
  captures the section bytes as it goes), every
  input must also extract on its own through
  the input proof extractor, every
  extension-carrying input's set must extract
  through the extension-set extractor, the
  input auditor must list the same inputs with
  the same totals, the unsigned form must
  re-parse to the same transaction ID carrying
  the same box IDs and extensions with every
  proof stripped, and re-attaching every
  extracted proof line to that unsigned form
  must reproduce the transaction exactly.
  Honest boundary: an input set names boxes and
  carries their proofs and parameters, never
  the boxes' contents — extraction reads it
  from the pasted bytes and does not prove the
  named boxes exist on chain, are unspent, hold
  enough ERG or tokens, or that a present proof
  satisfies a box's script. Verified against an
  independent Python oracle over the fleet
  vectors, the differ pair and a from-scratch
  three-input synthetic covering
  signed+extension, unsigned+extension and
  signed+extensionless inputs.

- **Transaction output-set extractor** — takes a
  serialized transaction and returns its complete
  output set in order: every box the transaction
  creates, each with its box ID, value, ErgoTree,
  creation height, its complete token list
  (expanded token ID, amount, distinct-list index
  and minted flag per token), its complete
  register list, a fee-contract flag, its own raw
  serialized slice in the transaction's compact
  token-index form and its standalone box bytes,
  alongside the total output value, the total
  token and register entries, the minted-token
  count, the fee-output count, the raw
  output-section hex exactly as serialized (count
  byte included — the section is the
  transaction's suffix) and the created box IDs
  one per line. Where the box, token and register
  extractors lift one output or one part of one
  output, this lifts the set as one record — a
  transaction creates its outputs together, their
  order is part of the signed bytes (each box ID
  embeds its output index), and the set holds the
  transaction's whole value, its change, its fee
  output and any tokens it mints. Verified before
  it is shown: the set is located twice (the
  transaction parser, and an independent
  raw-offset re-walk that must skip every input,
  data input and distinct token ID exactly to
  reach the output section, expanding token
  indexes through the re-walked distinct list),
  every output must also extract on its own
  through the output box extractor, every
  token-carrying output's token set must extract
  through the output token-set extractor, every
  register-carrying output's register set must
  extract through the output register-set
  extractor, the output auditor must list the
  same outputs with the same total and fee
  outputs, and the unsigned form must re-parse
  to the same transaction ID carrying the same
  output set. Honest boundary: an output set is
  what the pasted bytes would create if the
  transaction were accepted — extraction reads
  it from the pasted bytes and does not prove
  the transaction is valid, will be accepted, or
  that the created boxes exist on chain yet.
  Verified against an independent Python oracle
  over the fleet vectors, a fee-contract
  transaction, a multi-token synthetic and a
  from-scratch synthetic whose three outputs
  combine a minted multi-token register-carrying
  output, a fee-contract output and a
  two-register output.

- **Transaction distinct-token-set extractor** —
  takes a serialized transaction and returns its
  complete distinct-token list in order: every
  token ID the transaction names, each with its
  minted flag (a token whose ID equals the first
  input's box ID is minted by this transaction),
  the total raw amount of it the outputs carry,
  and every output that carries it with that
  output's amount, alongside the minted-token
  count, the total token entries across all
  outputs, the raw distinct-token-section hex
  exactly as serialized (count byte included)
  and the token IDs one per line. Where the
  token extractor lifts one listed token, this
  lifts the set as one record — the distinct
  list is written once between the data inputs
  and the outputs, every output's compact token
  entries reference it by index, and its order
  is part of the signed bytes. A transaction
  listing no distinct token IDs is refused
  plainly. Verified before it is shown: the set
  is located twice (the transaction parser, and
  an independent raw-offset re-walk that must
  skip every input and data input exactly to
  reach the token section, capturing the section
  hex from that walk), every listed token must
  also extract on its own through the token
  extractor with the same total and minted flag,
  the output auditor must carry the same
  per-token totals and minted set, and the
  unsigned form must re-parse to the same
  transaction ID carrying the same list in the
  same order. Honest boundary: a token ID is an
  identifier, never a token — extraction reads
  the list from the pasted bytes and does not
  prove a listed token exists on chain, what
  its name or decimals are, or that the inputs
  actually carried a non-minted token in.
  Verified against an independent Python oracle
  over the fleet vectors, a fee-contract
  transaction, multi-token synthetics and a
  from-scratch synthetic whose three-token list
  has one token carried by two different
  outputs.

- **Block header inspector** — takes a
  serialized block header (the full bytes,
  Autolykos solution included) and returns every
  header field with the header ID recomputed and
  checked: version, parent ID, AD-proofs root,
  transactions root, the 33-byte state root,
  timestamp (VLQ, shown in milliseconds and ISO
  form), extension root, nBits with the
  difficulty decoded by the exact compact-bits
  algorithm, height, the 3 miner-vote bytes and
  any extra-fields bytes, plus the Autolykos
  solution — miner key and nonce on version 2+,
  and on version 1 the one-time key and distance
  d as well. An optional expected ID is compared
  against the recomputed one (Blake2b-256 over
  the full serialized header, the reference
  definition). Every other tool works below the
  header; this one opens the header itself.
  Verified before it is shown: the header is
  located twice (the field parser, and an
  independent offset-only re-walk that must land
  on the same boundaries and the same timestamp,
  height and nBits), the parsed fields must
  re-serialize byte-for-byte to the pasted
  bytes, and the walk must end exactly at the
  last byte. Honest boundary: inspection
  recomputes the ID and decodes the fields — it
  does not verify the Autolykos proof-of-work
  hit against the difficulty target, and an ID
  is only a hash of the pasted bytes, not proof
  the block sits on the main chain. Verified
  against an independent Python oracle over
  three real mainnet headers whose published
  IDs it reproduces bit-for-bit (versions 1, 2
  and 4, heights 3132, 471746 and 1890980) plus
  a from-scratch mutation whose ID only the
  oracle computes.

- **Block header builder** — the exact inverse
  of the inspector: header fields in (version,
  parent ID, the four roots, timestamp in
  milliseconds, nBits decimal or 0x hex, height,
  the 3 vote bytes, any extra-fields bytes, and
  the Autolykos solution values), serialized
  header bytes and header ID out. Version 1
  serializes miner key, one-time key, nonce and
  the length-prefixed distance d (minimal
  big-endian bytes; 0 as the single byte 0x00);
  version 2+ serializes only miner key and
  nonce, so version-1-only values are refused
  rather than silently dropped, exactly as
  extra-fields bytes are refused on version 1.
  The assembled bytes are re-inspected by the
  inspector and every field must come back
  identical before anything is shown. Honest
  boundary: building a header proves nothing
  about proof-of-work — it is a block only if
  a node accepts it; this is a serialization
  tool for study, testing and cross-checking
  explorer data, not a mining tool. Verified
  against an independent Python oracle that
  reproduces the three real mainnet headers
  and the inspector's mutation from fields
  alone, plus a version 3 synthetic carrying
  extra-fields bytes and a version 1 synthetic
  whose distance is 0.

- **Block header differ** — two serialized
  headers in, the field-by-field difference
  out, in wire order (version, parent ID, the
  four roots, timestamp, nBits and the
  difficulty decoded from it, height, votes,
  extra-fields bytes, and the Autolykos
  solution fields), plus exact height,
  timestamp and difficulty deltas and the
  first differing byte offset. Cross-version
  pairs are compared honestly: a field one
  layout does not serialize (extra fields on
  version 2+, one-time key and distance on
  version 1) reads as absent on that side.
  It also checks the chain's own stitching:
  whether the second header's parent ID names
  the first header's recomputed ID (it
  follows it), the reverse, the same header,
  or no link. A parent link proves only that
  one header names the other as its parent —
  not that either sits on the main chain, and
  no proof-of-work hit is verified. Verified
  against an independent Python oracle over
  the identical pair, the inspector's
  mutation pair, the cross-version v1/v2
  pair and a synthetic successor built by
  splicing one header's own ID into the
  other's parent slot.

- **Block header chain checker** — a run of
  serialized headers (one per line, in chain
  order) in, a step-by-step verdict out: for
  every step, whether the next header's
  parent ID names the previous header's
  recomputed ID, the exact height and
  timestamp deltas, and whether the height
  advances by exactly one. It lists the steps
  where the chain breaks, the linked steps
  whose height skips (a gap — headers missing
  from the list, or a height that disagrees
  with its link), the steps whose timestamp
  goes backwards, and any header that appears
  more than once. Only a run where every step
  is linked and every height advances by one
  earns the fully-sequential verdict. Every
  step is cross-checked against the header
  differ and the per-step deltas must sum to
  the first-to-last totals. A sequential run
  proves only that these headers stitch
  together in this order — not that any of
  them sits on the main chain, and no
  proof-of-work hit is verified. Verified
  against an independent Python oracle over a
  fully sequential three-header chain built
  by re-serializing a real header's fields
  with each predecessor's own ID, a broken
  chain, a linked height-gap pair, a reversed
  pair and a duplicated header.

- **Block header PoW extractor** — one
  serialized header in, its two halves out:
  the header without proof-of-work (every
  field up to the Autolykos solution — the
  bytes a miner iterates over, and the first
  half of the header ID's pre-image) and the
  Autolykos solution alone (version 2+: miner
  key and nonce, 41 bytes; version 1: miner
  key, one-time key, nonce and the
  length-prefixed distance d), each as its
  own hex record with every solution field.
  The solution bytes are re-parsed on their
  own from the split offset, the halves must
  concatenate back to the pasted header, the
  header builder must reproduce the identical
  split, and the without-PoW half alone must
  not inspect as a header. The without-PoW
  bytes alone have no header ID — the ID is
  Blake2b-256 over both halves together — and
  no proof-of-work hit is verified. Verified
  against an independent Python oracle over
  the three real mainnet headers, a mutation,
  a version 3 extra-fields synthetic and a
  version 1 zero-distance synthetic.
- **Block header PoW attacher** — the exact
  inverse of the extractor: the
  header-without-PoW bytes and an Autolykos
  solution in as separate hex records, the
  full serialized header and its recomputed
  ID out. The halves are parsed separately
  first — the without-PoW field walk must
  end exactly at its last byte (a full
  header or a truncated prefix is refused,
  never trimmed) and the solution walk,
  read against the version the prefix
  declares, must end exactly at its last
  byte too, so a version 1 solution can
  never attach to a version 2+ prefix or
  the reverse. The joined bytes must
  inspect with every field matching the
  separate parses, split back into exactly
  the halves supplied, and rebuild
  identically through the header builder.
  A well-formed solution from a different
  header joins cleanly and is reported as
  the new header it forms. Joining verifies
  no proof-of-work hit. Verified against an
  independent Python oracle over the six
  extractor splits rejoined to their exact
  headers, plus two cross-joins whose IDs
  only the oracle computes.

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
