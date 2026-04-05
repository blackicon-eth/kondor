# Kondor

## Stealth smart accounts, resolved by ENS subdomain, that automatically sweep incoming crypto — privately into Railgun or directly to your bank account.

<p>
  <img alt="ETHGlobal Cannes 2026" src="https://img.shields.io/badge/ETHGlobal-Cannes%202026-blue" />
  <img alt="Monorepo" src="https://img.shields.io/badge/monorepo-pnpm-orange" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-App%20Router-black" />
  <img alt="Solidity" src="https://img.shields.io/badge/Solidity-%5E0.8-363636" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

## What is Kondor?

**Kondor** gives you a human-readable address — `alice.kondor.eth` — that hides a **stealth smart account** behind it. Anyone who sends you tokens sees a plain ENS name. What they cannot see is that behind it sits a freshly-deployed, per-user smart contract that holds nothing until funds arrive and immediately executes your policy the moment they do.

The moment tokens land, a Chainlink CRE workflow wakes up, decrypts your rules from the ENS text record (encrypted with AES-GCM, readable only by you and the CRE), and routes everything according to two delivery modes:

- **Railgun mode** — outputs are privately shielded into your Railgun zkAddress. The public link between sender and recipient is broken. This is the mode for people who understand on-chain privacy.
- **Offramp mode** — outputs are force-converted to EURe and delivered directly to your bank account via Monerium. No exchange, no manual step, no waiting. Crypto in, euros in your IBAN.

The key insight: your ENS subdomain resolves to a stealth account that is **invisible until funded**, **non-custodial**, **encrypted at the policy layer**, and **converges — automatically — to either zk-private Railgun shielding or a real bank transfer**. You configure it once and forget it.

---

## Architecture

```
  Sender pays alice.kondor.eth
           │
           │  ENS resolves to a stealth
           │  smart account (CREATE2)
           ▼
  ┌─────────────────────────┐
  │  Stealth Smart Account  │  ← deployed per user, unknown address
  │  0xABC... (hidden)      │    until first interaction
  └────────────┬────────────┘
               │ deposit triggers CRE workflow
               ▼
  ┌─────────────────────────────────────────┐
  │            Chainlink CRE                │
  │  1. read encrypted policy from ENS      │
  │  2. ECDH-decrypt with CRE private key   │
  │  3. evaluate conditions (price, token)  │
  │  4. dispatch on-chain batch             │
  └──────────────┬──────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
  ┌──────────┐     ┌─────────────────┐
  │  Railgun │     │    Monerium     │
  │ zkShield │     │ EURe → your     │
  │ (private)│     │ bank account    │
  └──────────┘     └─────────────────┘

  Policy encryption (client-side, browser only):
    wallet.sign(msg)
      → x25519 keypair
      → ECDH(user, CRE pubkey)
      → AES-GCM(policy)
      → ENS text record "kondor-policy"
```

---

## Packages

Kondor is a **pnpm monorepo** with five top-level packages:

| Package                     | Description                                                                | README                                       |
| --------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| [`frontend/`](./frontend)   | Next.js App Router UI for subdomain registration and policy configuration  | [frontend/README.md](./frontend/README.md)   |
| [`server/`](./server)       | Backend API for off-chain orchestration, policy previews, and integrations | [server/README.md](./server/README.md)       |
| [`contracts/`](./contracts) | Solidity contracts for deploying stealth smart accounts via CREATE2        | [contracts/README.md](./contracts/README.md) |
| [`workflows/`](./workflows) | Chainlink CRE workflow definitions (event-triggered and HTTP-triggered)    | [workflows/README.md](./workflows/README.md) |
| [`shared/`](./shared)       | Shared TypeScript code: DB schema, crypto primitives, types, config        | [shared/README.md](./shared/README.md)       |

---

## How It Works

### 1. Claim your subdomain

The user connects their wallet and registers `<name>.kondor.eth`. The ENS subdomain resolves to a **stealth smart account address** — a deterministic CREATE2 address derived from the user's identity. The contract is not deployed yet; it materialises the first time the CRE workflow executes on it.

### 2. Build a policy

Using the policy builder UI, the user composes a token policy — a tree of **conditions** and **actions**:

```
WHEN token = ETH
  IF price(ETH) > $3000
    SWAP 50% → USDC (via Uniswap)
    KEEP 50% as ETH
  ELSE
    KEEP 100% as ETH
```

The policy is wrapped with one of two **delivery modes**:

