import {
  EVMClient,
  Runner,
  bytesToHex,
  getNetwork,
  handler,
  hexToBase64,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeEventLog, keccak256, parseAbi, toBytes, type Hex } from "viem";

export type Config = {
  registryAddress: Hex;
  chainSelectorName: string;
  confidence?:
    | "CONFIDENCE_LEVEL_SAFE"
    | "CONFIDENCE_LEVEL_LATEST"
    | "CONFIDENCE_LEVEL_FINALIZED";
};

type TriggerLog = {
  address: Uint8Array;
  topics: Uint8Array[];
  txHash: Uint8Array;
  data: Uint8Array;
  removed: boolean;
};

const REPORT_PROCESSED_ABI = parseAbi([
  "event ReportProcessed(address indexed account, uint256 callCount, address[] touchedTokens, bool isSweepable, uint8 mode)",
]);
const REPORT_PROCESSED_TOPIC = keccak256(
  toBytes("ReportProcessed(address,uint256,address[],bool,uint8)")
);

function decodeReportProcessed(log: TriggerLog) {
  if (log.topics.length === 0) {
    throw new Error("ReportProcessed log missing topics");
  }

  return decodeEventLog({
    abi: REPORT_PROCESSED_ABI,
    topics: log.topics.map((topic: Uint8Array) => bytesToHex(topic)) as [Hex, ...Hex[]],
    data: bytesToHex(log.data),
  });
}

export const onReportProcessed = (runtime: Runtime<Config>, log: TriggerLog): string => {
  const decoded = decodeReportProcessed(log);
  if (decoded.eventName !== "ReportProcessed") {
    throw new Error(`Unexpected event: ${decoded.eventName}`);
  }

  const { account, callCount, touchedTokens, isSweepable, mode } = decoded.args;
  const txHash = bytesToHex(log.txHash);
  const emitter = bytesToHex(log.address);

  runtime.log(`ReportProcessed detected from ${emitter}`);
  runtime.log(`account=${account}, touchedTokens=${touchedTokens.length}, txHash=${txHash}`);

  return JSON.stringify({
    ok: true,
    eventName: decoded.eventName,
    emitter,
    account,
    touchedTokens,
    callCount: callCount.toString(),
    isSweepable,
    mode: Number(mode),
    txHash,
    removed: log.removed,
  });
};

export const initWorkflow = (config: Config) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
  });
  if (!network) {
    throw new Error(`Unknown chain: ${config.chainSelectorName}`);
  }

  const evmClient = new EVMClient(network.chainSelector.selector);

  return [
    handler(
      evmClient.logTrigger({
        addresses: [hexToBase64(config.registryAddress)],
        topics: [{ values: [hexToBase64(REPORT_PROCESSED_TOPIC)] }],
        confidence: config.confidence ?? "CONFIDENCE_LEVEL_SAFE",
      }),
      onReportProcessed
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
