# Event Triggered Workflow

This CRE workflow listens for `ReportProcessed` events emitted by `KondorRegistry`.

When a matching event is detected, it:

- decodes the event log
- reads the `account`
- reads the `touchedTokens` array
- returns a success JSON payload

The workflow uses the EVM log trigger capability rather than the HTTP trigger.
