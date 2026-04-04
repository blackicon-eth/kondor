export type Config = {
  authorizedKeys: Array<{
    type: "KEY_TYPE_ECDSA_EVM";
    publicKey: string;
  }>;
  registryAddress: string;
  chainSelectorName: string;
};

export type Action = {
  actionType: "swap" | "supply" | "lp" | "stake";
  outputToken: string;
  percent: number;
};

export type ConditionBranch = {
  checks: Array<{
    token: string;
    operator: "<" | ">" | "<=" | ">=" | "==" | "!=";
    threshold: number;
  }>;
  actions: Action[];
};

export type Intent = {
  chain: string;
  destinationChain?: string;
  inputToken: string;
  inputAmount: number;
  inputDecimals: number;
  subnameString: string;
  sender: string;
  receiver: string;
  conditions: ConditionBranch[];
  elseActions: Action[];
};

export type PortalsPriceResponse = {
  tokens: Array<{ address: string; symbol: string; price: number }>;
};

export type Operator = "<" | ">" | "<=" | ">=" | "==" | "!=";
