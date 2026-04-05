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
  formatUnits,
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
  /**
   * Kondor ENS label (e.g. dronez). Required for offramp when `account` is a SimpleAccount not in
   * stealth_addresses — server loads Monerium tokens from this user row.
   */
  ensSubdomain?: string;
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

/** POST helper; returns JSON.stringify({ statusCode, body }) for consensusIdenticalAggregation<string>(). */
const apiPostMoneriumEncoded =
  (url: string, body: unknown, label: string) =>
    (sendRequester: HTTPSendRequester): string => {
      const resp = (sendRequester as any).sendRequest({
        url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: new TextEncoder().encode(JSON.stringify(body)),
      }).result();

      const statusCode = resp.statusCode as number;
      const bodyText = text(resp);
      const allowed =
        ok(resp) ||
        statusCode === 422 ||
        statusCode === 400 ||
        statusCode === 201 ||
        statusCode === 202;
      if (!allowed) {
        throw new Error(`${label} failed: ${statusCode} - ${bodyText}`);
      }
      return JSON.stringify({ statusCode, body: bodyText });
    };

const EURE_SEPOLIA = "0x67b34b93ac295c985e856E5B8A20D83026b580Eb" as Hex;

type MoneriumBatchJson = {
  ok?: boolean;
  error?: string;
  hint?: string;
  profileId?: string;
  orderId?: string;
  orderHttpStatus?: number;
  orderRawBody?: string;
  message?: string;
  messageHash?: Hex;
  iban?: string;
  orderResponse?: unknown;
  targets?: Hex[];
  values?: string[];
  calldatas?: Hex[];
  moneriumHttpStatus?: number;
  state?: string;
  completeLinkOnChain?: {
    message: string;
    targets: Hex[];
    values: string[];
    calldatas: Hex[];
  };
};

function batchFromParsed(parsed: MoneriumBatchJson): { targets: Hex[]; values: bigint[]; calldatas: Hex[] } {
  if (!parsed.targets?.length || !parsed.values?.length || !parsed.calldatas?.length) {
    throw new Error(parsed.error ?? "Monerium response missing targets/values/calldatas");
  }
  return {
    targets: parsed.targets,
    values: parsed.values.map((v) => BigInt(v)),
    calldatas: parsed.calldatas,
  };
}

/**
 * Offramp batch for the ReportProcessed `account` (SCA):
 * 1. Always POST /monerium/link-address first, treating the account as not yet linked.
 * 2. Expect offchain ERC-1271 validation (HTTP 200/201 linked) via isValidSignature.
 * 3. Immediately POST /monerium/redeem and return the order batch:
 *    EURe.approve(...) + SimpleAccount.signMsg(redeemOrderMsgHash).
 *
 * We do not intentionally use the on-chain link SignMsg flow here; if Monerium returns 202 for
 * link-address, surface it as an error because the desired path is offchain validation.
 */
