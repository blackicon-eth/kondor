# Kondor Frontend

A Next.js 16 (Turbopack) web app for the Kondor project. Kondor lets users register
an ENS subdomain and attach an automated, encrypted token policy to it. Policies are
authored visually in a React Flow canvas, encrypted client-side with a key derived
from the user's embedded wallet signature, and stored as an ENS text record. The CRE
(Chainlink Runtime Environment) workflow consumes and executes them.

**Stack headline:** Next.js 16.2.2 + React 19 + Turbopack, Privy embedded wallets,
React Flow, Motion, shadcn/ui, Drizzle ORM on libsql (Turso), client-side X25519 +
AES-GCM encryption.

---

## Features

- One-click ENS subdomain registration under the Kondor parent name.
- Visual policy builder (React Flow) with conditional branching: "if token X > threshold,
  then split between a swap and the remaining source token; else ...".
- Per-token policies: each input token in a user's ENS text record can have its own flow.
- Client-side encryption of policy conditions and actions; only the CRE can decrypt them
  via ECDH.
- Two delivery modes, toggled at user level via `isOfframp`:
  - Railgun mode (default): outputs route to the user's Railgun zkAddress.
  - Offramp mode: every token is forced to 100% EURe swap, delivered to the user's Monerium IBAN.
- Silent signing with Privy embedded wallets (no wallet-UI interruptions, `showWalletUIs: false`).
- Dark-theme shadcn/ui components, custom SVG `TokenIcon` (no heavy web3 icon bundles).

---

## Architecture

The frontend is one workspace package inside the Kondor pnpm monorepo:

```
kondor/
├── contracts/    # Solidity contracts (ENS subdomain registry, etc.)
├── server/       # Backend services
├── workflows/    # Chainlink CRE workflow that reads and executes policies
├── shared/       # @kondor/shared — types & utilities shared across packages
├── frontend/     # <— this package
└── README.md     # Monorepo overview
```

Cross-references:

| Package | What it does | Path |
|---|---|---|
| Monorepo root | High-level docs & workspace setup | [`../README.md`](../README.md), [`../KONDOR.md`](../KONDOR.md) |
| `workflows` | CRE workflow that decrypts policies and executes on-chain | [`../workflows`](../workflows) |
| `contracts` | Smart contracts (ENS registrar, executor) | [`../contracts`](../contracts) |
| `server` | Off-chain services | [`../server`](../server) |
| `shared` | Cross-package types, imported as `@kondor/shared` | [`../shared`](../shared) |

The frontend talks to:

- **Privy** — auth + embedded wallet + silent signing.
- **Turso (libsql)** — user table (seed address, ENS subdomain, text records cache, nonces).
- **ENS** — subdomain registration + text-record writes via internal API routes.
- **CRE public key** — loaded from env, used as the ECDH recipient for encryption.

---

## Tech stack

**Framework & runtime**
- Next.js `16.2.2` (App Router, Turbopack dev + build)
- React `19.2.4`
- TypeScript `^5`

**Auth & wallets**
- `@privy-io/react-auth` `^3.19.0` (client)
- `@privy-io/node` `^0.12.0` (server verification)

**Policy builder & UI**
- `@xyflow/react` `^12.10.2` — React Flow, visual policy DAG
- `motion` `^12.38.0` — animations (migrated from framer-motion for smaller bundle)
- `shadcn/ui` + `@base-ui/react` — primitives, dark-themed
- `tailwindcss` `^4`, `tw-animate-css`
- `lucide-react`, `sonner` (toasts), `next-themes`

**Data & persistence**
- `drizzle-orm` `^0.45.2` + `drizzle-kit`
- `@libsql/client` `^0.17.2` (Turso)
- `@tanstack/react-query`, `ky` (HTTP), `zod`

**Crypto (client-side)**
- `@noble/curves` (x25519, ed25519 → montgomery conversion)
- `@noble/hashes` (sha256, hkdf)
- `@noble/ciphers` (AES-GCM)
- `jose` (server JWT verification for Privy)

---

