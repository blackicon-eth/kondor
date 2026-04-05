# Kondor Server

Node.js/Express backend for Kondor. Acts as the central orchestrator between the
frontend, the ENS ecosystem, Alchemy webhooks, Uniswap routing, Railgun shielding
and the Chainlink CRE (Cross-chain Runtime Environment) workflows.

## Purpose

Kondor lets users register an ENS subdomain and attach a token-level policy
(conditional swaps delivered privately via Railgun, or forced EURe off-ramping
through Monerium) to it. The server is the piece that makes those policies
executable:

- Serves an **ERC-3668 CCIP-Read gateway** that resolves `*.<ENS_DOMAIN>` names
  offchain, signs the response with a trusted gateway signer, and mints a new
  stealth address per resolver query via a `predictAddress(salt)` call on the
  `KondorRegistry` contract.
- Registers each freshly minted stealth address with **Alchemy Notify**
  (Address Activity webhook on Base Sepolia) so incoming transfers can be
  detected in real time.
- On webhook receipt, looks up the stealth address → subdomain → encrypted
  `kondor-policy` text record, then spawns the **Chainlink CRE workflows**
  (`workflows/http-triggered` + `workflows/event-triggered`) with the
  ciphertext payload to simulate and broadcast the policy onchain.
- Wraps **Uniswap Trade API** (`/quote`, `/check_approval`, `/swap`) into a
  single EIP-5792 `batchExecute` calldata blob for the Kondor smart account.
- Builds **Railgun** shield-batch calldata (approve + shield) for a list of
  ERC-20 balances on Ethereum Sepolia.
- Persists users, text records, stealth addresses and Alchemy watch state in a
  **Turso / libSQL** database via Drizzle ORM (schema lives in
  `../shared/db/db.schema.ts`).

## Tech stack

- **Runtime**: Node.js (ESM), TypeScript 5.9, `tsx` for dev/watch
- **HTTP**: Express 5, `cors`
- **Onchain**: `viem` 2.x (Sepolia public client, signing, ABI encoding)
- **Database**: Drizzle ORM + `@libsql/client` (Turso)
- **Integrations**: `alchemy-sdk`, Uniswap Trade API (`axios`),
  `@railgun-community/engine` + `shared-models`
- **Shared code**: `@kondor/shared` workspace package (crypto, types, config,
  DB schema, utils)

## Architecture

```
                 ┌──────────────┐
                 │   Frontend   │
                 └──────┬───────┘
                        │  REST (register, update-policy, subdomain queries,
                        │        swap_5792, railgun/shield-calls)
                        ▼
ENS app ──► /gateway ──► Kondor Server (Express) ──► Turso (libSQL)
  (CCIP-Read)             │
                          │ onStealthAddressGenerated
                          ▼
                    Alchemy Notify (Base Sepolia, ADDRESS_ACTIVITY)
                          │
                          │ POST /webhooks/alchemy
                          ▼
                    stealthAddress → subdomain → kondor-policy (ciphertext)
                          │
                          ▼
                 spawn `cre workflow simulate` (http-triggered)
                          │      │
                          │      └─► writes report onchain (Sepolia)
                          ▼
                 read tx receipt → find ReportProcessed log index
                          │
                          ▼
                 spawn `cre workflow simulate` (event-triggered)
```

The encrypted `kondor-policy` record is produced by `POST /subdomains/update-policy`:
each token's `conditions` / `elseActions` are encrypted individually with
X25519 derived from the configured EdDSA keypairs (server private +
CRE public). Plaintext metadata (destination chain, isRailgun, isOfframp,
forwardTo, per-token decimals) stays readable so the webhook handler can
build the CRE payload without needing the key.

## API endpoints

All JSON endpoints respond `{ ok: boolean, ... }`.

### Health
- `GET /health` — reports whether Alchemy & Uniswap are configured, current
  ENS domain, and watched-address count.

### ENS CCIP-Read gateway
- `GET /gateway/:sender/:data` — ERC-3668 offchain resolver. Decodes the wrapped
  `resolve(bytes,bytes)` calldata, handles `addr`, `addr(coinType)`, `text` and
  `contenthash` lookups, derives a fresh stealth address via
  `KondorRegistry.predictAddress(keccak256(seedAddress, queryNonce+1))`, persists
  it, and returns EIP-3668-formatted `(bytes result, uint64 validUntil, bytes signature)`
  signed by `GATEWAY_SIGNER_PRIVATE_KEY`.

### Subdomains
- `GET /subdomains` — list every registered subdomain with records and stealth history.
- `GET /subdomains/:name` — one subdomain with text records + stealth addresses.
- `GET /getSubdomainByStealthAddress?address=0x...` — reverse lookup.
- `GET /getSubdomainBySeed?seedAddress=0x...` — lookup by user's seed EOA.
- `POST /subdomains/register` — body: `{ name, owner, seedAddress, text[], addresses[] }`.
- `POST /subdomains/update-text` — body: `{ name, text: [{ key, value }] }`.
- `POST /subdomains/update-policy` — body: `{ name, policy: { destinationChain,
  isRailgun, isOfframp, forwardTo?, tokens: [{ inputToken, inputDecimals,
  conditions, elseActions }] } }`. Each token's conditions/elseActions are
  X25519-encrypted and stored under the `kondor-policy` text record.

### Alchemy webhook
- `POST /webhooks/alchemy` — raw-body endpoint. Verifies
  `x-alchemy-signature` when `WEBHOOK_SIGNING_KEY` is set, filters for
  token/ERC-20 transfers to a watched address, removes the address from the
  watch list (to avoid swap-internal re-triggers), and kicks off the HTTP CRE
  workflow followed by the event-triggered workflow.

