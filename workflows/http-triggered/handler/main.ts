import {
  HTTPCapability,
  HTTPClient,
  // EVMClient,
  consensusIdenticalAggregation,
  handler,
  Runner,
  ok,
  text,
  // getNetwork,
  // hexToBase64,
  // bytesToHex,
  // TxStatus,
  type Runtime,
  type HTTPSendRequester,
  type HTTPPayload,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters, keccak256, toHex, type Hex } from "viem";
import {
  decrypt,
  ed25519PrivToX25519,
  hexToBytes,
  isEncrypted,
} from "./crypto";
import type {
  Action,
  ConditionBranch,
  Config,
  Intent,
  Mode,
  Operator,
  PortalsPriceResponse,
} from "./types";

export type { Action, ConditionBranch, Config, Intent, Mode } from "./types";

function deriveMode(intent: Intent): Mode {
  if (intent.isRailgun) return 0;   // Railgun (private)
  if (intent.isOfframp) return 1;   // OffRamp (cash out)
  return 2;                          // ForwardTo (send to receiver)
}

const PORTALS_PRICE_CHAIN = "ethereum";
const SEPOLIA_CHAIN_ID = 11155111;

// Mainnet addresses for Portals price lookups
const MAINNET_TOKENS: Record<string, string> = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  DAI:  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
};

