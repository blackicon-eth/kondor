// ─── Policy JSON types ───────────────────────────────────────────────────────

export type PolicyAction = {
  actionType: "swap" | "lend";
  outputToken: string;
  percent: number;
};

export type PolicyCheck = {
  token: string;
  operator: "<" | ">";
  threshold: number;
};

export type PolicyCondition = {
  checks: PolicyCheck[];
  actions: PolicyAction[];
};

export type PolicyToken = {
  inputToken: string;
  inputDecimals: number;
  conditions: PolicyCondition[];
  elseActions: PolicyAction[];
};

export type PolicyJson = {
  destinationChain: string;
  isRailgun: boolean;
  isOfframp: boolean;
  forwardTo: string;
  tokens: PolicyToken[];
};

// ─── Token decimals map ──────────────────────────────────────────────────────

const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  WETH: 18,
  WBTC: 8,
  LINK: 18,
  UNI: 18,
};

// ─── Flow config types (from the UI) ─────────────────────────────────────────

export type OutcomeConfig = {
  swapToken: string;
  swapPct: number;
  aavePct: number;
  destPct: number;
};

export type FlowConfig = {
  sourceToken: string;
  branchingEnabled: boolean;
  condition: {
    token: string;
    operator: "<" | ">";
    amount: number;
  };
  outcomeIf: OutcomeConfig;
  outcomeElse: OutcomeConfig;
  outcome: OutcomeConfig;
  destinationWallet: string;
  railgunWallet: string;
  privateMode: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function outcomeToActions(outcome: OutcomeConfig): PolicyAction[] {
  const actions: PolicyAction[] = [];
  if (outcome.swapPct > 0) {
    actions.push({ actionType: "swap", outputToken: outcome.swapToken, percent: outcome.swapPct });
  }
  if (outcome.aavePct > 0) {
    actions.push({ actionType: "lend", outputToken: "AAVE", percent: outcome.aavePct });
  }
  return actions;
}

function flowConfigToToken(config: FlowConfig): PolicyToken {
  const token: PolicyToken = {
    inputToken: config.sourceToken,
    inputDecimals: TOKEN_DECIMALS[config.sourceToken] ?? 18,
    conditions: [],
    elseActions: [],
  };

  if (config.branchingEnabled) {
    token.conditions = [
      {
        checks: [
          {
            token: config.condition.token,
            operator: config.condition.operator,
            threshold: config.condition.amount,
          },
        ],
        actions: outcomeToActions(config.outcomeIf),
      },
    ];
    token.elseActions = outcomeToActions(config.outcomeElse);
  } else {
    token.elseActions = outcomeToActions(config.outcome);
  }

  return token;
}

// ─── Reverse mapping: PolicyJson → FlowConfig ───────────────────────────────

function actionsToOutcome(actions: PolicyAction[]): OutcomeConfig {
  const swap = actions.find((a) => a.actionType === "swap");
  const lend = actions.find((a) => a.actionType === "lend");
  const swapPct = swap?.percent ?? 0;
  const aavePct = lend?.percent ?? 0;
  return {
    swapToken: swap?.outputToken ?? "WETH",
    swapPct,
    aavePct,
    destPct: Math.max(0, 100 - swapPct - aavePct),
  };
}

/**
 * Converts a decrypted PolicyJson into a FlowConfig for a specific input token.
 * Returns null if the token is not found in the policy.
 */
export function policyToFlowConfig(
  policy: PolicyJson,
  inputToken: string,
): FlowConfig | null {
  const token = policy.tokens.find((t) => t.inputToken === inputToken);
  if (!token) return null;

  const hasBranching = token.conditions.length > 0;
  const firstCondition = token.conditions[0];
  const firstCheck = firstCondition?.checks[0];

  return {
    sourceToken: token.inputToken,
    branchingEnabled: hasBranching,
    condition: {
      token: firstCheck?.token ?? "WETH",
      operator: (firstCheck?.operator ?? ">") as "<" | ">",
      amount: firstCheck?.threshold ?? 3000,
    },
    outcomeIf: hasBranching ? actionsToOutcome(firstCondition.actions) : { swapToken: "WETH", swapPct: 25, aavePct: 25, destPct: 50 },
    outcomeElse: actionsToOutcome(token.elseActions),
    outcome: hasBranching ? { swapToken: "WETH", swapPct: 25, aavePct: 25, destPct: 50 } : actionsToOutcome(token.elseActions),
    destinationWallet: policy.isRailgun ? "" : policy.forwardTo,
    railgunWallet: policy.isRailgun ? policy.forwardTo : "",
    privateMode: policy.isRailgun,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Builds a PolicyToken entry from a flow config.
 * Replaces any existing entry for the same inputToken in the tokens array,
 * or appends it if not present.
 */
export function upsertPolicyToken(
  existingTokens: PolicyToken[],
  config: FlowConfig
): PolicyToken[] {
  const newToken = flowConfigToToken(config);
  const idx = existingTokens.findIndex((t) => t.inputToken === newToken.inputToken);

  if (idx >= 0) {
    const updated = [...existingTokens];
    updated[idx] = newToken;
    return updated;
  }

  return [...existingTokens, newToken];
}

/**
 * Builds a complete policy JSON from a flow config and optional existing tokens.
 * The flow config's sourceToken entry is upserted into the tokens array.
 */
// ─── Encrypted policy types ──────────────────────────────────────────────────

export type EncryptedPolicyToken = {
  inputToken: string;
  inputDecimals: number;
  ciphertext: string;
};

export type EncryptedPolicy = {
  destinationChain: string;
  isRailgun: boolean;
  isOfframp: boolean;
  forwardTo: string;
  tokens: EncryptedPolicyToken[];
};

export type TextRecord = {
  description: string;
  railgunAddress?: string;
  "kondor-policy": string;
};

/**
 * Builds a text record object from an encrypted policy.
 * Merges with existing text records to preserve other fields.
 */
export function buildTextRecord(
  encryptedPolicy: EncryptedPolicy,
  ensName: string,
  existingTextRecords: Partial<TextRecord> = {},
): TextRecord {
  return {
    ...existingTextRecords,
    description: `${ensName}'s policy`,
    railgunAddress: encryptedPolicy.isRailgun ? encryptedPolicy.forwardTo : "",
    "kondor-policy": JSON.stringify(encryptedPolicy),
  };
}

export function buildPolicy(
  config: FlowConfig,
  existingTokens: PolicyToken[] = []
): PolicyJson {
  return {
    destinationChain: "ethereum-sepolia",
    isRailgun: config.privateMode,
    isOfframp: false,
    forwardTo: config.privateMode ? config.railgunWallet : config.destinationWallet,
    tokens: upsertPolicyToken(existingTokens, config),
  };
}
