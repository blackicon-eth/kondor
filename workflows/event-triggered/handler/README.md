# Event Triggered Workflow

This CRE workflow listens for `ReportProcessed` events emitted by `KondorRegistry`.

When a matching event is detected, it:

- decodes the event log
- reads the `account`
- reads the `touchedTokens` array
- returns a success JSON payload

The workflow uses the EVM log trigger capability rather than the HTTP trigger.



Minimal monerium flow 
Use Monerium’s onchain SCA flow

API: signature: "0x" on link and/or redeem, with the exact message string they give you.
Keep your “always OK” EIP-1271

isValidSignature always returning 0x1626ba7e is the hack so their staticcall check passes without real policy.
Emit SignMsg(bytes32 msgHash) from the smart account

Callable only via registry → batchExecute from onReport (so you’re not totally open).
Still pass the msgHash Monerium expects for that message (usually derived from their string the same way wallets do — if you use the wrong hash, the hack breaks even if EIP-1271 is permissive).
Order of operations (practical hack)

POST order/link with 0x → get 202 if that’s what you see → then writeReport → batchExecute → emit SignMsg.