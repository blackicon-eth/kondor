import { ByteUtils, RailgunEngine, ShieldNoteERC20 } from "@railgun-community/engine";
import { NETWORK_CONFIG, NetworkName } from "@railgun-community/shared-models";
import { encodeFunctionData, erc20Abi, parseAbi, type Hex } from "viem";

const RAILGUN_SHIELD_ABI = parseAbi([
  "function shield(((bytes32 npk,(uint8 tokenType,address tokenAddress,uint256 tokenSubID) token,uint120 value) preimage,(bytes32[3] encryptedBundle,bytes32 shieldKey) ciphertext)[] _shieldRequests) payable",
]);

const RAILGUN_RECIPIENT =
  "0zk1qys0kkfd4nqfyvy8l97g6w956eq5pep8ykw5a9k8l5x52s78jjrklrv7j6fe3z53lamf5at0x9zn536suzs4lym7zaunud8xyh5cner4hw4l7m9mf4l5camflul";
const SHIELD_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;
const RAILGUN_NETWORK = NetworkName.EthereumSepolia;
const RAILGUN_SHIELDER_CONTRACT = NETWORK_CONFIG[RAILGUN_NETWORK].proxyContract as Hex;

export type RailgunShieldBalance = {
  token: Hex;
  balance: bigint;
};

export type RailgunShieldBatch = {
  count: number;
  targets: Hex[];
  values: string[];
  calldatas: Hex[];
};

async function createShieldRequest(token: Hex, amount: bigint) {
  const { masterPublicKey, viewingPublicKey } = RailgunEngine.decodeAddress(RAILGUN_RECIPIENT);
  const random = ByteUtils.randomHex(16);
  const shield = new ShieldNoteERC20(masterPublicKey, random, amount, token);
  return shield.serialize(ByteUtils.hexToBytes(SHIELD_PRIVATE_KEY), viewingPublicKey);
}

export async function createRailgunShieldBatch(
  balances: RailgunShieldBalance[]
): Promise<RailgunShieldBatch> {
  const positiveBalances = balances.filter(({ balance }) => balance > 0n);
  const targets: Hex[] = [];
  const values: string[] = [];
  const calldatas: Hex[] = [];

  // First approve every token to the Sepolia Railgun shielder/proxy.
  for (const { token, balance } of positiveBalances) {
    targets.push(token);
    values.push("0");
    calldatas.push(
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [RAILGUN_SHIELDER_CONTRACT, balance],
      })
    );
  }

  // Then shield every approved token amount in order.
  for (const { token, balance } of positiveBalances) {
    const shieldRequest = await createShieldRequest(token, balance);

    targets.push(RAILGUN_SHIELDER_CONTRACT);
    values.push("0");
    calldatas.push(
      encodeFunctionData({
        abi: RAILGUN_SHIELD_ABI,
        functionName: "shield",
        args: [[shieldRequest as never]],
      })
    );
  }

  return {
    count: targets.length,
    targets,
    values,
    calldatas,
  };
}
