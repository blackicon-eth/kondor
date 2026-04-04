# Kondor Contracts

Solidity contracts that power Kondor: a web3 app where users register ENS
subdomains (`<username>.kondor.eth`) and configure automated token policies.
Policy execution is driven off-chain by a Chainlink CRE (Compute Runtime
Environment) workflow that posts reports to an on-chain registry, which in
turn deploys per-user smart accounts and routes calldata through them.

The repository is a Foundry project.

---

## 1. Purpose

Three contracts are deployed (or intended to be deployed) from this
repository:

1. **KondorRegistry** — A factory + router. It owns a deterministic
   `CREATE2` deployment of a `SimpleAccount` per user (keyed by a `bytes32`
   salt, typically derived from the user's `<label>.kondor.eth` ENS
   subdomain). It receives CRE workflow reports from the Chainlink Keystone
   Forwarder and batches calldata through the correct user's account.
2. **SimpleAccount** — A minimal smart account that holds the user's
   assets and executes arbitrary calldata on behalf of the registry (CRE)
   or the user's EOA. Implements EIP-1271 for signature validation.
3. **KondorOffchainResolver** — A CCIP-Read (EIP-3668) wildcard ENS
   resolver (ENSIP-10). Any lookup for `<username>.kondor.eth` is
   redirected to an off-chain gateway, which returns signed responses.

Together they let any user pick an ENS subdomain, get a deterministic
smart account under it, and have an off-chain workflow execute policy
actions (swaps, sweeps, shielding, off-ramping, forwarding) on that
account's balance.

---

## 2. Contract list

### 2.1 `src/KondorRegistry.sol`

Factory + router for salt-keyed smart accounts. Implements the Chainlink
CRE `IReceiver` interface.

Key state:

- `address forwarder` — trusted Chainlink Keystone Forwarder; only this
  address may call `onReport` (if set to `address(0)`, the check is
  bypassed — used for tests / manual ops).
- `address railgunShielder` — address of the Railgun shielder contract,
  exposed to accounts via `railgunShielder()`.
- `mapping(bytes32 => address) accounts` — salt → deployed SimpleAccount.

Key entrypoints:

- `onReport(bytes metadata, bytes report)` — called by the Keystone
  Forwarder. The report can be either:
  - an **initial report**, ABI-decoded as
    `(bytes32 salt, bytes32 hashedOwner, address[] targets,
     uint256[] values, bytes[] calldatas, address[] touchedTokens,
     bool isSweepable, uint8 mode)`. If the salt has no account yet, a
    new `SimpleAccount` is deployed via `CREATE2` and initialized. The
    calldata batch is then executed via the account's `batchExecute`.
    `mode` is `0 = Railgun` (private), `1 = OffRamp` (cash out),
    `2 = ForwardTo` (send to receiver).
  - an **event report** (prefixed by a magic constant
    `keccak256("KONDOR_EVENT_REPORT_V1")`), ABI-decoded as
    `(bytes32 magic, address account, address[] targets,
     uint256[] values, bytes[] calldatas, address[] touchedTokens)`.
    Runs `batchExecute` on an already-deployed account after verifying
    the target account points back at this registry.
- `createAccount(bytes32 salt, bytes32 hashedOwner)` — owner-only manual
  account deployment.
- `executeOnAccount(bytes32 salt, ...)` — owner-only manual batch
  execution against a user's account.
- `predictAddress(bytes32 salt)` — CREATE2 address preview.
- `setForwarder(address)` / `setRailgunShielder(address)` — owner admin.

Inherits `Ownable` (OpenZeppelin).

### 2.2 `src/SimpleAccount.sol`

Minimal smart-contract wallet deployed via `CREATE2` from `KondorRegistry`.

- Stores `bytes32 hashedOwner` (= `keccak256(abi.encodePacked(owner))`)
  and `address registry`.
- `initialize(bytes32 _hashedOwner, address _registry)` — one-shot init
  called by the registry right after CREATE2.
- `execute(address, uint256, bytes)` / `batchExecute(...)` — gated by
  `onlyAuthorized`: callable either by the registry or by an EOA whose
  address matches `hashedOwner`.
- `railgunShielder()` — proxies to `registry.railgunShielder()`.
- `isValidSignature(bytes32, bytes)` — EIP-1271 signature check. Note
  that the current implementation always returns the magic value
  `0x1626ba7e` (see "Security considerations" below).
- Accepts ETH via `receive()`.

### 2.3 `src/KondorOffchainResolver.sol`

CCIP-Read (EIP-3668) + wildcard (ENSIP-10) ENS resolver.

