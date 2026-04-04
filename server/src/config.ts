import { config as sharedConfig } from "../../shared/config.js";

function optional(name: string, fallback = ""): string {
  const v = process.env[name]?.trim();
  return v ?? fallback;
}

export const config = {
  ...sharedConfig,
  port: Number(process.env.EXPRESS_PORT ?? process.env.PORT ?? "3001"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  /** Sepolia JSON-RPC for receipt lookup after HTTP CRE writeReport (match event-triggered project RPC when possible). */
  sepoliaRpcUrl: optional("SEPOLIA_RPC_URL", "https://1rpc.io/sepolia"),
  kondorRegistryAddress: optional("KONDOR_REGISTRY_ADDRESS"),
  /** After HTTP CRE completes, resolve ReportProcessed log index and run event-triggered CRE (simulate + broadcast). */
  autoChainEventCre: process.env.AUTO_CHAIN_EVENT_CRE?.trim().toLowerCase() !== "false",
};
