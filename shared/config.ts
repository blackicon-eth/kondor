function optional(name: string, fallback = ""): string {
  const value = process.env[name];
  return value?.trim() ?? fallback;
}

export const config = {
  alchemyApiKey: optional("ALCHEMY_API_KEY"),
  alchemyAuthToken: optional("ALCHEMY_AUTH_TOKEN"),
  webhookId: optional("WEBHOOK_ID"),
  webhookUrl: optional("WEBHOOK_URL"),
  webhookName: optional("WEBHOOK_NAME", "base-sepolia-address-activity"),
  autoCreateWebhook: optional("AUTO_CREATE_WEBHOOK", "true").toLowerCase() === "true",
  webhookSigningKey: optional("WEBHOOK_SIGNING_KEY"),
  ensDomain: optional("ENS_DOMAIN"),
  gatewaySignerPrivateKey: optional("GATEWAY_SIGNER_PRIVATE_KEY"),
  hasAlchemyConfig: Boolean(optional("ALCHEMY_API_KEY") && optional("ALCHEMY_AUTH_TOKEN")),
  uniswapApiKey: optional("UNISWAP_API_KEY"),
  hasUniswapConfig: Boolean(optional("UNISWAP_API_KEY")),
};