## Project structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/test/           # dev-only auth probe
│   │   │   └── user/
│   │   │       ├── route.ts         # GET create-or-fetch user
│   │   │       ├── ens/route.ts     # POST register ENS subdomain
│   │   │       └── text-records/    # PUT merge updates
│   │   ├── dashboard/
│   │   │   ├── page.tsx             # redirects to first-token policy or empty state
│   │   │   └── [token]/page.tsx     # view/edit policy per input token
│   │   ├── new-policy/
│   │   │   ├── page.tsx
│   │   │   └── [token]/page.tsx     # create new policy for a token
│   │   ├── onboarding/              # 2-step wizard (ENS + first policy)
│   │   ├── profile/                 # Railgun zkAddress + destination wallet
│   │   ├── test/                    # dev-only test surface
│   │   ├── layout.tsx, providers.tsx, globals.css, page.tsx (landing)
│   ├── components/
│   │   ├── policy-flow.tsx          # React Flow policy builder (main canvas)
│   │   ├── add-token-modal.tsx
│   │   ├── navbar.tsx, footer.tsx, navigation-shell.tsx
│   │   ├── frozen-router.tsx        # route-transition freeze helper
│   │   ├── token-icon.tsx           # custom <TokenIcon> (SVGs in public/tokens)
│   │   └── ui/                      # shadcn primitives: button, checkbox, dialog,
│   │                                #   select, switch, sonner
│   ├── context/
│   │   └── user-context.tsx         # auth state + cached signature + decrypted policies
│   ├── hooks/
│   │   └── use-pathname-transition.ts
│   ├── lib/
│   │   ├── db.ts                    # Drizzle + libsql client
│   │   ├── env.ts                   # zod-validated env
│   │   ├── privy.ts                 # server-side Privy verification
│   │   ├── utils.ts                 # cn() etc.
│   │   └── policies/
│   │       ├── encrypt.ts           # x25519 + AES-GCM encrypt/decrypt
│   │       └── utils.ts             # FlowConfig ↔ PolicyJson, text-record builders
│   └── proxy.ts
├── public/
│   └── tokens/                      # ETH, USDC, WETH, WBTC, LINK, UNI SVGs
├── drizzle.config.ts
├── next.config.ts
├── AGENTS.md, CLAUDE.md
└── package.json
```

---

## Routes

### Pages

| Route | Purpose |
|---|---|
| `/` | Landing page |
| `/onboarding` | 2-step wizard: register ENS subdomain, then create first policy |
| `/dashboard` | Redirects to first policy token or renders the empty state |
| `/dashboard/[token]` | View/edit policy for a specific input token; switch tokens via `<Select>` |
| `/new-policy/[token]` | Create a new policy for a given input token |
| `/profile` | Manage Railgun zkAddress + forward-to destination wallet |

### API routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/user` | Fetch user by seed address, creating the row if missing |
| `POST` | `/api/user/ens` | Register an ENS subdomain (case-insensitive uniqueness) |
| `PUT` | `/api/user/text-records` | Merge-update the user's ENS text records |

All authenticated routes expect `Authorization: Bearer <privy-access-token>` and the
`x-seed-address` header (embedded-wallet address).

---

## Encryption flow

Policies are encrypted end-to-end between the user and the CRE. Only the user's
wallet signature + the CRE's public key can produce the shared AES key.

```
           ┌────────────────────────────────────────────────────┐
           │                   CLIENT (user)                    │
           │                                                    │
wallet ──► │ sign("kondor:derive-encryption-key")  → sigHex     │
           │         │                                          │
           │         ▼                                          │
           │   sha256(sigBytes)  → 32 bytes → x25519 priv key   │
           │         │                                          │
           │         │   ECDH                                   │
           │         ▼                                          │
           │   sharedSecret ◄─── CRE Ed25519 pub (montgomery)   │
           │         │                                          │
           │         ▼                                          │
           │   HKDF-SHA256 → 16-byte AES-128 key                │
           │         │                                          │
           │         ▼                                          │
           │   AES-128-GCM(iv || ct || tag)                     │
           └────────────────────────────────────────────────────┘
                                  │
                                  ▼
                    text record "kondor-policy"
                                  │
                                  ▼
           ┌────────────────────────────────────────────────────┐
           │                    CRE WORKFLOW                    │
           │   decrypts with its x25519 private key +           │
           │   the user's ephemeral pub from the payload        │
           └────────────────────────────────────────────────────┘
```

### Ciphertext format

Each encrypted blob is a string:

```
x25519:enc:<base64url(JSON {v, pub, ct})>
```

| Field | Meaning |
|---|---|
| `v` | payload version (`1`) |
| `pub` | base64url(sender x25519 public key, 32 bytes) |
| `ct` | base64url(iv ‖ ciphertext ‖ GCM tag), iv is 12 bytes |

Key derivation is deterministic: the same wallet always re-derives the same x25519
key by signing the same fixed message, which is why the user can decrypt their own
policy for viewing/editing in the dashboard (`decryptPolicy` in
`src/lib/policies/encrypt.ts`).

The signature is **cached in memory** in `UserContext` and used by a `useMemo` to
decrypt on demand — it is never stored on disk.

---

## Policy data model

### 1. `FlowConfig` (UI-side, from the React Flow canvas)

```ts
type FlowConfig = {
  sourceToken: string;                 // e.g. "USDC"
  branchingEnabled: boolean;           // if/else branch on or off
  condition: {
    token: string;                     // token to compare (e.g. "WETH")
    operator: "<" | ">";
    amount: number;                    // threshold
  };
  outcomeIf:   OutcomeConfig;          // split when condition true
  outcomeElse: OutcomeConfig;          // split when condition false
  outcome:     OutcomeConfig;          // split when branching disabled
  railgunWallet: string;               // 0zk… zkAddress (used when offramp mode OFF)
  moneriumIban: string;                // user's IBAN (used when offramp mode ON)
  offrampMode: boolean;                // mirrors PolicyJson.isOfframp
};

type OutcomeConfig = {
  swapToken: string;                   // output token for the swap leg
  swapPct: number;                     // % to swap
  offrampPct: number;                  // % to offramp (always 100 in offramp mode, else 0)
  destPct: number;                     // % that stays as the source token (the remainder)
};
```

