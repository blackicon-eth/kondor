import {
  EVMClient,
  HTTPClient,
  Runner,
  TxStatus,
  bytesToHex,
  consensusIdenticalAggregation,
  getNetwork,
  handler,
  hexToBase64,
  ok,
  text,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toBytes,
  type Hex,
} from "viem";

export type Config = {
  registryAddress: Hex;
  chainSelectorName: string;
  serverUrl: string;
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

type BalanceResult = {
  token: Hex;
  balance: bigint;
};

const REPORT_PROCESSED_ABI = parseAbi([
  "event ReportProcessed(address indexed account, uint256 callCount, address[] touchedTokens, bool isSweepable, uint8 mode)",
]);
const REPORT_PROCESSED_TOPIC = keccak256(
  toBytes("ReportProcessed(address,uint256,address[],bool,uint8)")
);
const MULTICALL3_ABI = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);
const EVENT_REPORT_MAGIC = keccak256(toBytes("KONDOR_EVENT_REPORT_V1"));
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Hex;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Hex;
const REPORT_GAS_LIMIT = "3000000";

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

function dedupeAddresses(addresses: readonly string[]): Hex[] {
  const seen = new Set<string>();
  const unique: Hex[] = [];

  for (const address of addresses) {
    const normalized = address.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(address as Hex);
  }

  return unique;
}

function createEventReportPayload(
  account: Hex,
  touchedTokens: Hex[],
  targets: Hex[],
  values: bigint[],
  calldatas: Hex[]
): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      "bytes32 magic,address account,address[] targets,uint256[] values,bytes[] calldatas,address[] touchedTokens"
    ),
    [EVENT_REPORT_MAGIC, account, targets, values, calldatas, touchedTokens]
  );
}

function normalizeBalance(balanceHex: Hex): bigint {
  return decodeAbiParameters(parseAbiParameters("uint256 balance"), balanceHex)[0];
}

function buildMulticallData(account: Hex, tokens: Hex[]): Hex {
  return encodeFunctionData({
    abi: MULTICALL3_ABI,
    functionName: "aggregate3",
    args: [
      tokens.map((token) => ({
        target: token,
        allowFailure: true,
        callData: encodeFunctionData({
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        }),
      })),
    ],
  });
}

async function fetchTouchedTokenBalances(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  account: Hex,
  touchedTokens: Hex[]
): Promise<BalanceResult[]> {
  if (touchedTokens.length === 0) return [];

  const multicallData = buildMulticallData(account, touchedTokens);
  const reply = evmClient
    .callContract(runtime, {
      call: {
        from: hexToBase64(ZERO_ADDRESS),
        to: hexToBase64(MULTICALL3),
        data: hexToBase64(multicallData),
      },
    })
    .result();

  const results = decodeFunctionResult({
    abi: MULTICALL3_ABI,
    functionName: "aggregate3",
    data: bytesToHex(reply.data) as Hex,
  });

  return touchedTokens.map((token, index) => {
    const result = results[index];
    if (!result.success) {
      return { token, balance: 0n };
    }

    return {
      token,
      balance: normalizeBalance(result.returnData as Hex),
    };
  });
}

const apiPost =
  (url: string, body: unknown, label: string) =>
    (sendRequester: HTTPSendRequester): string => {
      const resp = (sendRequester as any).sendRequest({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify(body)),
      }).result();

      if (!ok(resp)) {
        throw new Error(`${label} failed: ${resp.statusCode} - ${text(resp)}`);
      }

      return text(resp);
    };

async function buildShieldBatchCalls(
  runtime: Runtime<Config>,
  balances: BalanceResult[]
): Promise<{ targets: Hex[]; values: bigint[]; calldatas: Hex[] }> {
  const httpClient = new HTTPClient();
  const responseBody = httpClient
    .sendRequest(
      runtime,
      apiPost(
        `${runtime.config.serverUrl}/railgun/shield-calls`,
        {
          balances: balances.map(({ token, balance }) => ({
            token,
            balance: balance.toString(),
          })),
        },
        "railgun shield-calls"
      ),
      consensusIdenticalAggregation<string>()
    )()
    .result();

  const parsed = JSON.parse(responseBody) as {
    ok?: boolean;
    error?: string;
    targets?: Hex[];
    values?: string[];
    calldatas?: Hex[];
  };

  if (!parsed.ok || !parsed.targets || !parsed.values || !parsed.calldatas) {
    throw new Error(parsed.error ?? "Invalid railgun shield-calls response");
  }

  return {
    targets: parsed.targets,
    values: parsed.values.map((value) => BigInt(value)),
    calldatas: parsed.calldatas,
  };
}

export const onReportProcessed = async (runtime: Runtime<Config>, log: TriggerLog): Promise<string> => {
  const decoded = decodeReportProcessed(log);
  if (decoded.eventName !== "ReportProcessed") {
    throw new Error(`Unexpected event: ${decoded.eventName}`);
  }

  const { account, callCount, touchedTokens, isSweepable, mode } = decoded.args;
  const txHash = bytesToHex(log.txHash);
  const emitter = bytesToHex(log.address);
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
  });
  if (!network) {
    throw new Error(`Unknown chain: ${runtime.config.chainSelectorName}`);
  }

  const evmClient = new EVMClient(network.chainSelector.selector);

  runtime.log(`ReportProcessed detected from ${emitter}`);
  runtime.log(`account=${account}, touchedTokens=${touchedTokens.length}, txHash=${txHash}`);

  if (log.removed) {
    return JSON.stringify({ ok: true, skipped: true, reason: "removed-log", txHash });
  }

  if (!isSweepable) {
    return JSON.stringify({ ok: true, skipped: true, reason: "not-sweepable", txHash, account });
  }

  if (Number(mode) !== 0) {
    return JSON.stringify({
      ok: true,
      skipped: true,
      reason: "non-railgun-mode",
      txHash,
      account,
      mode: Number(mode),
    });
  }

  const uniqueTouchedTokens = dedupeAddresses(touchedTokens as readonly string[]);
  const balances = await fetchTouchedTokenBalances(runtime, evmClient, account as Hex, uniqueTouchedTokens);
  const positiveBalances = balances.filter(({ balance }) => balance > 0n);

  if (positiveBalances.length === 0) {
    return JSON.stringify({
      ok: true,
      skipped: true,
      reason: "no-positive-balances",
      account,
      touchedTokens: uniqueTouchedTokens,
      txHash,
    });
  }

  const batch = await buildShieldBatchCalls(runtime, positiveBalances);
  const reportPayload = createEventReportPayload(
    account as Hex,
    positiveBalances.map(({ token }) => token),
    batch.targets,
    batch.values,
    batch.calldatas
  );

  const reportResponse = runtime
    .report({
      encodedPayload: hexToBase64(reportPayload),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.registryAddress,
      report: reportResponse,
      gasConfig: { gasLimit: REPORT_GAS_LIMIT },
    })
    .result();

  return JSON.stringify({
    ok: true,
    eventName: decoded.eventName,
    emitter,
    account,
    touchedTokens: uniqueTouchedTokens,
    callCount: callCount.toString(),
    isSweepable,
    mode: Number(mode),
    txHash,
    removed: log.removed,
    shieldedTokens: positiveBalances.map(({ token, balance }) => ({
      token,
      balance: balance.toString(),
    })),
    batchCallCount: batch.targets.length,
    writeReportStatus: writeResult.txStatus,
    writeReportTxHash:
      writeResult.txStatus === TxStatus.SUCCESS
        ? bytesToHex(writeResult.txHash ?? new Uint8Array(32))
        : undefined,
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
