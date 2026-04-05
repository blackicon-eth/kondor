# http-triggered handler

A Chainlink CRE (Compute, Runtime, Execution) workflow that evaluates a user's
encrypted token policy on demand and submits a signed execution report to the
`KondorRegistry` contract on Sepolia. Unlike the event-triggered handler, this
workflow is fired by an HTTP request and is primarily used for testing, manual
execution, and integration with external services (for example, the Kondor
backend/server or a simple `curl` call).

## Purpose

Given an incoming JSON envelope that describes an intent and a set of
encrypted conditions/actions, this handler:

1. Decrypts the conditions with the CRE service's x25519 private key.
2. Fetches live token prices from Portals (Ethereum mainnet).
3. Evaluates the condition tree and picks the matching action branch (or the
   `elseActions` fallback).
4. Requests Uniswap swap calldata from the Kondor server (`/swap_5792`).
5. ABI-encodes a report matching `KondorRegistry.onReport` and signs/submits
   it through the CRE runtime to Sepolia.

## Trigger

The workflow registers a single HTTP trigger via `HTTPCapability.trigger(...)`
and `authorizedKeys` comes from the workflow config. There is no custom route
or path declared here — CRE exposes the trigger endpoint and gates it on the
authorized ECDSA/EVM keys configured in `config.*.json`.

### Request body (the HTTP `input` bytes)

The handler decodes `payload.input` as UTF-8 JSON with the following shape
(see `payload.json` and `payloadplain.body.json` for full examples):

```json
{
  "sender": "0x4070b28eD6c81ee2aD142BdC41d9DF87EDDcEA88",
  "forwardTo": "0x8da91A6298eA5d1A8Bc985e99798fd0A0f05701a",
  "salt": "0x0000...0000",
  "hashedOwner": "0x0000...0000",
  "chain": "ethereum-sepolia",
  "destinationChain": "ethereum-sepolia",
  "inputToken": "USDC",
  "inputAmount": 100,
  "inputDecimals": 6,
  "isRailgun": true,
  "isOfframp": false,
  "ciphertext": "eyJ2IjoxLCJwdWIiOiIuLi4iLCJjdCI6Ii4uLiJ9"
}
```

`ciphertext` is the base64 JSON blob `{v, pub, ct}`, optionally prefixed with
`x25519:enc:`. For testing, plaintext `conditions` and `elseActions` can be
sent in place of `ciphertext`.

The `receiver` is derived: if `isRailgun` or `isOfframp` is true, it is the
`sender` itself; otherwise it falls back to `forwardTo` (and then to `sender`
if `forwardTo` is absent). The mode byte is derived accordingly: `0 =
Railgun`, `1 = OffRamp`, `2 = ForwardTo`.

## Execution flow

Implemented in `onHttpTrigger` in `main.ts`:

1. **Parse envelope** — decode `payload.input`, `JSON.parse` the body.
2. **Decrypt** — if `ciphertext` is present and looks encrypted, fetch
   `EDDSA_PRIVATE_KEY` from CRE secrets, convert the ed25519 secret to x25519
   and decrypt `{conditions, elseActions}`. Otherwise use the plaintext
   fields from the envelope.
3. **Fetch prices** — collect every symbol used (`inputToken` plus every
   check token), build a Portals URL for the `ethereum` chain, and fetch
   via `HTTPClient` with `consensusIdenticalAggregation`. Auth header uses
   `PORTALS_API_KEY` from secrets.
4. **Evaluate conditions** — iterate `conditions[]`; for each branch, all
   checks must pass. First match wins. Branches with zero checks are
   skipped. If none match, `elseActions` is used. Aborts with `ok:false`
   if total percent > 100.
5. **Build quotes** — for every `action.actionType === "swap"` with
   `percent > 0`, build a Uniswap quote (Sepolia addresses resolved from
   `SEPOLIA_TOKENS`, atomic amount = `inputAmount * percent/100 * 10^decimals`).
6. **Request calldata** — POST the quote list to
   `${KONDOR_SERVER_URL}/swap_5792` with
   `{quotes, includeApprovalCalls: true, executeBatchMethod: "batchExecute"}`.
   The server returns `{targets, values, calldatas}`.
7. **Encode report** — ABI-encode
   `(bytes32 salt, bytes32 hashedOwner, address[] targets, uint256[] values,
   bytes[] calldatas, address[] touchedTokens, bool isSweepable, uint8 mode)`.
   `touchedTokens` contains the input token plus each swap output token,
   `isSweepable=true`.
8. **Simulate** — `eth_call` against the configured `registryAddress` on
   Sepolia (`https://ethereum-sepolia-rpc.publicnode.com`) using the
   `onReport(bytes, bytes)` selector to surface reverts in the CRE logs.
9. **Sign & submit** — `runtime.report(...)` with `encoderName=evm`,
   `signingAlgo=ecdsa`, `hashingAlgo=keccak256`, then
   `EVMClient.writeReport(...)` to the registry with `gasLimit=3_000_000`.
   On success, logs the tx hash and a machine-parseable line:
   `KONDOR_WRITE_REPORT_TX_HASH:<hash>`.