// Sepolia addresses for swap execution
const SEPOLIA_TOKENS: Record<string, string> = {
  USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  WETH: "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9",
  DAI:  "0xFF34B3d4Aee8ddCd6F9AFFFB6Fe49bD371b8a357",
  USDT: "0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0",
  WBTC: "0x29f2D40B0605204364af54EC677bD022dA425d03",
  LINK: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
  EURe: "0x67b34b93ac295c985e856E5B8A20D83026b580Eb",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPriceUrl(symbols: string[]): string {
  const addressParams = symbols
    .map((s) => {
      const addr = MAINNET_TOKENS[s.toUpperCase()];
      if (!addr) throw new Error(`No mainnet address for price lookup: ${s}`);
      return `addresses=${PORTALS_PRICE_CHAIN}:${addr}`;
    })
    .join("&");
  return `https://api.portals.fi/v2/tokens?${addressParams}`;
}

function evalOp(price: number, op: Operator, threshold: number): boolean {
  switch (op) {
    case "<": return price < threshold;
    case ">": return price > threshold;
    case "<=": return price <= threshold;
    case ">=": return price >= threshold;
    case "==": return price === threshold;
    case "!=": return price !== threshold;
  }
}

function evaluateBranch(
  branch: ConditionBranch,
  prices: Record<string, number>,
  log: (msg: string) => void,
): boolean {
  for (const check of branch.checks) {
    const price = prices[check.token.toUpperCase()];
    if (price === undefined) {
      log(`WARNING: No price for ${check.token}, check fails`);
      return false;
    }
    const passed = evalOp(price, check.operator, check.threshold);
    log(`  ${check.token} ($${price}) ${check.operator} $${check.threshold} → ${passed}`);
    if (!passed) return false;
  }
  return true;
}

const apiGet =
  (url: string, apiKey: string, label: string) =>
    (sendRequester: HTTPSendRequester): string => {
      const resp = sendRequester.sendRequest({
        url,
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      }).result();

      if (!ok(resp)) {
        throw new Error(`${label} failed: ${resp.statusCode} - ${text(resp)}`);
      }

      return text(resp);
    };

const apiPost =
  (url: string, body: unknown, label: string) =>
    (sendRequester: HTTPSendRequester): string => {
      const resp = sendRequester.sendRequest({
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

function resolveSepoliaAddress(symbol: string): string {
  const addr = SEPOLIA_TOKENS[symbol.toUpperCase()] ?? SEPOLIA_TOKENS[symbol];
  if (!addr) {
    throw new Error(`No Sepolia address for token: ${symbol}`);
  }
  return addr;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  // --- 1. Parse intent (decrypt if needed) ---
  const inputBytes = payload.input;
  let body = "";
  if (inputBytes && inputBytes.length > 0) {
    body = new TextDecoder().decode(inputBytes);
  }
  runtime.log("HTTP trigger received");
  const rawInput = body.trim();

  let parsedInput: unknown;
  try {
    parsedInput = JSON.parse(rawInput);
  } catch {
    parsedInput = undefined;
  }

  const envelope = parsedInput as {
    eventChain?: string;
    destinationChain?: string;
    accountAddress?: string;
    forwardTo?: string;
    subnameString?: string;
    ciphertext?: string;
  } | undefined;

  const wrappedCiphertext =
    envelope && typeof envelope.ciphertext === "string" ? envelope.ciphertext.trim() : undefined;
  const encryptedInput = isEncrypted(rawInput) ? rawInput : wrappedCiphertext;

  let intent: Intent;
  if (encryptedInput) {
    runtime.log("Encrypted payload detected; decrypting with service key");
    const servicePrivHex = runtime.getSecret({ id: "EDDSA_PRIVATE_KEY" }).result().value.trim();
    if (!servicePrivHex) {
      throw new Error("EDDSA_PRIVATE_KEY secret is not configured");
    }
    const servicePrivEd = hexToBytes(servicePrivHex);
    const servicePrivX = ed25519PrivToX25519(servicePrivEd);
    const decryptedBody = decrypt(encryptedInput, servicePrivX);
    const tokenIntent = JSON.parse(decryptedBody);

    intent = {
      ...tokenIntent,
      chain: envelope?.eventChain ?? tokenIntent.chain,
      destinationChain: envelope?.destinationChain ?? tokenIntent.destinationChain,
      salt: tokenIntent.salt ?? envelope?.subnameString ?? tokenIntent.subnameString,
      sender: envelope?.accountAddress ?? tokenIntent.sender,
      receiver: envelope?.forwardTo ?? tokenIntent.receiver,
    };
  } else if (parsedInput && typeof parsedInput === "object") {
    intent = parsedInput as Intent;
  } else {
    intent = JSON.parse(rawInput);
  }

  // Resolve salt: use explicit salt if provided, otherwise hash subnameString for backwards compat
  const salt: Hex = intent.salt
    ? (intent.salt as Hex)
    : keccak256(toHex(intent.subnameString ?? ""));

  runtime.log(
    `Intent: ${intent.inputAmount} ${intent.inputToken} source=${intent.chain} priceChain=${PORTALS_PRICE_CHAIN}`,
  );
  runtime.log(`SA (sender)=${intent.sender}, receiver=${intent.receiver}, salt=${salt}`);

  // --- 2. Fetch prices from Portals (mainnet) ---
  const portalsKey = runtime.getSecret({ id: "PORTALS_API_KEY" }).result();
  const apiKey = portalsKey.value;

  const priceTokens = new Set<string>();
  priceTokens.add(intent.inputToken);
  for (const branch of intent.conditions) {
    for (const check of branch.checks) {
      priceTokens.add(check.token);
    }
  }

  const symbolList = [...priceTokens];
  const priceUrl = buildPriceUrl(symbolList);
  runtime.log(`Fetching prices from Portals on ${PORTALS_PRICE_CHAIN} for: ${symbolList.join(", ")}`);

  const httpClient = new HTTPClient();
  const priceBody = httpClient
    .sendRequest(runtime, apiGet(priceUrl, apiKey, "Price fetch"), consensusIdenticalAggregation<string>())()
    .result();

  const priceData = JSON.parse(priceBody) as PortalsPriceResponse;
  const prices: Record<string, number> = {};
  for (const token of priceData.tokens) {
    prices[token.symbol.toUpperCase()] = token.price;
  }
  runtime.log(`Prices: ${JSON.stringify(prices)}`);

  // --- 3. Evaluate condition tree ---
  let selectedActions: Action[] = intent.elseActions;
  for (let i = 0; i < intent.conditions.length; i++) {
    const branch = intent.conditions[i];
    runtime.log(`Evaluating condition ${i}:`);
    if (evaluateBranch(branch, prices, (m) => runtime.log(m))) {
      runtime.log(`→ Condition ${i} matched`);
      selectedActions = branch.actions;
      break;
    }
  }

  const totalPercent = selectedActions.reduce((sum, action) => sum + action.percent, 0);
  if (totalPercent > 100) {
    return JSON.stringify({ ok: false, error: `Action percentages exceed 100%: ${totalPercent}` });
  }

  // --- 4. Build Uniswap quote requests with Sepolia addresses ---
  const quotes = selectedActions
    .filter((action) => action.percent > 0 && action.actionType === "swap")
    .map((action) => {
      const inputAmountAtomic = BigInt(
        Math.floor((intent.inputAmount * action.percent / 100) * 10 ** intent.inputDecimals),
      ).toString();

      return {
        amount: inputAmountAtomic,
        tokenIn: resolveSepoliaAddress(intent.inputToken),
        tokenOut: resolveSepoliaAddress(action.outputToken),
        tokenInChainId: SEPOLIA_CHAIN_ID,
        tokenOutChainId: SEPOLIA_CHAIN_ID,
        swapper: intent.sender,
        type: "EXACT_INPUT" as const,
      };
    });

  runtime.log(`Built ${quotes.length} swap quote(s) for Sepolia`);
  for (const q of quotes) {
    runtime.log(`  ${q.tokenIn} → ${q.tokenOut} amount=${q.amount}`);
  }

  if (quotes.length === 0) {
    return JSON.stringify({ ok: true, message: "No swap actions to execute", prices, selectedActions });
  }

  // --- 5. Call server /swap_5792 to get calldata (approvals + swaps) ---
  const serverUrl = runtime.getSecret({ id: "KONDOR_SERVER_URL" }).result().value.trim();
  const swapPayload = {
    quotes,
    includeApprovalCalls: true,
    executeBatchMethod: "batchExecute" as const,
  };

  runtime.log(`Posting ${quotes.length} quote(s) to ${serverUrl}/swap_5792`);

  const swapBody = httpClient
    .sendRequest(
      runtime,
      apiPost(`${serverUrl}/swap_5792`, swapPayload, "swap_5792"),
      consensusIdenticalAggregation<string>(),
    )()
    .result();

  const swapResult = JSON.parse(swapBody) as {
    ok: boolean;
    count: number;
    targets: string[];
    values: string[];
    calldatas: string[];
  };

  runtime.log(`swap_5792 returned ${swapResult.count} result(s), ${swapResult.targets.length} batch calls`);

  // --- 6. ABI-encode report for KondorRegistry.onReport ---
  // onReport expects: (bytes32 salt, bytes32 hashedOwner, address[] targets, uint256[] values, bytes[] calldatas, address[] touchedTokens, bool isSweepable, uint8 mode)
  const targets = swapResult.targets as Hex[];
  const values = swapResult.values.map((v: string) => BigInt(v));
  const calldatas = swapResult.calldatas as Hex[];

  // Collect unique touched tokens (inputToken + all outputTokens)
  const touchedSet = new Set<string>();
  touchedSet.add(resolveSepoliaAddress(intent.inputToken).toLowerCase());
  for (const action of selectedActions) {
    if (action.percent > 0 && action.actionType === "swap") {
      touchedSet.add(resolveSepoliaAddress(action.outputToken).toLowerCase());
    }
  }
  const touchedTokens = [...touchedSet] as Hex[];
  const isSweepable = true;
  const mode = deriveMode(intent);
  const modeLabels = ["Railgun", "OffRamp", "ForwardTo"] as const;
  const hashedOwner = intent.hashedOwner as Hex;

  runtime.log(`Touched tokens: ${touchedTokens.join(", ")}, sweepable: ${isSweepable}, mode: ${modeLabels[mode]}`);

  const encodedReport = encodeAbiParameters(
    parseAbiParameters("bytes32, bytes32, address[], uint256[], bytes[], address[], bool, uint8"),
    [
      salt,
      hashedOwner,
      targets,
      values,
      calldatas,
      touchedTokens,
      isSweepable,
      mode,
    ],
  );

  runtime.log(`Encoded report (${encodedReport.length} chars), ${targets.length} batch calls`);

  // --- 7. Sign & submit report to KondorRegistry on Sepolia ---
  // TODO: uncomment writeReport once registry is deployed
  // const network = getNetwork({
  //   chainFamily: "evm",
  //   chainSelectorName: runtime.config.chainSelectorName,
  // });
  // if (!network) throw new Error(`Unknown chain: ${runtime.config.chainSelectorName}`);
  //
  // runtime.log(`Target chain: ${runtime.config.chainSelectorName}, registry: ${runtime.config.registryAddress}`);
  //
  // const reportResponse = runtime
  //   .report({
  //     encodedPayload: hexToBase64(encodedReport),
  //     encoderName: "evm",
  //     signingAlgo: "ecdsa",
  //     hashingAlgo: "keccak256",
  //   })
  //   .result();
  //
  // const evmClient = new EVMClient(network.chainSelector.selector);
  //
  // const writeResult = evmClient
  //   .writeReport(runtime, {
  //     receiver: runtime.config.registryAddress,
  //     report: reportResponse,
  //     gasConfig: { gasLimit: "500000" },
  //   })
  //   .result();
  //
  // if (writeResult.txStatus === TxStatus.SUCCESS) {
  //   const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
  //   runtime.log(`writeReport SUCCESS: ${txHash}`);
  // } else {
  //   runtime.log(`writeReport status: ${writeResult.txStatus}`);
  // }

  runtime.log(`SUCCESS: report ready for salt=${salt}, ${targets.length} batch calls encoded`);

  return JSON.stringify({
    ok: true,
    salt,
    sender: intent.sender,
    receiver: intent.receiver,
    prices,
    selectedActions,
    batchSize: targets.length,
    encodedReport,
  });
};

// ---------------------------------------------------------------------------
// Workflow init & main
// ---------------------------------------------------------------------------

export const initWorkflow = (config: Config) => {
  const http = new HTTPCapability();

  // TODO: uncomment when writeReport is enabled
  // const network = getNetwork({
  //   chainFamily: "evm",
  //   chainSelectorName: config.chainSelectorName,
  // });
  // if (network) {
  //   new EVMClient(network.chainSelector.selector);
  // }

  return [
    handler(
      http.trigger({
        authorizedKeys: config.authorizedKeys,
      }),
      onHttpTrigger,
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