- `resolve(bytes name, bytes data)` unconditionally reverts with
  `OffchainLookup(address sender, string[] urls, bytes callData,
  bytes4 callbackFunction, bytes extraData)` pointing at the configured
  gateway URL. Clients (wagmi / viem / ethers / ens-app) catch the
  revert and fetch the answer from the gateway.
- `resolveWithProof(bytes response, bytes extraData)` is the CCIP-Read
  callback. It decodes `(bytes result, uint64 expires, bytes sig)`,
  reconstructs the message `keccak256(result, address(this), expires,
  keccak256(extraData))`, applies the EIP-191 prefix
  (`\x19Ethereum Signed Message:\n32`), and verifies the recovered
  signer matches the stored `signer`.
- Admin: `setUrl`, `setSigner`, `transferOwnership` (owner-only).
- Supports interface IDs `0x9061b923` (`IExtendedResolver`) and
  `0x01ffc9a7` (EIP-165).

### 2.4 `src/interfaces/IReceiver.sol`

Chainlink CRE consumer interface:

```solidity
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
```

---

## 3. Architecture

```
                       ┌──────────────────────────────┐
                       │  Chainlink CRE workflow      │
                       │  (off-chain)                 │
                       │  - evaluates user policies   │
                       │  - builds calldata batches   │
                       └──────────────┬───────────────┘
                                      │ signed report
                                      ▼
                       ┌──────────────────────────────┐
                       │  Keystone Forwarder          │
                       │  (Chainlink contract)        │
                       │  Sepolia:                    │
                       │  0x15fC6ae9...9101f9F88      │
                       └──────────────┬───────────────┘
                                      │ onReport(metadata, report)
                                      ▼
                       ┌──────────────────────────────┐
                       │       KondorRegistry         │
                       │  - CREATE2 account factory   │
                       │  - report router             │
                       │  - Ownable admin             │
                       └──────────────┬───────────────┘
                                      │ batchExecute(...)
                                      ▼
         ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
         │  SimpleAccount  │   │  SimpleAccount  │   │  SimpleAccount  │
         │  (alice salt)   │   │  (bob salt)     │   │  (...)          │
         └────────┬────────┘   └────────┬────────┘   └────────┬────────┘
                  │                      │                     │
                  │ arbitrary calls      │                     │
                  ▼                      ▼                     ▼
        Uniswap / Monerium / Railgun / ERC20.approve / transfer / ...

ENS side (independent flow):

      user: alice.kondor.eth  ─────►  ENS Registry
                                           │
                                     (wildcard record on kondor.eth
                                      resolver = KondorOffchainResolver)
                                           │
                                           ▼
                         KondorOffchainResolver.resolve()
                                 │ reverts OffchainLookup
                                 ▼
                           Gateway URL (off-chain)
                                 │ signed response
                                 ▼
                       resolveWithProof() verifies signer
```

Salts are typically derived from the full ENS subdomain label (see tests,
e.g. `keccak256("alice.Kondor")`), which means:

- There is a 1:1 mapping between an ENS subdomain and a `SimpleAccount`.
- The account address can be predicted *before* any transaction via
  `predictAddress(salt)`, so the frontend can show the user their future
  wallet address at subdomain-pick time.

---

## 4. ENS integration specifics

Kondor uses **wildcard ENS resolution** rather than minting a NameWrapper
NFT per user. That means:

- The parent name (`kondor.eth` or similar) is configured on the ENS
  Registry to use `KondorOffchainResolver` as its resolver.
- The resolver supports ENSIP-10 (`resolve(bytes name, bytes data)`),
  announced via `supportsInterface(0x9061b923)`.
- Any lookup for `<anything>.kondor.eth` hits the same on-chain resolver,
  which triggers CCIP-Read (EIP-3668) back to an off-chain gateway.
- The gateway signs records (addr, text, contenthash, etc.) with a
  key whose address is stored in `signer`. The signature format is:
  `personal_sign( keccak256(result, resolver, expires, keccak256(extraData)) )`
  with the standard `\x19Ethereum Signed Message:\n32` prefix.
- Records served by the gateway typically include an `addr(60)` pointing
  at the user's `SimpleAccount`, plus arbitrary text records (policy
  metadata, avatar, etc.). Text records are not stored on-chain — they
  live in the gateway's backing store.

Because NameWrapper is not involved, no ERC-1155 tokens are minted for
subdomains. Subdomain ownership/assignment is tracked off-chain by the
gateway.

---

## 5. Deployment addresses

### Sepolia (chainId 11155111)

Broadcast artefacts in `broadcast/DeployKondorRegistry.s.sol/11155111/`:

| Contract        | Address                                      |
| --------------- | -------------------------------------------- |
| KondorRegistry  | `0xc6ae83b8f8b92e07c6e807eb9957ebe01136f5cb` |

External addresses referenced by the test suite / integration:

| Name                        | Address                                      |
| --------------------------- | -------------------------------------------- |
| Chainlink Keystone Forwarder (Sepolia) | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |

`KondorOffchainResolver` has a deploy script
(`script/DeployOffchainResolver.s.sol`) but no broadcast artefact is
committed yet. The `railgunShielder` address is set post-deploy via
`setRailgunShielder`.

---

## 6. Build system — Foundry

The project uses **Foundry**. See `foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
```

Dependencies (git submodules, see `.gitmodules`):

- `forge-std`
- `openzeppelin-contracts`

Common commands (run from the `contracts/` folder):

```shell
# fetch submodules once after clone
forge install

# compile
forge build

# format
forge fmt

# gas snapshot
forge snapshot

# local node
anvil
```

### Deploy

```shell
# KondorRegistry
FORWARDER=0x15fC6ae953E024d975e77382eEeC56A9101f9F88 \
RAILGUN=0x...                                          \
forge script script/DeployKondorRegistry.s.sol:DeployKondorRegistry \
  --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $PRIVATE_KEY

# KondorOffchainResolver
GATEWAY_URL="https://gw.kondor.xyz/{sender}/{data}.json" \
GATEWAY_SIGNER_ADDRESS=0x...                             \
forge script script/DeployOffchainResolver.s.sol:DeployOffchainResolver \
  --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $PRIVATE_KEY
```

`FORWARDER` and `RAILGUN` are both optional and default to `address(0)`
(forwarder check disabled, no railgun shielder). They can be set later
via `setForwarder` / `setRailgunShielder`.

---

## 7. Running tests

```shell
forge test -vvv
```

Test files:

- `test/KondorRegistry.t.sol` — unit tests for account creation,
  CREATE2 address prediction, `onReport` deploy + batch execution
  (both initial and event reports), forwarder auth, manual
  `executeOnAccount`, `SimpleAccount.execute` auth, double-init
  protection, revert propagation through `batchExecute`, and the
  `forwarder == address(0)` bypass.
- `test/ForkKeystoneForwarder.t.sol` — **fork test** that pins Sepolia
  and low-level `call`s the real Keystone Forwarder with a pre-recorded
  transaction input. Requires RPC access:

  ```shell
  SEPOLIA_RPC_URL=https://... \
    forge test --match-contract ForkKeystoneForwarderTest \
               --match-test test_forwarderCall -vvvv
  ```

  Defaults to `https://1rpc.io/sepolia` if `SEPOLIA_RPC_URL` is unset.

---

## 8. Security considerations

A few things to be aware of — these reflect what is currently in the
code, not a formal audit:

- **`SimpleAccount.isValidSignature` is intentionally permissive.**
  Both branches currently return the EIP-1271 magic value
  `0x1626ba7e`, with an inline comment noting this is a temporary
  hack to "make the monerium test easier for now". This means any
  signature will be accepted as valid. Must be tightened before
  production.
- **Registry is fully authorized on every account.** The registry can
  call `execute` / `batchExecute` on every `SimpleAccount` it deploys.
  Compromise of the registry owner key (or of the Keystone Forwarder
  trust assumption) implies compromise of all user funds held in
  SimpleAccounts.
- **`onReport` can be called by anyone when `forwarder == address(0)`.**
  This mode exists for manual ops / tests. Production deployments must
  set `forwarder` to the real Keystone Forwarder.
- **Owner-derived hash is not a signature check.** `hashedOwner =
  keccak256(abi.encodePacked(owner))` is only used in `onlyAuthorized`
  to compare against `msg.sender`. There is no signature verification
  on `execute` itself — authorization is purely msg.sender-based.
- **Offchain resolver trust.** All records returned for
  `<x>.kondor.eth` are only as trustworthy as the gateway signer key.
  There is no on-chain allow-list per subdomain; the gateway is the
  single source of truth.
- **No reentrancy guard on `batchExecute`.** Because accounts are
  expected to interact with DeFi protocols that may callback, review
  the called contracts carefully. The account holds funds.

---

## 9. Network(s)

Current target network is **Ethereum Sepolia** (chainId `11155111`):

- `KondorRegistry` is deployed at
  `0xc6ae83b8f8b92e07c6e807eb9957ebe01136f5cb`.
- Chainlink Keystone Forwarder is at
  `0x15fC6ae953E024d975e77382eEeC56A9101f9F88`.
- Fork tests default to `https://1rpc.io/sepolia`.

Mainnet deployment is not yet published in this repository.
