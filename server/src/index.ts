import "./env";
import express from "express";
import cors from "cors";
import { AlchemyWebhookManager } from "./alchemyWebhookManager";
import { loadWatchedAddresses, saveWatchedAddresses } from "./addressStore";
import { config } from "./config";
import { createAlchemyWebhookHandler } from "./webhookHandler";
import { createBatchSwap5792, type BatchSwap5792Request } from "./uniswap";
import { createRailgunShieldBatch } from "./railgun";
import {
  configureGatewayDeps,
  handleGatewayRequest,
  registerSubdomain,
  updateSubdomainTextRecords,
  getSubdomainWithRecords,
  getAllSubdomains,
  getSubdomainByStealthAddress,
  getSubdomainBySeed,
} from "./gateway";
import {
  encrypt,
  hexToBytes,
  ed25519PubToX25519,
  ed25519PrivToX25519,
} from "@kondor/shared/crypto";

async function bootstrap(): Promise<void> {
  const app = express();
  let watchedAddresses = new Set<string>();
  let webhookId: string | undefined;
  let webhookDeps:
    | { watchedAddressSet: Set<string> }
    | undefined;
  let alchemyWebhookHandler:
    | ((req: express.Request, res: express.Response) => Promise<void>)
    | undefined;
  let manager: AlchemyWebhookManager | undefined;

  // CCIP-Read gateway must be callable from the ENS app and any dApp origin. A single
  // restrictive cors() would run after /gateway and block https://app.ens.domains fetches.
  const restrictiveCors = cors({
    origin: config.corsOrigin,
    credentials: true,
    allowedHeaders: ["Content-Type", "x-address", "x-message", "x-signature"],
  });

  app.use((req, res, next) => {
    if (req.path.startsWith("/gateway")) {
      cors()(req, res, next);
    } else {
      restrictiveCors(req, res, next);
    }
  });

  // ── Alchemy webhook bootstrap ────────────────────────────────────

  if (config.hasAlchemyConfig) {
    manager = new AlchemyWebhookManager({
      apiKey: config.alchemyApiKey,
      authToken: config.alchemyAuthToken,
    });

    watchedAddresses = new Set(await loadWatchedAddresses());
    webhookId = config.webhookId;

    if (!webhookId && config.autoCreateWebhook && config.webhookUrl) {
      try {
        webhookId = await manager.createAddressActivityWebhook({
          webhookUrl: config.webhookUrl,
          webhookName: config.webhookName,
          watchedAddresses: Array.from(watchedAddresses),
        });
        console.log(`[alchemy] created webhook ${webhookId}`);
      } catch (err) {
        console.warn("[alchemy] failed to auto-create webhook:", err);
      }
    }

    if (!webhookId) {
      console.warn("[alchemy] WEBHOOK_ID is missing, new stealth addresses will not be pushed");
    }

    webhookDeps = {
      watchedAddressSet: watchedAddresses,
      removeWatchedStealthAddress: async (normalized: string) => {
        if (!manager || !webhookId) return;
        if (!watchedAddresses.has(normalized)) return;
        await manager.updateWatchedAddresses({
          webhookId,
          addressesToAdd: [],
          addressesToRemove: [normalized],
        });
        watchedAddresses.delete(normalized);
        await saveWatchedAddresses(Array.from(watchedAddresses));
      },
    };
    alchemyWebhookHandler = createAlchemyWebhookHandler(webhookDeps);
  } else {
    console.log("[alchemy] skipping webhook bootstrap because ALCHEMY_API_KEY or ALCHEMY_AUTH_TOKEN is missing");
  }

  configureGatewayDeps({
    onStealthAddressGenerated: async (address) => {
      const normalized = address.toLowerCase();
      if (!manager || !webhookId) {
        return;
      }

      if (watchedAddresses.has(normalized)) {
        return;
      }

      await manager.updateWatchedAddresses({
        webhookId,
        addressesToAdd: [normalized],
        addressesToRemove: [],
      });

      watchedAddresses.add(normalized);
      await saveWatchedAddresses(Array.from(watchedAddresses));
      if (webhookDeps) {
        webhookDeps.watchedAddressSet = watchedAddresses;
      }
    },
  });

  // ── Health ───────────────────────────────────────────────────────

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      alchemyConfigured: config.hasAlchemyConfig,
      uniswapConfigured: config.hasUniswapConfig,
      ensDomain: config.ensDomain || null,
      watchedAddresses: watchedAddresses.size,
    });
  });

  // ── Webhook logging middleware ───────────────────────────────────

  app.use((req, _res, next) => {
    if (req.path === "/webhooks/alchemy" || req.path === "/webhooks/alchemy/") {
      console.log(`[webhook] Incoming ${req.method} ${req.path}`);
    }
    next();
  });

  // ── Alchemy webhook endpoint (raw body) ─────────────────────────

  const alchemyWebhook = express.raw({ type: "*/*", limit: "2mb" });
  const handleAlchemyWebhook = (req: express.Request, res: express.Response) => {
    if (!alchemyWebhookHandler) {
      res.status(503).json({ ok: false, error: "Alchemy webhook handler is not configured" });
      return;
    }
    alchemyWebhookHandler(req, res).catch((err) => {
      console.error("[webhook] Unhandled error:", err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "Internal error" });
      }
    });
  };
  app.post("/webhooks/alchemy", alchemyWebhook, handleAlchemyWebhook);
  app.post("/webhooks/alchemy/", alchemyWebhook, handleAlchemyWebhook);

  // ── JSON body parser for remaining routes ───────────────────────

  app.use(express.json());

  // ── Uniswap batch quote + swap_5792 wrapper ─────────────────────

  app.post("/swap_5792", async (req, res) => {
    try {
      if (!config.hasUniswapConfig || !config.uniswapApiKey) {
        res.status(503).json({ ok: false, error: "UNISWAP_API_KEY is not configured" });
        return;
      }

      const payload = req.body as BatchSwap5792Request;
      const result = await createBatchSwap5792(payload, config.uniswapApiKey);
      res.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.post("/railgun/shield-calls", async (req, res) => {
    try {
      const balancesInput = Array.isArray(req.body?.balances) ? req.body.balances : null;
      if (!balancesInput) {
        res.status(400).json({ ok: false, error: "balances array is required" });
        return;
      }

      const balances = balancesInput.flatMap((item: unknown) => {
        if (!item || typeof item !== "object") return [];
        const token = typeof (item as { token?: unknown }).token === "string"
          ? (item as { token: string }).token
          : null;
        const balance = typeof (item as { balance?: unknown }).balance === "string"
          ? (item as { balance: string }).balance
          : null;

        if (!token || !balance) return [];

        return [{ token: token as `0x${string}`, balance: BigInt(balance) }];
      });

      const result = await createRailgunShieldBatch(balances);
      res.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ ok: false, error: message });
    }
  });

  // ── ENS CCIP-Read gateway (ERC-3668) ────────────────────────────

  app.get("/gateway/:sender/:data", handleGatewayRequest);

  // ── Subdomain endpoints ─────────────────────────────────────────

  app.get("/subdomains", async (_req, res) => {
    try {
      const subs = await getAllSubdomains();
      res.json({ ok: true, subdomains: subs });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get("/subdomains/:name", async (req, res) => {
    try {
      const sub = await getSubdomainWithRecords(req.params.name);
      if (!sub) {
        res.status(404).json({ ok: false, error: "Subdomain not found" });
        return;
      }
      res.json({ ok: true, subdomain: sub });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get("/getSubdomainByStealthAddress", async (req, res) => {
    try {
      const address = String(req.query.address ?? "").trim();
      if (!address) {
        res.status(400).json({ ok: false, error: "address query param is required" });
        return;
      }
      const result = await getSubdomainByStealthAddress(address);
      if (!result) {
        res.status(404).json({ ok: false, error: "No subdomain mapping found for address" });
        return;
      }
      res.json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.get("/getSubdomainBySeed", async (req, res) => {
    try {
      const seedAddress = String(req.query.seedAddress ?? "").trim();
      if (!seedAddress) {
        res.status(400).json({ ok: false, error: "seedAddress query param is required" });
        return;
      }
      const result = await getSubdomainBySeed(seedAddress);
      if (!result) {
        res.status(404).json({ ok: false, error: "No subdomain found for seedAddress" });
        return;
      }
      res.json({ ok: true, subdomain: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.post("/subdomains/register", async (req, res) => {
    try {
      const { name, owner, seedAddress, text, addresses } = req.body as {
        name?: string;
        owner?: string;
        seedAddress?: string;
        text?: Array<{ key: string; value: string }>;
        addresses?: Array<{ coinType: number; address: string }>;
      };

      if (!name || !owner) {
        res.status(400).json({ ok: false, error: "name and owner are required" });
        return;
      }

      const existing = await getSubdomainWithRecords(name);
      if (existing) {
        res.status(409).json({ ok: false, error: "Subdomain already exists" });
        return;
      }

      await registerSubdomain(name, owner, seedAddress, text, addresses);

      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  app.post("/subdomains/update-text", async (req, res) => {
    try {
      const { name, text } = req.body as {
        name?: string;
        text?: Array<{ key: string; value: string }>;
      };

      if (!name || !text) {
        res.status(400).json({ ok: false, error: "name and text are required" });
        return;
      }

      const existing = await getSubdomainWithRecords(name);
      if (!existing) {
        res.status(404).json({ ok: false, error: "Subdomain not found" });
        return;
      }

      await updateSubdomainTextRecords(name, text);
      res.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  // Encrypt a policy payload and store it as "kondor-policy" text record
  // Each token's conditions/elseActions are encrypted individually
  app.post("/subdomains/update-policy", async (req, res) => {
    try {
      const { name, policy } = req.body as {
        name?: string;
        policy?: {
          destinationChain: string;
          isRailgun: boolean;
          isOfframp: boolean;
          forwardTo?: string;
          tokens: Array<{
            inputToken: string;
            inputDecimals: number;
            conditions: unknown[];
            elseActions: unknown[];
          }>;
        };
      };

      if (!name || !policy || !policy.tokens?.length) {
        res.status(400).json({ ok: false, error: "name and policy with tokens are required" });
        return;
      }

      const existing = await getSubdomainWithRecords(name);
      if (!existing) {
        res.status(404).json({ ok: false, error: "Subdomain not found" });
        return;
      }

      const crePubHex = process.env.ASYM_KEY_EDDSA25519?.trim();
      const serverPrivHex = process.env.ASYM_PRIV_KEY_EDDSA25519?.trim();

      if (!crePubHex || !serverPrivHex) {
        res.status(503).json({ ok: false, error: "EdDSA keys not configured" });
        return;
      }

      const crePubX = ed25519PubToX25519(hexToBytes(crePubHex));
      const serverPrivX = ed25519PrivToX25519(hexToBytes(serverPrivHex));

      // Encrypt conditions/elseActions per token, keep metadata plaintext
      const storedTokens = policy.tokens.map((token) => {
        const plaintext = JSON.stringify({
          conditions: token.conditions,
          elseActions: token.elseActions,
        });
        return {
          inputToken: token.inputToken,
          inputDecimals: token.inputDecimals,
          ciphertext: encrypt(plaintext, serverPrivX, crePubX),
        };
      });

      const storedPolicy = {
        destinationChain: policy.destinationChain,
        isRailgun: policy.isRailgun,
        isOfframp: policy.isOfframp,
        forwardTo: policy.forwardTo,
        tokens: storedTokens,
      };

      await updateSubdomainTextRecords(name, [
        { key: "kondor-policy", value: JSON.stringify(storedPolicy) },
      ]);

      res.json({ ok: true, policy: storedPolicy });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
    }
  });

  // ── Start ───────────────────────────────────────────────────────

  app.listen(config.port, () => {
    console.log(`express server running on http://localhost:${config.port}`);
    console.log("endpoints:");
    console.log("  GET  /health");
    console.log("  POST /webhooks/alchemy");
    console.log("  POST /swap_5792");
    console.log("  GET  /gateway/:sender/:data");
    console.log("  GET  /subdomains");
    console.log("  GET  /subdomains/:name");
    console.log("  GET  /getSubdomainByStealthAddress?address=0x...");
    console.log("  GET  /getSubdomainBySeed?seedAddress=0x...");
    console.log("  POST /subdomains/register");
    console.log("  POST /subdomains/update-text");
  });
}

bootstrap().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
