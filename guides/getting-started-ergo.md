# Getting started with Ergo

The resources I actually use, in the order I'd learn them. Every link below was
checked live when this guide was written.

## 1. Learn the model first

Ergo is a proof-of-work blockchain on the **eUTXO** model: funds live in
*boxes* that can carry data and native tokens, and contracts — written in
**ErgoScript** and built on Sigma protocols — guard how each box can be spent.
That model makes transaction behaviour and fees predictable before you submit
anything, which is the opposite of guessing.

- Official site: https://ergoplatform.org/
- Developer documentation: https://docs.ergoplatform.com/
- Ergo Platform on GitHub: https://github.com/ergoplatform

## 2. Watch the chain

- **Ergo Explorer** is the official window onto mainnet — blocks, boxes,
  transactions, tokens and addresses: https://explorer.ergoplatform.com/
- Check any address there first, then try the local address checker on the
  [Ergo Astronaut hub](https://kshot3000.github.io/Ergo-Astronaut-/): it verifies
  the address format (Base58, network/type byte, Blake2b-256 checksum) in your
  browser without sending the address anywhere.

## 3. Get a wallet — testnet first

- **Nautilus** is the browser wallet most Ergo dApps connect through:
  https://github.com/nautls/nautilus-wallet
- Practise on testnet before mainnet. Testnet ERG has no value — never pay
  for it, and never point testnet software at real funds.

## 4. Meet the ecosystem

- **Spectrum DEX** — AMM trading on Ergo: https://spectrum.fi/
- **SigmaUSD** — the AgeUSD stablecoin: https://sigmausd.io/
- **Rosen Bridge** — the decentralised Ergo ⇄ Cardano bridge:
  https://rosen.tech/ (app: https://app.rosen.tech/)
- **Fleet SDK** — the TypeScript toolkit for building Ergo dApps:
  https://fleet-sdk.github.io/docs/

## 5. My own corner of Ergo

- **Airlock**, my Ergo DEX (live quotes and order previews, settlement is the
  next phase): https://kshot3000.github.io/MY-ERGO-DEX/

## Ground rules I build by

- Local first: if a check can run in the user's browser (like the converter
  and address checker on the hub), it should never round-trip a server.
- Do money maths in integers (BigInt) — 1 ERG is exactly 1,000,000,000
  nanoERG, and floats have no place near it.
- Verify on the real chain data, label estimates as estimates, and never
  claim a feature is live until it is.

---

By Kyle Cox (@kshot9000) · Ergo Astronaut: https://github.com/Kshot3000/Ergo-Astronaut-
Tagging the Ergo team: @ergoplatform (GitHub) · @ergo_platform (X)
ERG donations: 9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy
