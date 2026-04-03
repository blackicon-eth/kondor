import { Request, Response } from "express";
import { config } from "./config";
import { AddressActivity, WebhookPayload } from "../../shared/types.js";
import { normalizeAddress, verifyAlchemySignature } from "../../shared/utils.js";
import { markStealthAddressTriggered } from "./gateway";

export interface WebhookHandlerDeps {
  watchedAddressSet: Set<string>;
}

function extractActivities(payload: WebhookPayload): AddressActivity[] {
  return payload.event?.activity ?? payload.activity ?? [];
}

function isTokenTransfer(activity: AddressActivity): boolean {
  const category = activity.category?.toLowerCase() ?? "";
  return category.includes("token") || category.includes("erc20");
}

function getRawToAddress(activity: AddressActivity): string {
  return (activity.toAddress || activity.to || "").trim();
}

export function createAlchemyWebhookHandler(deps: WebhookHandlerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    console.log("[webhook] Alchemy POST received");
    const rawBody =
      req.body instanceof Buffer
        ? req.body
        : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
    const bodyStr = rawBody.toString("utf8");
    let payload: WebhookPayload = {};
    try {
      payload = bodyStr ? (JSON.parse(bodyStr) as WebhookPayload) : {};
    } catch {
      console.log("[webhook] Invalid JSON payload, body length:", bodyStr.length, "preview:", bodyStr.slice(0, 200));
      res.status(400).json({ ok: false, error: "Invalid JSON payload" });
      return;
    }

    if (config.webhookSigningKey) {
      const signature = String(req.header("x-alchemy-signature") || "");
      if (!signature || !verifyAlchemySignature(rawBody, signature, config.webhookSigningKey)) {
        console.log("[webhook] Signature verification failed (401)");
        res.status(401).json({ ok: false, error: "Invalid signature" });
        return;
      }
    }

    const activities = extractActivities(payload);
    const matched: Array<{ activity: AddressActivity; to: string }> = [];

    for (const activity of activities) {
      if (!isTokenTransfer(activity)) continue;
      const rawTo = getRawToAddress(activity);
      if (!rawTo || !deps.watchedAddressSet.has(rawTo.toLowerCase())) continue;
      matched.push({ activity, to: rawTo });
    }

    for (const { activity, to } of matched) {
      const asset = (activity.asset || "").toUpperCase();

      console.log("[webhook] Incoming transfer:", {
        txHash: activity.hash,
        from: activity.fromAddress || activity.from,
        to,
        asset,
        value: activity.value || activity.rawContract?.value || null,
        decimals: activity.rawContract?.decimal ?? null,
        tokenContract: normalizeAddress(activity.rawContract?.address || ""),
      });

      // TODO: look up subdomain policy from DB and trigger CRE workflow
      await markStealthAddressTriggered(to);
    }

    res.status(200).json({ ok: true, matched: matched.length });
  };
}
