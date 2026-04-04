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
  salt: string;              // bytes32 hex — CREATE2 salt for the smart account
  subnameString?: string;     // legacy, will be removed
  sender: string;
  receiver: string;
  hashedOwner: string;         // bytes32 hex — keccak256(abi.encodePacked(ownerAddress))
  isRailgun: boolean;
  isOfframp: boolean;
  conditions: ConditionBranch[];
  elseActions: Action[];
};

// 0 = Railgun (private), 1 = OffRamp (cash out), 2 = ForwardTo (send to receiver)
export type Mode = 0 | 1 | 2;

export type PortalsPriceResponse = {
  tokens: Array<{ address: string; symbol: string; price: number }>;
};

export type Operator = "<" | ">" | "<=" | ">=" | "==" | "!=";
