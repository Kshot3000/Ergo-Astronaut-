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
