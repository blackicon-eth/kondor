# Kondor Project Scaffolding Design

## Overview

Set up the monorepo folder structure and Next.js frontend scaffolding for Kondor, a web3 application that registers ENS subdomains and automatically swaps/stakes/redirects incoming crypto.

## Folder Structure

```
kondor/
├── frontend/          # Next.js app (App Router, TypeScript)
├── server/            # Node server (package.json placeholder)
├── workflows/         # Chainlink CRE workflows
├── contracts/         # Smart contracts
├── shared/
│   └── db/
│       └── db.schema.ts   # Drizzle schema shared across packages
└── KONDOR.md          # AI bootstrap document
```

Each top-level folder gets a `README.md` describing its purpose.

## Frontend (`/frontend`)

- **Framework:** Next.js (App Router, TypeScript)
- **ORM:** Drizzle ORM with `better-sqlite3` driver
- **Env validation:** Zod schema validating `DATABASE_URL`
- **Schema import:** TypeScript path alias `@shared/*` pointing to `../shared/*` so Drizzle config imports `shared/db/db.schema.ts`

## Shared Schema (`/shared/db/db.schema.ts`)

Uses `drizzle-orm/sqlite-core`:

| Column | Type | Constraints |
|--------|------|-------------|
| `seed_address` | text | Primary key (Ethereum wallet address) |
| `ens_subdomain` | text | Nullable |

## Server (`/server`)

A `package.json` with name `kondor-server` and minimal metadata. No dependencies yet.

## AI Bootstrap File (`KONDOR.md`)

Root-level file documenting: project mission, architecture, tech stack, folder purposes, and integration points (Chainlink CRE, ENS subdomains, Uniswap swap APIs).

## Out of Scope

- UI components or pages beyond Next.js defaults
- Smart contract code
- Server implementation
- Workflow definitions
- Database migrations (just schema definition)
