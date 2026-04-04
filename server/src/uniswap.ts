import axios from "axios";
import { encodeFunctionData, parseAbi, type Hex } from "viem";

const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const REQUEST_TIMEOUT_MS = 30_000;

type UniswapRouterVersion = "1.2" | "2.0" | "2.1.1";
type UniswapUrgency = "normal" | "fast" | "urgent";

type QuoteRequestPayload = Record<string, unknown>;
type QuoteResponsePayload = Record<string, unknown> & {
  quote?: Record<string, unknown>;
  routing?: unknown;
  requestId?: string;
  permitData?: unknown;
};

type Swap5792Call = {
  to: string;
  data: string;
  value: string;
  gasLimit?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
};

type Swap5792ResponsePayload = {
  requestId: string;
  from: string;
  chainId: number;
  gasFee?: string;
  calls: Swap5792Call[];
};

type ApprovalTx = {
  to: string;
  from?: string;
  data: string;
  value: string;
  chainId?: number;
};

type ApprovalResponsePayload = {
  requestId: string;
  approval: ApprovalTx | null;
  cancel: ApprovalTx | null;
  gasFee?: string;
  cancelGasFee?: string;
};

type BatchCall = {
  to: string;
  value: string;
  data: string;
  source: "approval-cancel" | "approval" | "swap";
  quoteIndex: number;
};

export type BatchSwap5792Request = {
  quotes?: QuoteRequestPayload[];
  deadline?: number;
  urgency?: UniswapUrgency;
  universalRouterVersion?: UniswapRouterVersion;
  includeApprovalCalls?: boolean;
  executeBatchMethod?: "batchExecute";
};

export type BatchSwap5792Result = {
  count: number;
  chainId: number;
  smartAccount: string;
  batchCalls: BatchCall[];
  targets: string[];
  values: string[];
  calldatas: string[];
  executeBatchMethod: "batchExecute";
  batchExecuteCalldata: Hex;
  results: Array<{
    index: number;
    quoteRequest: QuoteRequestPayload;
    quoteRequestId?: string;
    approvalRequestId?: string;
    routing?: unknown;
    swapRequestId: string;
    from: string;
    chainId: number;
    gasFee?: string;
    calls: Swap5792Call[];
    calldata: string[];
  }>;
};

function normalizeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data;
    const detail =
      typeof data === "string"
        ? data
        : data && typeof data === "object"
          ? JSON.stringify(data)
          : error.message;
    return `Uniswap API error${status ? ` (${status})` : ""}: ${detail}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function buildHeaders(apiKey: string, options: { routerVersion?: UniswapRouterVersion }) {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    accept: "application/json",
    "content-type": "application/json",
  };

  if (options.routerVersion) {
    headers["x-universal-router-version"] = options.routerVersion;
  }

  return headers;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function buildExecuteBatchCalldata(
  method: "batchExecute",
  targets: string[],
  values: string[],
  calldatas: string[]
): Hex {
  const abi = parseAbi(["function batchExecute(address[] targets,uint256[] values,bytes[] calldatas)"]);

  return encodeFunctionData({
    abi,
    functionName: method,
    args: [targets, values.map((value) => BigInt(value)), calldatas as Hex[]],
  });
}

export async function createBatchSwap5792(
  body: BatchSwap5792Request,
  apiKey: string
): Promise<BatchSwap5792Result> {
  if (!Array.isArray(body.quotes) || body.quotes.length === 0) {
    throw new Error("Body must include quotes: QuoteRequest[] with at least one item");
  }

  const quoteHeaders = {
    ...buildHeaders(apiKey, { routerVersion: body.universalRouterVersion }),
    "x-permit2-disabled": "true",
  };

  const swapHeaders = {
    ...buildHeaders(apiKey, { routerVersion: body.universalRouterVersion }),
    "x-permit2-disabled": "true",
  };
  const includeApprovalCalls = body.includeApprovalCalls ?? true;
  const executeBatchMethod: "batchExecute" = body.executeBatchMethod ?? "batchExecute";

  const flatCalls: BatchCall[] = [];

  const quoteResponses = await Promise.all(
    body.quotes.map(async (quoteRequest, index) => {
      const amount = asString(quoteRequest.amount);
      const tokenIn = asString(quoteRequest.tokenIn);
      const tokenOut = asString(quoteRequest.tokenOut);
      const tokenInChainId = asNumber(quoteRequest.tokenInChainId);
      const tokenOutChainId = asNumber(quoteRequest.tokenOutChainId);
      const swapper = asString(quoteRequest.swapper);

      if (!amount || !tokenIn || !tokenOut || !tokenInChainId || !tokenOutChainId || !swapper) {
        throw new Error(
          `Quote request #${index} is missing required fields. Required: amount, tokenIn, tokenOut, tokenInChainId, tokenOutChainId, swapper`
        );
      }

      try {
        let approvalResponse: ApprovalResponsePayload | undefined;
        if (includeApprovalCalls) {
          const checkApprovalPayload: Record<string, unknown> = {
            walletAddress: swapper,
            token: tokenIn,
            amount,
            chainId: tokenInChainId,
            tokenOut,
            tokenOutChainId,
          };

          if (body.urgency) {
            checkApprovalPayload.urgency = body.urgency;
          }

          const approval = await axios.post<ApprovalResponsePayload>(
            `${UNISWAP_API_BASE}/check_approval`,
            checkApprovalPayload,
            {
              headers: quoteHeaders,
              timeout: REQUEST_TIMEOUT_MS,
            }
          );
          approvalResponse = approval.data;
        }

        const response = await axios.post<QuoteResponsePayload>(
          `${UNISWAP_API_BASE}/quote`,
          quoteRequest,
          {
            headers: quoteHeaders,
            timeout: REQUEST_TIMEOUT_MS,
          }
        );

        if (!response.data?.quote) {
          throw new Error("Missing quote in /quote response");
        }

        return {
          index,
          quoteRequest,
          swapper,
          tokenInChainId,
          approvalResponse,
          quoteResponse: response.data,
        };
      } catch (error) {
        throw new Error(`Quote request #${index} failed. ${normalizeError(error)}`);
      }
    })
  );

  const swapResults = await Promise.all(
    quoteResponses.map(async ({ index, quoteRequest, swapper, tokenInChainId, approvalResponse, quoteResponse }) => {
      const swapPayload: Record<string, unknown> = {
        quote: quoteResponse.quote,
        permitData: null,
      };

      if (typeof body.deadline === "number") {
        swapPayload.deadline = body.deadline;
      }

      if (body.urgency) {
        swapPayload.urgency = body.urgency;
      }

      try {
        const response = await axios.post<Swap5792ResponsePayload>(
          `${UNISWAP_API_BASE}/swap_5792`,
          swapPayload,
          {
            headers: swapHeaders,
            timeout: REQUEST_TIMEOUT_MS,
          }
        );

        const swap = response.data;

        if (approvalResponse?.cancel) {
          flatCalls.push({
            to: approvalResponse.cancel.to,
            value: approvalResponse.cancel.value,
            data: approvalResponse.cancel.data,
            source: "approval-cancel",
            quoteIndex: index,
          });
        }

        if (approvalResponse?.approval) {
          flatCalls.push({
            to: approvalResponse.approval.to,
            value: approvalResponse.approval.value,
            data: approvalResponse.approval.data,
            source: "approval",
            quoteIndex: index,
          });
        }

        for (const call of swap.calls) {
          flatCalls.push({
            to: call.to,
            value: call.value,
            data: call.data,
            source: "swap",
            quoteIndex: index,
          });
        }

        return {
          index,
          quoteRequest,
          approvalRequestId: approvalResponse?.requestId,
          quoteRequestId: quoteResponse.requestId,
          routing: quoteResponse.routing,
          swapRequestId: swap.requestId,
          from: swapper,
          chainId: tokenInChainId,
          gasFee: swap.gasFee,
          calls: swap.calls,
          calldata: swap.calls.map((call) => call.data),
        };
      } catch (error) {
        throw new Error(`swap_5792 request #${index} failed. ${normalizeError(error)}`);
      }
    })
  );

  const firstFrom = swapResults[0]?.from;
  const firstChainId = swapResults[0]?.chainId;
  if (!firstFrom || typeof firstChainId !== "number") {
    throw new Error("Could not determine smart account or chain from swap results");
  }

  for (const result of swapResults) {
    if (result.from.toLowerCase() !== firstFrom.toLowerCase()) {
      throw new Error("All quote requests must use the same swapper/smart account");
    }
    if (result.chainId !== firstChainId) {
      throw new Error("All quote requests must be on the same chain for one executeBatch payload");
    }
  }

  return {
    count: swapResults.length,
    chainId: firstChainId,
    smartAccount: firstFrom,
    batchCalls: flatCalls,
    targets: flatCalls.map((call) => call.to),
    values: flatCalls.map((call) => call.value),
    calldatas: flatCalls.map((call) => call.data),
    executeBatchMethod,
    batchExecuteCalldata: buildExecuteBatchCalldata(
      executeBatchMethod,
      flatCalls.map((call) => call.to),
      flatCalls.map((call) => call.value),
      flatCalls.map((call) => call.data)
    ),
    results: swapResults,
  };
}
