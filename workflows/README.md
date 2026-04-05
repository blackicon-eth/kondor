# Kondor Workflows

Chainlink CRE (Compute, Runtime, Execution) workflows that power Kondor's automated policy execution. When a user's Kondor smart account receives tokens, these workflows decrypt the user's on-chain policy, evaluate conditions against live market prices, and submit signed reports to `KondorRegistry` so the policy's actions (swap, shield, off-ramp, forward) are executed on-chain.

## Purpose

Kondor lets users deploy a CREATE2 smart account behind an ENS name and attach an encrypted policy to that ENS record. The policy describes what should happen to incoming tokens: swap them into a different asset, shield them through Railgun, off-ramp via Monerium, or forward them to another address, optionally gated by price conditions.

The workflows in this folder are what turns a static encrypted policy into on-chain execution. They run inside the Chainlink CRE DON (decentralized oracle network), hold the long-lived x25519 decryption key, and are the only parties in the system that can read a user's plaintext policy.

## How Chainlink CRE fits

Chainlink CRE is a verifiable off-chain compute platform: workflows are authored in TypeScript against the `@chainlink/cre-sdk`, uploaded to the Workflow Registry, and executed identically by multiple DON nodes whose results are aggregated via consensus. The nodes then sign a report and push it on-chain via `writeReport`.

- SDK: `@chainlink/cre-sdk` (see `handler/package.json`)
- Docs: https://docs.chain.link/cre
- Entry point on each workflow: `Runner.newRunner<Config>()` in `handler/main.ts`
- Project/workflow manifests: `project.yaml`, `handler/workflow.yaml`, `handler/config.{staging,production}.json`, `secrets.yaml`

### Trust model

The CRE workflow is the single trust boundary for user policy confidentiality:

- The DON holds an ed25519 signing key. That key is derived to an x25519 key for ECDH, and the matching public key is exposed to the frontend as `NEXT_PUBLIC_CRE_PUBLIC_KEY`.
- The private half lives only inside the CRE workflow, pulled at runtime via `runtime.getSecret({ id: "EDDSA_PRIVATE_KEY" })`.
- Anyone can read the encrypted policy (it's public, stored in ENS text records), but only the DON can decrypt it.
- Because the workflow runs on multiple nodes under consensus, no single node operator can unilaterally read or tamper with a user's policy.

## Encryption handoff

The end-to-end flow for protecting a user's policy:

1. Browser generates an ephemeral x25519 keypair.
2. Browser computes `shared = ECDH(userPriv, crePub)` where `crePub` comes from `NEXT_PUBLIC_CRE_PUBLIC_KEY`.
3. AES-128-GCM key is derived from `shared` via HKDF-SHA256 (`hkdf(sha256, shared, undefined, undefined, 16)`).
4. Plaintext policy JSON is encrypted, and the resulting envelope `{ v: 1, ct: base64(iv || ciphertext), pub: base64(userPub) }` is wrapped with the `x25519:enc:` prefix.
5. That blob is written to the ENS text record (`kondor-policy`) along with metadata.
6. When the workflow fires, it reads the envelope, recomputes `shared = ECDH(crePriv, userPub)`, derives the same AES key, and decrypts.

The decryption code on the CRE side lives in `http-triggered/handler/crypto.ts` (functions `decrypt`, `ed25519PrivToX25519`, `isEncrypted`) and uses `@noble/curves`, `@noble/hashes`, and `@noble/ciphers`.

## Workflow types

| Workflow | Trigger | Purpose | README |
| --- | --- | --- | --- |
| `event-triggered` | EVM log trigger on `ReportProcessed(address,uint256,address[],bool,uint8)` emitted by `KondorRegistry` | Second-stage sweep: after a policy's primary report lands, reads the touched-token balances of the user's smart account via Multicall3, asks the Kondor server for Railgun shield calls, then signs and writes a follow-up report that privately shields the resulting balances. | [event-triggered/handler/README.md](./event-triggered/handler/README.md) |
| `http-triggered` | HTTP trigger (`HTTPCapability`) | First-stage policy execution: receives an intent envelope (salt, sender, input token/amount, encrypted conditions), decrypts the policy, fetches prices from Portals, evaluates the condition tree, requests swap calldata from the Kondor server (`/swap_5792`), ABI-encodes a `KondorRegistry.onReport` payload, simulates via `eth_call`, then signs and writes the report to Sepolia. | [http-triggered/handler/README.md](./http-triggered/handler/README.md) |

Both workflows target the same `KondorRegistry` on Sepolia (configured as `registryAddress` in `config.{staging,production}.json`) on the `ethereum-testnet-sepolia` chain selector.

## Decryption flow

The user-facing policy lives in ENS text records, keyed as `kondor-policy`. Its shape is a JSON document whose per-token values can be either plaintext or an `x25519:enc:<base64>` ciphertext.

When the http-triggered workflow receives an intent envelope containing `ciphertext`:

1. `isEncrypted(envelope.ciphertext)` checks for the `x25519:enc:` prefix (or a bare base64 JSON blob).
2. The workflow loads its ed25519 private key from the `EDDSA_PRIVATE_KEY` secret and converts it to x25519 with `ed25519PrivToX25519` (Montgomery form, via `ed25519.utils.toMontgomeryPriv`).
3. `decrypt(ciphertext, servicePrivX)` parses the envelope `{ v, ct, pub }`, does ECDH against the embedded sender public key, HKDFs the shared secret to a 16-byte AES key, splits the 12-byte IV from the ciphertext, and runs AES-GCM.
4. The decrypted JSON yields `conditions: ConditionBranch[]` and `elseActions: Action[]` — the policy tree the workflow then evaluates.

If `ciphertext` is absent, the workflow falls back to the plaintext `conditions`/`elseActions` on the envelope (used for local tests via `payloadplain.body.json`).

## Policy execution

A decrypted policy is a list of condition branches plus an else branch. Each branch has:

- `checks`: array of `{ token, operator, threshold }` (operators: `<`, `>`, `<=`, `>=`, `==`, `!=`)
- `actions`: array of `{ actionType: "swap", outputToken, percent }` (swap is currently the only supported action type; off-ramping is driven implicitly by the top-level `isOfframp` flag and Railgun shielding by `isRailgun`, both carried in plaintext on the policy envelope)

Evaluation (see `onHttpTrigger` in `http-triggered/handler/main.ts`):

1. Collect every token referenced by the input and by checks, fetch their USD prices in one call to `https://api.portals.fi/v2/tokens` using `PORTALS_API_KEY` from secrets (Portals addresses are keyed off mainnet even when execution is on Sepolia).
2. Iterate branches in order. The first branch whose checks all pass is selected; otherwise `elseActions` wins. Empty-checks branches are skipped (not auto-matched).
3. For each `swap` action with `percent > 0`, build a Uniswap-style quote (`tokenIn`/`tokenOut` resolved to Sepolia addresses from the `SEPOLIA_TOKENS` table, `amount` computed as `inputAmount * percent/100 * 10^inputDecimals`, `type: "EXACT_INPUT"`, `swapper: intent.sender`).
4. POST the quotes to `${KONDOR_SERVER_URL}/swap_5792` with `includeApprovalCalls: true, executeBatchMethod: "batchExecute"`. The server returns `{ targets, values, calldatas }` — the Multicall3-style batch the smart account should execute.
5. Derive the mode: `0` Railgun, `1` OffRamp, `2` ForwardTo (from `isRailgun`/`isOfframp`/`forwardTo` on the envelope).
6. ABI-encode `(bytes32 salt, bytes32 hashedOwner, address[] targets, uint256[] values, bytes[] calldatas, address[] touchedTokens, bool isSweepable, uint8 mode)` — the exact argument order `KondorRegistry.onReport(metadata, report)` expects.
7. Simulate by posting an `eth_call` JSON-RPC to `https://ethereum-sepolia-rpc.publicnode.com` and log the revert reason if any.
8. Call `runtime.report({ encodedPayload, encoderName: "evm", signingAlgo: "ecdsa", hashingAlgo: "keccak256" })` to collect DON signatures, then `evmClient.writeReport({ receiver: registryAddress, report, gasConfig: { gasLimit: "3000000" } })` to push it on-chain.
9. On success the tx hash is logged as `KONDOR_WRITE_REPORT_TX_HASH:<hash>` — a machine-parseable marker the server scrapes to correlate with the `ReportProcessed` log, which is what wakes up the event-triggered workflow.

The event-triggered workflow then performs the Railgun shield leg (mode `0` + `isSweepable` only): Multicall3 `balanceOf` across `touchedTokens`, POST to `${serverUrl}/railgun/shield-calls`, build an event report with the magic `keccak256("KONDOR_EVENT_REPORT_V1")`, `encodeAbiParameters` it, sign with `runtime.report`, and `writeReport` it back to the registry.

## Local development

Each handler is a self-contained bun project with `@chainlink/cre-sdk` as the entry dependency.

```bash
# From a handler directory
cd workflows/http-triggered/handler   # or workflows/event-triggered/handler
bun install
```

Simulate from the workflow folder's parent (i.e. `workflows/http-triggered` or `workflows/event-triggered`):

```bash
cre workflow simulate ./handler --target=staging-settings
```

You'll need a `CRE_ETH_PRIVATE_KEY` env var (funded only if the simulated workflow writes on-chain). For the http-triggered workflow you also need `EDDSA_PRIVATE_KEY_ENV`, `PORTALS_API_KEY_ENV`, and `KONDOR_SERVER_URL_ENV` — see `http-triggered/secrets.yaml`. The event-triggered workflow does not bind any secrets (`event-triggered/secrets.yaml` is empty) since the server URL is in its config JSON.

`http-triggered/handler/payload.json` and `payloadplain.body.json` are example HTTP trigger payloads (encrypted and plaintext respectively) you can feed the simulator. `main.test.ts` contains the bun tests.

## Config files

- `project.yaml` — CRE project settings (RPC endpoints per target); both workflows point `ethereum-testnet-sepolia` at a public Sepolia RPC.
- `handler/workflow.yaml` — workflow registration: names the workflow (`event-handler-staging`, `handler-staging`, ...) and declares the paths of `main.ts`, the per-target config JSON, and `secrets.yaml`.
- `handler/config.staging.json` / `handler/config.production.json` — runtime `Config` passed to `initWorkflow`: `registryAddress`, `chainSelectorName`, and, for event-triggered, `serverUrl`; for http-triggered, `authorizedKeys` for the HTTP trigger.
- `secrets.yaml` — mapping from secret id to env var name, resolved per-target by the CRE CLI.
- `handler/.cre_build_tmp.js` — the bundled workflow artifact produced by `cre` builds (checked in but generated).

Key addresses used at the time of writing: `registryAddress = 0xc6Ae83B8F8B92e07C6e807eb9957EBe01136f5cB` on Sepolia, Multicall3 at the canonical `0xcA11bde05977b3631167028862bE2a173976CA11`.
