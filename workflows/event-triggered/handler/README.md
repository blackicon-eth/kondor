# Event-Triggered Handler

A Chainlink CRE (Compute, Runtime, Execution) workflow that listens for
`ReportProcessed` events emitted by the `KondorRegistry` contract and, when a
user account is flagged as sweepable, builds and submits a Railgun shield
batch so the freshly arrived tokens are moved into the user's private Railgun
balance.

This is the second stage of Kondor's execution pipeline: a time-triggered (or
HTTP-triggered) workflow first writes a report to the registry that calls the
user's smart account; the registry then emits `ReportProcessed`; **this**
workflow picks up that emission, fetches the resulting token balances, and
produces a follow-up report that performs the shield.

## Trigger

The workflow subscribes to an EVM log trigger (not HTTP):

- **Contract**: `config.registryAddress` (the `KondorRegistry`)
- **Topic**: `ReportProcessed(address,uint256,address[],bool,uint8)`
- **Confidence**: `CONFIDENCE_LEVEL_SAFE` by default (overridable via
  `config.confidence`)

Event ABI:

```
event ReportProcessed(
  address indexed account,
  uint256 callCount,
  address[] touchedTokens,
  bool    isSweepable,
  uint8   mode
)
```

## Execution Flow

When a `ReportProcessed` log arrives, `onReportProcessed` runs:

1. **Decode the log** with `viem.decodeEventLog` against the
   `ReportProcessed` ABI. The handler pulls `account`, `callCount`,
   `touchedTokens`, `isSweepable`, and `mode`.
2. **Skip reorg'd logs** — if `log.removed`, return early with
   `skipped: "removed-log"`.
3. **Skip non-sweepable accounts** — if `!isSweepable`, return early.
4. **Skip non-Railgun modes** — only `mode === 0` (Railgun) is handled here.
   Other modes return `skipped: "non-railgun-mode"`.
5. **Dedupe touched tokens** (case-insensitive on address).
6. **Fetch balances** for `account` across all touched tokens in a single
   Multicall3 `aggregate3` call (`allowFailure: true`), decoding each
   `balanceOf` return. Failed sub-calls become `balance: 0n`.
7. **Filter to positive balances.** If none, return
   `skipped: "no-positive-balances"`.
8. **Ask the Kondor server** (`POST {serverUrl}/railgun/shield-calls`) for
   the batched Railgun shield transactions, passing the token/balance pairs.
   The response is aggregated across CRE nodes with
   `consensusIdenticalAggregation` (all nodes must return the same bytes) and
   must match:
   ```json
   { "ok": true, "targets": ["0x..."], "values": ["..."], "calldatas": ["0x..."] }
   ```
9. **Build a CRE report payload** ABI-encoded as:
   ```
   (bytes32 magic, address account, address[] targets, uint256[] values,
    bytes[] calldatas, address[] touchedTokens)
   ```
   where `magic = keccak256("KONDOR_EVENT_REPORT_V1")`.
10. **Sign the report** via `runtime.report` (`encoderName: "evm"`,
    `signingAlgo: "ecdsa"`, `hashingAlgo: "keccak256"`).
11. **Submit on-chain** via `evmClient.writeReport` back to
    `config.registryAddress` with a 3,000,000 gas limit. The registry's
    `onReport` receiver decodes the payload and executes the batched shield
    calls through `batchExecute`.

The handler returns a JSON string summarising the outcome (emitter, account,
shielded tokens, `writeReportStatus`, `writeReportTxHash`, etc.).

## Config

`config.staging.json` / `config.production.json` (typed as `Config` in
`main.ts`):

| Field | Description |
| --- | --- |
| `registryAddress` | `KondorRegistry` address on the target chain (hex). |
| `chainSelectorName` | CRE chain selector name, resolved via `getNetwork({ chainFamily: "evm", chainSelectorName })`. |
| `serverUrl` | Base URL of the Kondor server that provides `/railgun/shield-calls`. |
| `confidence` | Optional log-trigger confidence level. Defaults to `CONFIDENCE_LEVEL_SAFE`. |

Current values:

- **staging** → Sepolia, registry `0xc6Ae83B8F8B92e07C6e807eb9957EBe01136f5cB`,
  server `http://localhost:3001`.
- **production** → Base mainnet (`ethereum-mainnet-base-1`), registry is a
  zero-address placeholder (not yet deployed).

Workflow names are set in `workflow.yaml`:
`event-handler-staging` and `event-handler-production`.

RPC endpoints live in `../project.yaml` and secrets in `../secrets.yaml`
(currently empty).

## Running Locally

Dependencies are installed with Bun:

```
bun install
```

`postinstall` runs `bun x cre-setup` from `@chainlink/cre-sdk`. The workflow
is deployed and simulated via the CRE CLI, targeting either
`staging-settings` or `production-settings` as defined in `workflow.yaml` and
`../project.yaml`.

There are no unit tests in this folder; verification happens through the CRE
simulator using the configured RPC (`https://1rpc.io/sepolia`) and the local
Kondor server at `http://localhost:3001`.

## Project Structure

```
workflows/event-triggered/
├── project.yaml              # CRE project settings (RPC URLs per target)
├── secrets.yaml              # Shared secrets (currently empty)
├── .gitignore
└── handler/
    ├── main.ts               # Workflow entrypoint, trigger + onReportProcessed
    ├── workflow.yaml         # CRE workflow settings (staging/production targets)
    ├── config.staging.json   # Sepolia config
    ├── config.production.json# Base mainnet config (placeholder registry)
    ├── package.json          # Bun package + cre-sdk/viem deps
    ├── tsconfig.json
    ├── memdown.d.ts          # Ambient module shim
    ├── bun.lock
    └── README.md
```

### Key functions in `main.ts`

- `initWorkflow(config)` — registers the log-trigger handler.
- `onReportProcessed(runtime, log)` — main event handler.
- `decodeReportProcessed(log)` — viem event decode.
- `fetchTouchedTokenBalances(...)` — Multicall3 `aggregate3` over `balanceOf`.
- `buildShieldBatchCalls(runtime, balances)` — calls
  `POST /railgun/shield-calls` with identical-aggregation consensus.
- `createEventReportPayload(...)` — ABI-encodes the report for
  `KondorRegistry.onReport`.
- `main()` — `Runner.newRunner<Config>().run(initWorkflow)`.
