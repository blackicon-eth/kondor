# @kondor/shared

Shared code consumed across the Kondor monorepo. This package is the single
source of truth for the Drizzle ORM database schema and hosts cross-package
utilities (crypto primitives, address helpers, environment config, and common
types) that are used by more than one workspace.

It is published inside the workspace as `@kondor/shared` (pnpm
`workspace:*`) and is imported from the `frontend` and `server` packages.

## Purpose

- Provide a single schema definition shared by every package that touches the
  database.
- Centralize reusable web3 / crypto helpers so that encryption, address
  normalization, and webhook verification stay consistent between the Next.js
  frontend and the Node server.
- Keep shared TypeScript types and environment configuration in one place to
  avoid drift between consumers.

## Package structure

```
shared/
├── db/
│   └── db.schema.ts     # Drizzle ORM schema (SQLite / Turso)
├── crypto.ts            # X25519 + AES-GCM encrypt/decrypt helpers
├── utils.ts             # Address + Alchemy webhook helpers
├── types.ts             # Shared TS types (Address, webhook payloads)
├── config.ts            # process.env-backed runtime config
├── package.json
└── README.md
```

### `package.json` exports

```jsonc
"exports": {
  "./db/*":  "./db/*",
  "./crypto": "./crypto.ts"
}
```

Only `./db/*` and `./crypto` are declared as package exports. The frontend
additionally aliases the entire folder through its `tsconfig.json`
(`"@kondor/shared/*": ["../shared/*"]`) and includes the package in
`transpilePackages` inside `next.config.ts`, which is why files such as
`utils.ts`, `types.ts`, and `config.ts` can still be imported by name from
consumer packages.

### Dependencies

- peer: `drizzle-orm` ^0.45.2 (provided by the consumer)
- runtime: `@noble/ciphers`, `@noble/curves`, `@noble/hashes`

## What's inside

### `db/db.schema.ts` — Drizzle ORM schema

The schema targets SQLite (Turso via `@libsql/client`) and is defined with
`drizzle-orm/sqlite-core`. There are three tables.

#### `users`

Holds the per-user seed account and its ENS subdomain state.

| Column | Type | Constraints / Notes |
| --- | --- | --- |
| `seed_address` | `text` | **Primary key**. User's seed Ethereum address. |
| `ens_subdomain` | `text` | Nullable. ENS subdomain owned by the user. |
| `text_records` | `text` | `NOT NULL`, default `"{}"`. JSON blob of ENS text records. |
| `coin_type` | `integer` | `NOT NULL`. ENSIP-11 SLIP-44 coin type. |
| `query_nonce` | `integer` | `NOT NULL`, default `0`. Monotonic query nonce. |
| `last_query_at` | `integer` (timestamp) | Nullable. Epoch seconds of last query. |
| `created_at` | `integer` (timestamp) | `$defaultFn(() => new Date())`. |
| `updated_at` | `integer` (timestamp) | `$defaultFn(() => new Date())`. |

#### `stealth_addresses`

Derived stealth addresses tied to a user's ENS subdomain.

| Column | Type | Constraints / Notes |
| --- | --- | --- |
| `address` | `text` | **Primary key**. Stealth address. |
| `ens_subdomain` | `text` | `NOT NULL`. Owning ENS subdomain. |
| `salt` | `text` | `NOT NULL`. Derivation salt. |
| `triggered` | `integer` (boolean) | `NOT NULL`, default `false`. |
| `last_triggered_at` | `integer` (timestamp) | Nullable. |
| `created_at` | `integer` (timestamp) | `$defaultFn(() => new Date())`. |

#### `watched_addresses`

Addresses currently registered with the Alchemy address-activity webhook.

| Column | Type | Constraints / Notes |
| --- | --- | --- |
| `address` | `text` | **Primary key**. |
| `added_at` | `integer` (timestamp) | `$defaultFn(() => new Date())`. |

### `crypto.ts`

X25519 ECDH + HKDF-SHA256 + AES-128-GCM payload encryption used by both
frontend and server. Exported:

- `hexToBytes(hex)`
- `ed25519PubToX25519(pub)` / `ed25519PrivToX25519(priv)`
- `encrypt(plaintext, senderPrivX25519, recipientPubX25519)` —
  returns `x25519:enc:<base64url-json>` with version tag.
