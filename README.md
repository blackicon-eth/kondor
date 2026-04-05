# Kondor

> Programmable, private, automatic token policies activated by deposits on your ENS address.

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

**Kondor** is a web3 application that turns any ENS subdomain into a programmable, automated
treasury with built-in privacy.
Users register a human-readable subdomain (e.g. `alice.kondor.eth`), attach an
encrypted **token policy** to it, and then let crypto flow in. The moment funds arrive,
a Chainlink CRE workflow springs to life, decrypts the policy, and executes the user's
configured actions on-chain — swapping incoming assets and privately delivering them
to a Railgun zkAddress, or off-ramping everything to EURe via Monerium.

The problem we solve is simple: receiving crypto today is a passive experience. Funds sit
idle until you manually move them. Kondor turns a plain receiving address into an
**active, rule-driven endpoint**. Want incoming ETH to auto-swap 50% into USDC when ETH
is above $3000, and otherwise keep it as ETH? Want everything privately delivered to
your Railgun zkAddress, or off-ramped to your bank via Monerium? Configure it once, and
Kondor handles the rest.

Critically, **Kondor is non-custodial and privacy-preserving**. Policies are stored encrypted
inside the ENS text records of the user's subdomain. Only the user's wallet and the Chainlink
CRE workflow's key can decrypt them. Not even Kondor's own backend can read your rules.

---

## Architecture

```
                      +---------------------------+
                      |      User's Browser       |
                      |   (Next.js frontend)      |
                      |                           |
                      |  wallet signature         |
                      |       |                   |
                      |       v                   |
                      |  x25519 keypair           |
                      |       |                   |
                      |  ECDH(user, CRE pubkey)   |
                      |       |                   |
                      |       v                   |
                      |  AES-GCM(policy) -> b64   |
                      +-------------+-------------+
                                    |
                                    | set text record
                                    | key="kondor-policy"
                                    v
                    +---------------------------------+
                    |        ENS (on-chain)           |
                    |                                 |
                    |  alice.kondor.eth               |
                    |    addr = 0xABC...              |
                    |    text["kondor-policy"] = ...  |
                    +---------------+-----------------+
                                    ^
                                    | reads encrypted policy
                                    |
+----------------+     trigger      |
| Incoming funds | ---------------> |
| (ETH / ERC20)  |     on deposit   |
+----------------+                  |
                                    v
                    +---------------------------------+
                    |       Chainlink CRE             |
                    |  (Compute, Runtime, Execution)  |
                    |                                 |
                    |  1. fetch ENS text record       |
                    |  2. ECDH decrypt with CRE key   |
                    |  3. evaluate conditions         |
                    |  4. dispatch actions            |
                    +-------+-----------+-------------+
                            |           |
               +------------+                          |
               |            |                          |
               v            v                          v
          +---------+  +----------+              +-----------+
          | Uniswap |  | Railgun  |              | Monerium  |
          |  swap   |  | zkWallet |              |  EURe/IBAN|
          +---------+  +----------+              +-----------+
```

---

## Packages

Kondor is a **pnpm monorepo** with five top-level packages:

| Package                     | Description                                                                | README                                       |
| --------------------------- | -------------------------------------------------------------------------- | -------------------------------------------- |
| [`frontend/`](./frontend)   | Next.js App Router UI for subdomain registration and policy configuration  | [frontend/README.md](./frontend/README.md)   |
| [`server/`](./server)       | Backend API for off-chain orchestration, policy previews, and integrations | [server/README.md](./server/README.md)       |
| [`contracts/`](./contracts) | Solidity contracts for deploying smart accounts using stealth addresses    | [contracts/README.md](./contracts/README.md) |
| [`workflows/`](./workflows) | Chainlink CRE workflow definitions (event-triggered and HTTP-triggered)    | [workflows/README.md](./workflows/README.md) |
| [`shared/`](./shared)       | Shared TypeScript code: DB schema, crypto primitives, types, config        | [shared/README.md](./shared/README.md)       |

---

## How It Works

### 1. Register a subdomain

The user connects their wallet and claims `<name>.kondor.eth` via the registration
contract. The subdomain is set to resolve to the user's wallet address.

### 2. Build a policy

Using the policy builder UI, the user composes a token policy — a tree of **conditions**
and **actions**. Example:

```
WHEN token = ETH
  IF price(ETH) > $3000
    SWAP 50% -> USDC (via Uniswap)
    KEEP 50% as ETH
  ELSE
    KEEP 100% as ETH
```

