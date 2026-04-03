import "./env";
import express from "express";
import cors from "cors";
import { AlchemyWebhookManager } from "./alchemyWebhookManager";
import { loadWatchedAddresses } from "./addressStore";
import { config } from "./config";
import { syncAlchemyWebhookAddresses } from "./sync";
import { createAlchemyWebhookHandler } from "./webhookHandler";
import {
  handleGatewayRequest,
  registerSubdomain,
  updateSubdomainTextRecords,
  getSubdomainWithRecords,
  getAllSubdomains,
} from "./gateway";

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

    try {
      const syncResult = await syncAlchemyWebhookAddresses(manager);
      webhookId = syncResult.webhookId;
      console.log(
        `[sync] webhook=${syncResult.webhookId} added=${syncResult.added} removed=${syncResult.removed} total=${syncResult.total}`
      );
    } catch (err) {
      console.warn("[sync] Initial sync failed:", err);
    }

    webhookDeps = { watchedAddressSet: watchedAddresses };
    alchemyWebhookHandler = createAlchemyWebhookHandler(webhookDeps);
  } else {
    console.log("[alchemy] skipping webhook bootstrap because ALCHEMY_API_KEY or ALCHEMY_AUTH_TOKEN is missing");
  }

  // ── Health ───────────────────────────────────────────────────────

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      alchemyConfigured: config.hasAlchemyConfig,
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

  // ── Sync addresses ──────────────────────────────────────────────

  app.post("/sync-addresses", async (_req, res) => {
    try {
      if (!manager) {
        res.status(503).json({ ok: false, error: "Alchemy is not configured" });
        return;
      }

      const result = await syncAlchemyWebhookAddresses(manager);
      webhookId = result.webhookId;
      watchedAddresses = new Set(await loadWatchedAddresses());
      if (webhookDeps) {
        webhookDeps.watchedAddressSet = watchedAddresses;
      }
      res.json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: message });
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

  app.post("/subdomains/register", async (req, res) => {
    try {
      const { name, owner, text, addresses } = req.body as {
        name?: string;
        owner?: string;
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

      await registerSubdomain(name, owner, text, addresses);

      // Sync webhook addresses after registration
      if (manager) {
        try {
          const syncResult = await syncAlchemyWebhookAddresses(manager);
          webhookId = syncResult.webhookId;
          watchedAddresses = new Set(await loadWatchedAddresses());
          if (webhookDeps) {
            webhookDeps.watchedAddressSet = watchedAddresses;
          }
          console.log(`[register] sync complete: added=${syncResult.added} total=${syncResult.total}`);
        } catch (syncErr) {
          console.warn("[register] Sync addresses failed:", syncErr);
        }
      }

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

  // ── Start ───────────────────────────────────────────────────────

  app.listen(config.port, () => {
    console.log(`express server running on http://localhost:${config.port}`);
    console.log("endpoints:");
    console.log("  GET  /health");
    console.log("  POST /webhooks/alchemy");
    console.log("  POST /sync-addresses");
    console.log("  GET  /gateway/:sender/:data");
    console.log("  GET  /subdomains");
    console.log("  GET  /subdomains/:name");
    console.log("  POST /subdomains/register");
    console.log("  POST /subdomains/update-text");
  });
}

bootstrap().catch((error) => {
  console.error("[fatal]", error);
  process.exit(1);
});