The handler returns a JSON string containing `ok`, `salt`, `sender`,
`receiver`, `prices`, `selectedActions`, `batchSize`, `encodedReport`, and
(if submitted) `writeReportTxHash`.

## Decryption

See `crypto.ts`. The service holds an ed25519 private key (`EDDSA_PRIVATE_KEY`
as hex, sourced via `runtime.getSecret`). It is converted to x25519 using
`ed25519.utils.toMontgomeryPriv`. The envelope ciphertext follows the
`x25519:enc:<base64 JSON>` format:

- `v` — payload version (currently `1`)
- `pub` — base64 x25519 public key of the other party (the frontend)
- `ct` — base64 `IV (12 bytes) || AES-GCM ciphertext`

The shared secret is computed with `x25519.getSharedSecret`, run through
HKDF-SHA256 to a 16-byte AES key, and used to decrypt the ciphertext via
AES-128-GCM. The plaintext is a JSON object with `conditions` and
`elseActions`.

## Action execution

`actionType` is narrowed to `"swap"` only; the frontend never emits other
action types. Swap execution goes through the Kondor server's `/swap_5792`
endpoint, which returns the Uniswap approval + swap calls ready for
`batchExecute`. These are then wrapped into the Kondor registry report and
submitted via `writeReport`.

Offramp routing is driven entirely by the `isOfframp` flag on the envelope
(plaintext, not encrypted). When `isOfframp=true`, the frontend does not
emit per-token EURe swap actions; instead the CRE forces 100% of every
token to EURe at runtime and delivers to the user's Monerium IBAN.
Branching (IF/ELSE) is disabled in offramp mode. When `isOfframp=false`
(the default, Railgun mode), outputs are delivered to the user's Railgun
zkAddress.

## Config

The `Config` type (`types.ts`) consumed by `initWorkflow` / `onHttpTrigger`:

```ts
type Config = {
  authorizedKeys: Array<{ type: "KEY_TYPE_ECDSA_EVM"; publicKey: string }>;
  registryAddress: string;       // KondorRegistry on the target chain
  chainSelectorName: string;     // e.g. "ethereum-testnet-sepolia"
};
```

- `config.staging.json` — registry `0xc6Ae83B8F8B92e07C6e807eb9957EBe01136f5cB`
  on `ethereum-testnet-sepolia`.
- `config.production.json` — currently a zero-address registry on
  `ethereum-mainnet-base-1` (placeholder).

Secrets (declared in `../secrets.yaml`, pulled via `runtime.getSecret`):

- `EDDSA_PRIVATE_KEY` — hex ed25519 private key for decryption.
- `PORTALS_API_KEY` — bearer token for the Portals price API.
- `KONDOR_SERVER_URL` — base URL of the Kondor backend exposing `/swap_5792`.

Workflow targets are defined in `workflow.yaml` (`staging-settings` and
`production-settings`). Project-level RPCs live in
`../project.yaml`.

## Running locally

Install dependencies and simulate from the project root
(`workflows/http-triggered/`):

```bash
bun install
cre workflow simulate ./handler --target=staging-settings
```

You will need a `.env` (at the CRE project root) with `CRE_ETH_PRIVATE_KEY`
and the secret envs referenced by `secrets.yaml`:

```
CRE_ETH_PRIVATE_KEY=<funded sepolia key or dummy if not writing>
EDDSA_PRIVATE_KEY_ENV=<hex ed25519 secret>
PORTALS_API_KEY_ENV=<portals api key>
KONDOR_SERVER_URL_ENV=https://<your kondor server>
```

### Unit tests

The Bun test suite in `main.test.ts` mocks `HttpActionsMock` and exercises the
condition evaluation and action planning:

```bash
bun test handler/main.test.ts
```

### Example request

Once the workflow is deployed and the HTTP trigger URL is known, a manual
invocation looks like this (body taken from `payload.json`):

```bash
curl -X POST "$CRE_HTTP_TRIGGER_URL" \
  -H "Content-Type: application/json" \
  --data @handler/payload.json
```

For local simulation runs, the CRE CLI feeds `payload.json` (or
`payloadplain.body.json` for the unencrypted variant) through the simulator's
HTTP trigger input.

## Project structure

```
handler/
  main.ts                  onHttpTrigger + initWorkflow (entry point)
  crypto.ts                x25519 / AES-GCM decryption helpers
  types.ts                 Config, Intent, Action, ConditionBranch, Mode
  main.test.ts             Bun test suite (condition eval, else branch)
  workflow.yaml            CRE workflow targets (staging/production)
  config.staging.json      Sepolia registry + chainSelectorName
  config.production.json   Base-mainnet placeholder config
  payload.json             Example encrypted HTTP request body
  payloadplain.body.json   Example plaintext HTTP request body
  package.json             bun + @chainlink/cre-sdk
  tsconfig.json
../project.yaml            CRE project settings & RPCs
../secrets.yaml            Secret name -> env var mapping
```