| Mode | What happens to the output |
|------|---------------------------|
| **Railgun** (default) | All outputs privately shielded to your Railgun zkAddress — on-chain link to you is broken |
| **Offramp** | All tokens force-converted to EURe, sent to your verified IBAN via Monerium — crypto in, euros out |

### 3. Encrypt and publish

Encryption happens entirely client-side, inside the browser:

| Step | Operation |
| ---- | --------- |
| 1 | User signs a deterministic message with their wallet |
| 2 | The signature seeds an **x25519** keypair |
| 3 | **ECDH** between the user key and the CRE public key produces a shared secret |
| 4 | The shared secret keys **AES-GCM-256** encryption of the JSON policy |
| 5 | Ciphertext + nonce are **base64**-encoded |
| 6 | The blob is written to ENS text record `kondor-policy` |

The policy is on-chain and public — but unreadable without both the user's wallet signature and the CRE's private key. Kondor's backend holds neither.

### 4. Funds arrive → policy executes

When tokens land at the stealth address, the CRE workflow fires:

1. Reads `kondor-policy` from ENS.
2. Decrypts it with the CRE private key.
3. Evaluates conditions against live on-chain data (prices, balances).
4. Deploys the smart account if it doesn't exist yet (CREATE2).
5. Dispatches the batch: Uniswap swaps → Railgun shield **or** Monerium EURe redeem.

### 5. The two exits

**Railgun (privacy-first):** Outputs are wrapped as zk-shielded transfers to your Railgun zkAddress. The public trail from sender to recipient is severed. Suitable for users who want on-chain privacy.

**Monerium offramp (bank-first):** The CRE converts everything to EURe and places a Monerium redeem order signed by the smart account (ERC-1271 + on-chain `SignMsg`). Monerium burns the EURe and wires euros to your IBAN. No manual exchange, no bridging, no waiting.

---

## Tech Stack

**Frontend**

- Next.js 15 (App Router) + React + TypeScript
- Tailwind CSS + shadcn/ui
- wagmi + viem for wallet connection
- Privy for embedded wallet management
- Zod for env and schema validation

**Backend / Shared**

- Node.js + TypeScript
- Drizzle ORM over SQLite (`better-sqlite3`)
- Shared schema in `shared/db/db.schema.ts`

**Blockchain**

- Solidity + Foundry
- ENS (subdomain registration, text records, stealth address resolution)
- Chainlink CRE (Compute, Runtime, Execution) for automated on-chain workflows
- Uniswap v3/v4 Swap APIs
- Railgun for private zk shielding
- Monerium EURe for direct IBAN offramp

**Cryptography**

- x25519 (Curve25519) key derivation from wallet signature
- ECDH key agreement between user and CRE
- AES-GCM 256-bit authenticated encryption
- Base64 for text-record serialization

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **pnpm** 9+
- **Foundry** (for contracts)
- A funded testnet wallet

### Install

```bash
git clone https://github.com/<org>/kondor.git
cd kondor
pnpm install
```

### Environment

```bash
cp frontend/.env.example frontend/.env.local
cp server/.env.example   server/.env
```

Fill in RPC URLs, ENS registry addresses, Chainlink CRE endpoints, and the CRE workflow public key.

### Run

```bash
pnpm --filter frontend dev   # Next.js frontend
pnpm --filter server dev     # backend API
```

### Contracts

```bash
cd contracts
forge build
forge test
```

### Database

```bash
pnpm --filter frontend db:generate
pnpm --filter frontend db:migrate
```

---

## Key Integrations

| Integration       | Purpose                                                        | Docs                                                  |
| ----------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| **ENS**           | Subdomain resolution + encrypted text records + stealth addrs  | https://docs.ens.domains/web/subdomains/              |
| **Chainlink CRE** | Trusted off-chain compute that decrypts policies and executes  | https://docs.chain.link/cre                           |
| **Uniswap**       | Swap actions inside policies                                   | https://api-docs.uniswap.org/guides/integration_guide |
| **Railgun**       | Privacy mode — zk shielding, breaks on-chain sender/recipient link | https://docs.railgun.org/                         |
| **Monerium**      | Offramp mode — EURe burn → real euros wired to user's IBAN     | https://monerium.com/                                 |

---

## Development Conventions

- Every package has its own `package.json` and `README.md`.
- Cross-package code (types, schema, crypto) lives in `shared/` and is imported as a workspace dependency: `"@kondor/shared": "workspace:*"`.
- The canonical DB schema is `shared/db/db.schema.ts`. All Drizzle configs point to it.
- Environment variables are validated with Zod in each package's `src/lib/env.ts`.

---

## License

MIT — built with care for **ETHGlobal Cannes 2026**.
