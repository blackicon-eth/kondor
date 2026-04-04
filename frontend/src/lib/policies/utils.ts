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
  DAI: 18,
  EURe: 18,
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