- `decrypt(payload, privateKey, otherPartyPublicKey?)`
- `isEncrypted(value)`

### `utils.ts`

- `normalizeAddress(address)` — lowercase + trim
- `toChecksumAddress(address)` — EIP-55 checksum via keccak-256
- `dedupeNormalized(addresses)` — set-dedupe after normalization
- `chunk<T>(items, size)` — split an array into fixed-size chunks
- `verifyAlchemySignature(rawBody, signatureHex, signingKey)` —
  timing-safe HMAC-SHA256 verification of Alchemy webhook signatures

### `types.ts`

- `Address` — `\`0x${string}\``
- `AddressActivity` — Alchemy activity item shape
- `WebhookPayload` — Alchemy webhook envelope

### `config.ts`

Reads environment variables via an `optional(name, fallback)` helper and
exports a single `config` object with keys for Alchemy (`alchemyApiKey`,
`alchemyAuthToken`, `webhookId`, `webhookUrl`, `webhookName`,
`autoCreateWebhook`, `webhookSigningKey`), ENS (`ensDomain`,
`gatewaySignerPrivateKey`), and Uniswap (`uniswapApiKey`), plus the derived
booleans `hasAlchemyConfig` and `hasUniswapConfig`. Consumers should load
their own `.env` (e.g. via `dotenv/config`) before importing this module.

## Consumers

The following workspaces depend on `@kondor/shared`:

### `frontend` (Next.js)

- `frontend/package.json` — `"@kondor/shared": "workspace:*"`
- `frontend/next.config.ts` — `transpilePackages: ["@kondor/shared"]`
- `frontend/tsconfig.json` — path alias `"@kondor/shared/*": ["../shared/*"]`
- `frontend/drizzle.config.ts` — points `schema` at
  `../shared/db/db.schema.ts`
- `frontend/src/lib/db.ts` — `import * as schema from "@kondor/shared/db/db.schema"`
- `frontend/src/app/api/user/route.ts`,
  `frontend/src/app/api/user/ens/route.ts`,
  `frontend/src/app/api/user/text-records/route.ts` —
  `import { users } from "@kondor/shared/db/db.schema"`

### `server`

- `server/package.json` — `"@kondor/shared": "workspace:*"`
- `server/src/index.ts` — imports crypto helpers from
  `"@kondor/shared/crypto"`

No other workspace (`workflows`, `contracts`) currently imports
`@kondor/shared`.

## Running migrations

Drizzle Kit is **not** installed in `shared/`. All migration commands run
from `frontend/`, which owns the `drizzle.config.ts` that points back to
`../shared/db/db.schema.ts`. From `frontend/`:

```bash
pnpm db:generate   # generate SQL migration files from the schema
pnpm db:migrate    # apply pending migrations
pnpm db:push       # push schema directly to the DB (no migration files)
pnpm db:pull       # introspect the DB back into Drizzle
pnpm db:studio     # open Drizzle Studio
```

These scripts expect `TURSO_DATABASE_URL` and (optionally) `TURSO_AUTH_TOKEN`
in the frontend `.env`. Generated SQL lives in `frontend/drizzle/`.

When you change `shared/db/db.schema.ts`, regenerate migrations from
`frontend/` — do not add a duplicate Drizzle config inside `shared/`.

## How to add new shared code

1. **Prefer a new top-level file.** Put code in `shared/<name>.ts` and keep it
   focused (mirroring `crypto.ts`, `utils.ts`, `types.ts`).
2. **Schema changes live in `db/db.schema.ts`.** After editing, run
   `pnpm db:generate` from `frontend/` and commit the generated SQL
   alongside the schema change.
3. **Expose new entry points through `exports`** in `shared/package.json`
   when you want them callable by name from outside the frontend (the
   frontend already reaches any file via its path alias; the server only
   sees what is listed in `exports`).
4. **Keep dependencies minimal.** Runtime dependencies go in `dependencies`;
   anything the consumer already owns (such as `drizzle-orm`) stays a
   `peerDependency`.
5. **No framework-specific code.** Shared code must be importable from both
   a Next.js React Server Component context and a plain Node server, so
   avoid Next or React imports here.
6. **Only promote code to `shared/` when it has 2+ consumers.** Single-use
   helpers should stay in their owning package.