### 2. `PolicyJson` (canonical, stored form)

```ts
type PolicyJson = {
  destinationChain: "ethereum-sepolia";
  isRailgun: boolean;
  isOfframp: boolean;
  forwardTo: string;
  tokens: PolicyToken[];
};

type PolicyToken = {
  inputToken: string;
  inputDecimals: number;
  conditions: {
    checks: { token: string; operator: "<" | ">"; threshold: number }[];
    actions: { actionType: "swap"; outputToken: string; percent: number }[];
  }[];
  elseActions: { actionType: "swap"; outputToken: string; percent: number }[];
};
// Offramp actions are swap actions where outputToken === "EURe".
```

The transform lives in `src/lib/policies/utils.ts`:

```
FlowConfig ──flowConfigToToken──► PolicyToken
                                        │
                            upsertPolicyToken(existingTokens, cfg)
                                        │
                                        ▼
                                   PolicyJson
                                        │
                                encryptPolicy()
                                        │
                                        ▼
                       EncryptedPolicy (per-token ciphertexts)
                                        │
                              buildTextRecord()
                                        │
                                        ▼
                  TextRecord written under the ENS name
```

### 3. Final ENS text record

```json
{
  "description": "<ens-name>'s policy",
  "railgunAddress": "0zk...",
  "kondor-policy": "{\"destinationChain\":\"ethereum-sepolia\",\"isRailgun\":false,\"isOfframp\":false,\"forwardTo\":\"0x...\",\"tokens\":[{\"inputToken\":\"USDC\",\"inputDecimals\":6,\"ciphertext\":\"x25519:enc:...\"}]}"
}
```

Note: only each token's `conditions` + `elseActions` are inside the ciphertext —
`inputToken`, `inputDecimals`, `destinationChain`, `isRailgun`, `isOfframp`, and
`forwardTo` remain plaintext so the CRE can pre-route without decrypting.

---

## Running locally

### Prerequisites

- Node.js 20+
- pnpm 10.25.0 (declared in `packageManager`)
- A Turso (libsql) database
- A Privy app
- The CRE's Ed25519 public key (hex)

### Environment

Create `frontend/.env` (or export in your shell):

| Variable | Where it's used | Example |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy client SDK + server verifier | `clz...` |
| `PRIVY_APP_SECRET` | Server-side Privy verification | `xxx` |
| `NEXT_PUBLIC_CRE_PUBLIC_KEY` | ECDH recipient key for encryption | `<ed25519 pub, hex>` |
| `TURSO_DATABASE_URL` | libsql client | `libsql://...` |
| `TURSO_AUTH_TOKEN` | libsql client | `ey...` |

Env is validated at boot by zod in `src/lib/env.ts` — missing values fail fast.

### Commands

```bash
# from the monorepo root, inside this package
pnpm install

# dev server (Turbopack)
pnpm dev

# production build / start
pnpm build
pnpm start

# Drizzle
pnpm db:generate    # generate migrations from schema
pnpm db:migrate     # apply migrations
pnpm db:push        # push schema directly (dev)
pnpm db:pull        # introspect existing DB
pnpm db:studio      # open Drizzle Studio

# lint
pnpm lint
```

---

## Development notes

### This is NOT the Next.js you know

Per `AGENTS.md`: Next.js 16.2.2 has breaking changes vs. what most training data
covers — APIs, conventions, and file structure differ. Before writing any code, **read
the relevant guide under `node_modules/next/dist/docs/`** and heed deprecation
notices. Do not pattern-match from older Next.js memory.

### Why dynamic routes instead of query params

The dashboard and new-policy flows previously used `nuqs` for `?token=...`
style state. It has been **removed** in favor of dynamic segments
(`/dashboard/[token]`, `/new-policy/[token]`) because:

- Hydration races with `useSearchParams` + `Suspense` boundaries were hard to
  contain.
- `FrozenRouter` page-transition animations conflicted with the searchParams
  store updating mid-transition.
- Dynamic segments give us a stable, SSR-friendly key for each page.

### Silent signing with Privy

Privy's `showWalletUIs: false` means signing happens without a modal. This is what
makes the encryption-key derivation ergonomic — the user signs the fixed message
once per session, it's cached in `UserContext`, and all subsequent decrypts are
instant (`useMemo`).

### Why a custom `<TokenIcon>`

`@web3icons/react` pulled in ~116 MB of assets. It was replaced with a tiny
`TokenIcon` component that renders SVGs from `public/tokens/`. To add a new token,
drop its SVG into `public/tokens/<SYMBOL>.svg`.

### Motion vs framer-motion

`motion` is the successor to `framer-motion`. We migrated for smaller bundle and
simpler imports; animation APIs in `policy-flow.tsx` and `navigation-shell.tsx` use
`motion/react`.

### No emojis

By convention, no emojis in source files, UI copy, or docs unless they already exist
in the codebase. Keep this README emoji-free.