async function buildOfframpBatchCalls(
  runtime: Runtime<Config>,
  account: Hex,
  eureBalance: bigint,
  salt: string,
): Promise<{ targets: Hex[]; values: bigint[]; calldatas: Hex[] }> {
  const httpClient = new HTTPClient();
  const amount = formatUnits(eureBalance, 18);
  const messageAt = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString().replace("Z", "+00:00");
  const ensSubdomain = runtime.config.ensSubdomain?.trim();
  const serverUrl = runtime.config.serverUrl.replace(/\/$/, "");

  runtime.log(
    `OffRamp: account=${account}, amount=${amount} EURe, salt=${salt.slice(0, 10)}..., messageAt=${messageAt}, ensSubdomain=${ensSubdomain ?? "(none)"}`,
  );

  const parseMoneriumJson = (label: string, result: { statusCode: number; body: string }): MoneriumBatchJson => {
    try {
      return JSON.parse(result.body) as MoneriumBatchJson;
    } catch {
      throw new Error(`${label} invalid JSON: ${result.body.slice(0, 200)}`);
    }
  };

  if (!ensSubdomain) {
    runtime.log(
      "WARNING: config.ensSubdomain unset — server resolves Monerium user only via stealth_addresses; SCA offramp may fail.",
    );
  } else {
    runtime.log("Monerium flow: linking address offchain via ERC-1271 before placing redeem order.");

    const linkEncoded = httpClient
      .sendRequest(
        runtime,
        apiPostMoneriumEncoded(
          `${serverUrl}/monerium/link-address`,
          { ensSubdomain, account, chain: "sepolia" },
          "monerium/link-address",
        ),
        consensusIdenticalAggregation<string>(),
      )()
      .result();

    const linkResult = JSON.parse(linkEncoded) as { statusCode: number; body: string };
    const linkParsed = parseMoneriumJson("monerium/link-address", linkResult);

    if (linkParsed.ok && (linkResult.statusCode === 200 || linkResult.statusCode === 201)) {
      runtime.log(
        `Monerium link-address SUCCESS: address=${account} is linked offchain for profile ${linkParsed.profileId ?? "?"} (HTTP ${linkResult.statusCode}).`,
      );
      runtime.log("Monerium next step: placing redeem order now.");
    } else if (linkResult.statusCode === 202 && linkParsed.ok) {
      throw new Error(
        "monerium/link-address unexpectedly requested on-chain link SignMsg; expected offchain ERC-1271 validation",
      );
    } else {
      throw new Error(linkParsed.error ?? `monerium/link-address failed (${linkResult.statusCode})`);
    }
  }

  const redeemEncoded = httpClient
    .sendRequest(
      runtime,
      apiPostMoneriumEncoded(
        `${serverUrl}/monerium/redeem`,
        {
          account,
          amount,
          salt,
          messageAt,
          ...(ensSubdomain ? { ensSubdomain } : {}),
        },
        "monerium/redeem",
      ),
      consensusIdenticalAggregation<string>(),
    )()
    .result();

  const redeemResult = JSON.parse(redeemEncoded) as { statusCode: number; body: string };
  const redeemParsed = parseMoneriumJson("monerium/redeem", redeemResult);

  if (redeemParsed.ok && redeemParsed.targets && redeemParsed.values && redeemParsed.calldatas) {
    runtime.log(
      `Monerium redeem SUCCESS: order accepted for account=${account}, amount=${amount} EURe, iban=${redeemParsed.iban ?? "?"}, orderId=${redeemParsed.orderId ?? "(not returned by API response)"}.`,
    );
    if (redeemParsed.message) {
      runtime.log(`Monerium redeem message: ${redeemParsed.message}`);
    }
    if (redeemParsed.messageHash) {
      runtime.log(`Monerium redeem message hash (must match SignMsg topic[1]): ${redeemParsed.messageHash}`);
    }
    if (redeemParsed.orderHttpStatus !== undefined) {
      runtime.log(`Monerium raw POST /orders HTTP status: ${redeemParsed.orderHttpStatus}`);
    }
    if (redeemParsed.orderRawBody !== undefined) {
      runtime.log(`Monerium raw POST /orders body: ${redeemParsed.orderRawBody}`);
    }
    if (redeemParsed.orderResponse !== undefined) {
      runtime.log(`Monerium raw order response: ${JSON.stringify(redeemParsed.orderResponse)}`);
    }
    runtime.log(
      `Monerium next on-chain batch: ${redeemParsed.targets.length} calls (${redeemParsed.targets.length >= 1 ? "approve" : ""}${redeemParsed.targets.length >= 2 ? " + signMsg(orderMsgHash)" : ""}).`,
    );
    return batchFromParsed(redeemParsed);
  }

  if (redeemParsed.completeLinkOnChain?.calldatas?.length) {
    throw new Error(
      redeemParsed.error ??
        "monerium/redeem requested completeLinkOnChain unexpectedly; offchain link should have completed first",
    );
  }

  throw new Error(redeemParsed.error ?? `monerium/redeem failed (${redeemResult.statusCode})`);
}

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

  const modeNum = Number(mode);

  if (modeNum !== 0 && modeNum !== 1) {
    return JSON.stringify({ ok: true, skipped: true, reason: "unhandled-mode", txHash, account, mode: modeNum });
  }

  const uniqueTouchedTokens = dedupeAddresses(touchedTokens as readonly string[]);
  const balances = await fetchTouchedTokenBalances(runtime, evmClient, account as Hex, uniqueTouchedTokens);
  const positiveBalances = balances.filter(({ balance }) => balance > 0n);

  if (positiveBalances.length === 0) {
    return JSON.stringify({ ok: true, skipped: true, reason: "no-positive-balances", account, touchedTokens: uniqueTouchedTokens, txHash });
  }

  let batch: { targets: Hex[]; values: bigint[]; calldatas: Hex[] };
  let reportTouchedTokens: Hex[];

  if (modeNum === 1) {
    // OffRamp: account is now deployed. Place Monerium order + get approve+signMsg calldata.
    // txHash passed as salt for logging; order message time comes from messageAt (current UTC minute).
    const eureBalance = balances.find(
      (b) => b.token.toLowerCase() === EURE_SEPOLIA.toLowerCase()
    );
    if (!eureBalance || eureBalance.balance === 0n) {
      return JSON.stringify({ ok: true, skipped: true, reason: "no-eure-balance", account, txHash });
    }
    batch = await buildOfframpBatchCalls(runtime, account as Hex, eureBalance.balance, txHash);
    reportTouchedTokens = [EURE_SEPOLIA];
  } else {
    // mode=0 Railgun: shield all positive balances
    batch = await buildShieldBatchCalls(runtime, positiveBalances);
    reportTouchedTokens = positiveBalances.map(({ token }) => token);
  }

  const reportPayload = createEventReportPayload(
    account as Hex,
    reportTouchedTokens,
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
    mode: modeNum,
    txHash,
    removed: log.removed,
    processedTokens: positiveBalances.map(({ token, balance }) => ({
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
