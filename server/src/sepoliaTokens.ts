/**
 * Decimals for tokens we support on Ethereum Sepolia (aligned with CRE http-triggered SEPOLIA_TOKENS).
 * Used when a webhook asset has no per-token policy row — CRE still needs correct decimals for amounts.
 */
export const SEPOLIA_TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  DAI: 18,
  WETH: 18,
  WBTC: 8,
  LINK: 18,
  EURE: 18,
};

export function resolveSepoliaTokenDecimals(symbol: string, webhookDecimals: number): number {
  const key = symbol.trim().toUpperCase();
  const hardcoded = SEPOLIA_TOKEN_DECIMALS[key];
  if (hardcoded !== undefined) return hardcoded;
  if (Number.isFinite(webhookDecimals) && webhookDecimals >= 0) return webhookDecimals;
  return 18;
}