Supported actions: `swap` (via Uniswap). Delivery is driven by two mutually-exclusive
user-level flags on the policy wrapper: `isRailgun` (default — all outputs routed to
the user's Railgun zkAddress) and `isOfframp` (all tokens forced to 100% EURe, delivered
to the user's Monerium IBAN; branching is disabled in this mode).

### 3. Encrypt the policy

Encryption happens entirely client-side, in the user's browser:

| Step | Operation                                                                   |
| ---- | --------------------------------------------------------------------------- |
| 1    | User signs a deterministic message with their wallet                        |
| 2    | The signature seeds an **x25519** keypair derivation                        |
| 3    | **ECDH** is performed between the user's private key and the CRE public key |
| 4    | The shared secret keys an **AES-GCM** cipher that encrypts the JSON policy  |
| 5    | Ciphertext + nonce are **base64**-encoded                                   |
| 6    | The blob is written to the ENS text record under the key `kondor-policy`    |

The result: the encrypted policy lives publicly on-chain, but **only the user** (via their
wallet signature) and **only the CRE workflow** (via its private key) can decrypt it.
Kondor itself holds no decryption material.

### 4. Funds arrive

When tokens land at the new ENS-resolved stealth address, a Chainlink CRE workflow is triggered.
The workflow:

1. Reads the `kondor-policy` text record from ENS.
2. Decrypts it using its side of the ECDH exchange.
3. Evaluates the policy's conditions against live on-chain data.
4. Dispatches the resulting swap actions on-chain (Uniswap swaps via API) and routes
   outputs according to the wrapper's delivery flag (Railgun shields or Monerium EURe
   offramp).

### 5. Delivery mode

By default (`isRailgun = true`), all outputs are shielded and delivered to the user's
Railgun zkAddress (stored in plaintext on the ENS `railgunAddress` text record),
breaking the public link between incoming and outgoing transactions. When the user
flips `isOfframp` on, CRE forces every incoming token to 100% EURe at runtime and
delivers it to the user's Monerium IBAN.

---

## Tech Stack

**Frontend**

- Next.js 15 (App Router) + React + TypeScript
- Tailwind CSS + shadcn/ui
- wagmi + viem for wallet connection
- Zod for env and schema validation

**Backend / Shared**

- Node.js + TypeScript
- Drizzle ORM over SQLite (`better-sqlite3`)
- Shared schema in `shared/db/db.schema.ts`

**Blockchain**

- Solidity + Foundry (in `contracts/`)
- ENS (subdomain registration, text records, public resolver)
- Chainlink CRE (Compute, Runtime, Execution) for automated workflows
- Uniswap v3/v4 Swap APIs
- Railgun for private routing
- Monerium for EURe off-ramp to IBAN

**Cryptography**

- x25519 (Curve25519) key derivation
- ECDH key agreement
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

Copy the example env file in each workspace that needs one:

```bash
cp frontend/.env.example frontend/.env.local
cp server/.env.example   server/.env
```

Fill in RPC URLs, ENS registry addresses, Chainlink CRE endpoints, and the CRE workflow
public key.

### Run the frontend

```bash
pnpm --filter frontend dev
```

### Run the server

```bash
pnpm --filter server dev
```

### Build contracts

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

| Integration       | Purpose                                                | Docs                                                  |
| ----------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| **ENS**           | Subdomain + encrypted text records + stealth addresses | https://docs.ens.domains/web/subdomains/              |
| **Chainlink CRE** | Trusted off-chain compute that decrypts and executes   | https://docs.chain.link/cre                           |
| **Uniswap**       | Swap actions inside policies via the Uniswap API       | https://api-docs.uniswap.org/guides/integration_guide |
| **Railgun**       | Privacy mode — zk shielding of outgoing transfers      | https://docs.railgun.org/                             |
| **Monerium**      | EURe off-ramp — deliver outputs to the user's IBAN     | https://monerium.com/                                 |

---

## Development Conventions

### Workspace structure

- Every package has its own `package.json` and `README.md`.
- Cross-package code (types, schema, crypto) lives in `shared/` and is imported as
  a workspace dependency: `"@kondor/shared": "workspace:*"`.
- The canonical DB schema is `shared/db/db.schema.ts`. All Drizzle configs point to it.
- Environment variables are validated with Zod in each package's `src/lib/env.ts`.

## License

MIT — built with care for **ETHGlobal Cannes 2026**.
