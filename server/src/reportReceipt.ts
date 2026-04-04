import { createPublicClient, http, keccak256, toBytes, type Hex } from "viem";
import { sepolia } from "viem/chains";

/** Must match KondorRegistry `ReportProcessed` and event-triggered workflow filter. */
export const REPORT_PROCESSED_TOPIC: Hex = keccak256(
  toBytes("ReportProcessed(address,uint256,address[],bool,uint8)")
);

/**
 * Index of the log in `receipt.logs` (0-based) for the first ReportProcessed from `registryAddress`.
 * CRE `--evm-event-index` uses this enumeration order for the tx receipt.
 */
export function findReportProcessedLogIndex(
  logs: ReadonlyArray<{ address: string; topics: readonly Hex[] }>,
  registryAddress: string
): number {
  const reg = registryAddress.toLowerCase();
  const topic = REPORT_PROCESSED_TOPIC.toLowerCase();
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    if (log.address.toLowerCase() !== reg) continue;
    const t0 = log.topics[0];
    if (t0?.toLowerCase() === topic) return i;
  }
  return -1;
}

export async function fetchReportProcessedLogIndex(
  rpcUrl: string,
  txHash: Hex,
  registryAddress: string
): Promise<number> {
  const client = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (!receipt) return -1;
  return findReportProcessedLogIndex(receipt.logs, registryAddress);
}
