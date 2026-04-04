import { describe, expect } from "bun:test";
import { newTestRuntime, test, HttpActionsMock } from "@chainlink/cre-sdk/test";
import { onHttpTrigger, initWorkflow } from "./main";
import type { Config, Intent } from "./types";
import type { HTTPPayload } from "@chainlink/cre-sdk";

const TEST_CONFIG: Config = {
  authorizedKeys: [],
  registryAddress: "0x000000000000000000000000000000000000dEaD",
  chainSelectorName: "ethereum-testnet-sepolia-1",
};

function makePayload(intent: Intent): HTTPPayload {
  return {
    input: new TextEncoder().encode(JSON.stringify(intent)),
  } as HTTPPayload;
}

function setupSecrets() {
  return new Map([
    [
      "default",
      new Map([
        ["EDDSA_PRIVATE_KEY", "test-key-hex"],
        ["PORTALS_API_KEY", "test-portals-key"],
      ]),
    ],
  ]);
}

function mockResponse(data: unknown) {
  return {
    statusCode: 200,
    headers: {},
    body: new TextEncoder().encode(JSON.stringify(data)),
    multiHeaders: {},
  };
}

const priceResponse = (wethPrice: number, linkPrice = 15) => ({
  tokens: [
    { address: "0x1", symbol: "USDC", price: 1.0 },
    { address: "0x2", symbol: "WETH", price: wethPrice },
    { address: "0x3", symbol: "LINK", price: linkPrice },
  ],
});

const baseIntent: Intent = {
  chain: "base",
  inputToken: "USDC",
  inputAmount: 100,
  inputDecimals: 6,
  subnameString: "fernandello",
  sender: "0x8da91A6298eA5d1A8Bc985e99798fd0A0f05701a",
  receiver: "0x8da91A6298eA5d1A8Bc985e99798fd0A0f05701a",
  conditions: [
    {
      checks: [
        { token: "WETH", operator: "<", threshold: 2000 },
        { token: "WETH", operator: ">", threshold: 1000 },
      ],
      actions: [{ actionType: "swap", outputToken: "WETH", percent: 50 }],
    },
    {
      checks: [
        { token: "WETH", operator: "<", threshold: 2000 },
        { token: "LINK", operator: "<", threshold: 8 },
      ],
      actions: [{ actionType: "swap", outputToken: "LINK", percent: 80 }],
    },
  ],
  elseActions: [
    { actionType: "supply", outputToken: "aBasUSDC", percent: 90 },
    { actionType: "swap", outputToken: "WETH", percent: 10 },
  ],
};

describe("onHttpTrigger", () => {
  test("condition 0 matches and returns parsed action plan", () => {
    const runtime = newTestRuntime(setupSecrets());
    runtime.config = TEST_CONFIG;

    const mock = HttpActionsMock.testInstance();
    let requests = 0;
    mock.sendRequest = (input) => {
      requests += 1;
      const url = input.url ?? "";
      expect(url.includes("/v2/tokens")).toBe(true);
      expect(url.includes("ethereum-sepolia")).toBe(true);
      return mockResponse(priceResponse(1500));
    };

    const result = JSON.parse(onHttpTrigger(runtime, makePayload(baseIntent)));
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("planning-only");
    expect(result.selectedActions).toHaveLength(1);
    expect(result.selectedActions[0].outputToken).toBe("WETH");
    expect(result.parsedActions).toHaveLength(1);
    expect(result.parsedActions[0].inputAmountAtomic).toBe("50000000");
    expect(requests).toBe(1);
  });

  test("else branch selected when no condition matches", () => {
    const runtime = newTestRuntime(setupSecrets());
    runtime.config = TEST_CONFIG;

    const mock = HttpActionsMock.testInstance();
    mock.sendRequest = () => mockResponse(priceResponse(2500, 15));

    const result = JSON.parse(onHttpTrigger(runtime, makePayload(baseIntent)));
    expect(result.selectedActions).toHaveLength(2);
    expect(result.parsedActions).toHaveLength(2);
    expect(result.parsedActions[0].outputToken).toBe("aBasUSDC");
    expect(result.parsedActions[1].outputToken).toBe("WETH");
  });
});

describe("initWorkflow", () => {
  test("returns one handler with HTTP trigger", () => {
    const handlers = initWorkflow(TEST_CONFIG);
    expect(handlers).toBeArray();
    expect(handlers).toHaveLength(1);
  });
});