### Uniswap (EIP-5792)
- `POST /swap_5792` — body: `BatchSwap5792Request` (array of quote requests +
  optional `deadline`, `urgency`, `universalRouterVersion`,
  `includeApprovalCalls`). Fans out to `/check_approval`, `/quote` and `/swap`
  on the Uniswap Trade API, flattens approval-cancel / approval / swap
  transactions into a single `batchExecute(address[],uint256[],bytes[])`
  calldata payload for the smart account. See `policy.body.json` and
  `policy.curl.txt` for example requests.

### Railgun
- `POST /railgun/shield-calls` — body: `{ balances: [{ token, balance }] }`.
  Returns `{ targets, values, calldatas }` ready for a batched execute:
  ERC-20 `approve` to the Sepolia Railgun proxy followed by
  `shield(ShieldRequest[])` calls.

## Environment variables

Loaded from `server/.env` (via `src/env.ts`). Shared defaults come from
`../shared/config.ts`.

| Variable | Purpose |
|---|---|
| `EXPRESS_PORT` / `PORT` | HTTP port (default `3001`) |
| `CORS_ORIGIN` | Allowed origin for non-gateway routes (default `http://localhost:3000`) |
| `TURSO_DATABASE_URL` | libSQL / Turso connection URL |
| `TURSO_AUTH_TOKEN` | libSQL / Turso auth token |
| `ENS_DOMAIN` | Parent ENS name served by the gateway (e.g. `kondor.eth`) |
| `GATEWAY_SIGNER_PRIVATE_KEY` | Hex private key used to sign CCIP-Read responses |
| `KONDOR_REGISTRY_ADDRESS` | `KondorRegistry` address on Sepolia (stealth address prediction + ReportProcessed filter) |
| `SEPOLIA_RPC_URL` | Sepolia JSON-RPC for receipt lookup (default `https://1rpc.io/sepolia`) |
| `ALCHEMY_API_KEY` | Alchemy Notify API key (Base Sepolia) |
| `ALCHEMY_AUTH_TOKEN` | Alchemy dashboard auth token |
| `WEBHOOK_ID` | Existing Alchemy webhook ID (optional; auto-created if unset) |
| `WEBHOOK_URL` | Public URL where Alchemy POSTs events |
| `WEBHOOK_NAME` | Webhook display name (default `base-sepolia-address-activity`) |
| `AUTO_CREATE_WEBHOOK` | `true` / `false` — auto-create the webhook on boot |
| `WEBHOOK_SIGNING_KEY` | HMAC key for `x-alchemy-signature` verification |
| `UNISWAP_API_KEY` | Uniswap Trade API key (`x-api-key`) |
| `ASYM_KEY_EDDSA25519` | Ed25519 public key of the CRE (policy encryption target) |
| `ASYM_PRIV_KEY_EDDSA25519` | Ed25519 private key of the server (policy encryption source) |
| `AUTO_CHAIN_EVENT_CRE` | `false` to disable the automatic event-triggered CRE chain (default on) |

## Running locally

Requirements: Node.js 20+, `pnpm`, and the Chainlink `cre` CLI on `PATH`
(needed if you want `/webhooks/alchemy` to spawn the workflows).

```bash
# from the repository root
pnpm install

# inside server/
cp .env.example .env   # if present; otherwise create .env with the vars above
pnpm dev               # tsx watch src/index.ts
```

Database commands (Drizzle Kit, schema lives in `../shared/db/db.schema.ts`):

```bash
pnpm db:push      # push schema to Turso
pnpm db:generate  # generate migrations
pnpm db:migrate   # apply migrations
pnpm db:studio    # open Drizzle Studio
pnpm db:pull      # introspect remote schema
```

On startup the server logs its endpoint list and (if Alchemy is configured)
either reuses `WEBHOOK_ID` or creates a fresh ADDRESS_ACTIVITY webhook
pointed at `WEBHOOK_URL`.

## Project structure

```
server/
├── drizzle.config.ts          # Drizzle Kit config (Turso dialect)
├── package.json
├── policy.body.json           # Example /swap_5792 request body
├── policy.curl.txt            # Example curl invocation
├── tsconfig.json
└── src/
    ├── index.ts               # Express bootstrap + route wiring
    ├── env.ts                 # Loads server/.env
    ├── config.ts              # Env-derived config (extends shared config)
    ├── db.ts                  # Drizzle libSQL client (singleton)
    ├── addressStore.ts        # loadWatchedAddresses / saveWatchedAddresses
    ├── alchemyWebhookManager.ts  # Notify create / update-addresses wrapper
    ├── webhookHandler.ts      # POST /webhooks/alchemy pipeline
    ├── gateway.ts             # ERC-3668 resolver + subdomain CRUD
    ├── creTrigger.ts          # spawn `cre workflow simulate` (http + event)
    ├── reportReceipt.ts       # find ReportProcessed log index on Sepolia
    ├── uniswap.ts             # /swap_5792 batch builder
    ├── railgun.ts             # /railgun/shield-calls builder
    └── sepoliaTokens.ts       # Sepolia token decimals fallback table
```

The server depends on sibling paths inside the monorepo:

- `../shared/` — `@kondor/shared` workspace (crypto helpers, DB schema,
  shared config, types, utils).
- `../workflows/http-triggered` and `../workflows/event-triggered` — Chainlink
  CRE workflow projects invoked through the `cre` CLI.
