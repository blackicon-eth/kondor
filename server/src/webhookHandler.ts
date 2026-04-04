import { Request, Response } from "express";
import { config } from "./config";
import { AddressActivity, WebhookPayload } from "../../shared/types.js";
import { normalizeAddress, verifyAlchemySignature } from "../../shared/utils.js";
import { markStealthAddressTriggered, getSubdomainByStealthAddress } from "./gateway";
import { chainEventWorkflowAfterHttp, triggerCreWithPayload } from "./creTrigger";
import { resolveSepoliaTokenDecimals } from "./sepoliaTokens";

export interface WebhookHandlerDeps {
  watchedAddressSet: Set<string>;
  /**
   * Remove stealth/smart account address from Alchemy ADDRESS_ACTIVITY watch list before CRE runs,
   * so swap-internal transfers back to the same address do not re-trigger a webhook loop.
   */
  removeWatchedStealthAddress?: (normalizedAddress: string) => Promise<void>;
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

interface StoredPolicy {
  destinationChain: string;
  isRailgun: boolean;
  isOfframp: boolean;
  forwardTo?: string;
  tokens: Array<{
    inputToken: string;
    inputDecimals: number;
    ciphertext: string;
  }>;
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
    const matchedToKeys = new Set<string>();

    for (const activity of activities) {
      if (!isTokenTransfer(activity)) continue;
      const rawTo = getRawToAddress(activity);
      if (!rawTo || !deps.watchedAddressSet.has(rawTo.toLowerCase())) continue;
      const key = rawTo.toLowerCase();
      if (matchedToKeys.has(key)) continue;
      matchedToKeys.add(key);
      matched.push({ activity, to: rawTo });
    }

    for (const { activity, to } of matched) {
      const asset = (activity.asset || "").toUpperCase();
      const value = activity.value || activity.rawContract?.value || "0";
      const decimals = parseInt(activity.rawContract?.decimal ?? "18", 10);
      const from = activity.fromAddress || activity.from || "";

      console.log("[webhook] Incoming transfer:", {
        txHash: activity.hash,
        from,
        to,
        asset,
        value,
        decimals,
        tokenContract: normalizeAddress(activity.rawContract?.address || ""),
      });

      await markStealthAddressTriggered(to);

      // Look up stealth address → user → policy
      let record;
      try {
        record = await getSubdomainByStealthAddress(to);
      } catch (err) {
        console.error(`[webhook] Failed to lookup stealth address ${to}:`, err);
        continue;
      }

      if (!record) {
        console.log(`[webhook] No subdomain found for stealth address ${to}`);
        continue;
      }

      // Parse kondor-policy from text records
      const policyText = record.subdomain.text?.find(
        (r: { key: string; value: string }) => r.key === "kondor-policy",
      )?.value;

      if (!policyText) {
        console.log(`[webhook] No kondor-policy text record for ${record.ensSubdomain}`);
        continue;
      }

      let policy: StoredPolicy;
      try {
        policy = JSON.parse(policyText);
      } catch {
        console.error(`[webhook] Invalid kondor-policy JSON for ${record.ensSubdomain}`);
        continue;
      }

      // Find the matching token entry (per-token encrypted policy). If missing, still trigger CRE with
      // plaintext empty conditions / elseActions so the workflow reports touchedTokens + mode without swaps.
      const tokenEntry = policy.tokens?.find((t) => t.inputToken.toUpperCase() === asset);

      // activity.value is already human-readable (e.g. "100" for 100 USDC)
      // rawContract.value is hex/atomic — only divide if we fell back to it
      const rawValue = activity.value;
      const rawContractValue = activity.rawContract?.value;
      let inputAmount: number;
      if (rawValue && parseFloat(rawValue) > 0) {
        inputAmount = parseFloat(rawValue);
      } else if (rawContractValue) {
        // rawContract.value is atomic (hex or decimal string)
        const atomic = rawContractValue.startsWith("0x")
          ? BigInt(rawContractValue)
          : BigInt(rawContractValue);
        inputAmount = Number(atomic) / 10 ** decimals;
      } else {
        console.log(`[webhook] No transfer value for ${asset}, skipping`);
        continue;
      }

      const inputDecimals = tokenEntry
        ? tokenEntry.inputDecimals
        : resolveSepoliaTokenDecimals(asset, decimals);

      // Build CRE payload — with token policy row: ciphertext path. Without: plaintext empty branches (no ciphertext).
      const crePayload = tokenEntry
        ? {
            sender: to,
            forwardTo: policy.forwardTo,
            salt: record.salt,
            hashedOwner: "0x0000000000000000000000000000000000000000000000000000000000000000",
            chain: "ethereum-sepolia",
            destinationChain: policy.destinationChain,
            inputToken: tokenEntry.inputToken,
            inputAmount,
            inputDecimals,
            isRailgun: policy.isRailgun,
            isOfframp: policy.isOfframp,
            ciphertext: tokenEntry.ciphertext,
          }
        : {
            sender: to,
            forwardTo: policy.forwardTo,
            salt: record.salt,
            hashedOwner: "0x0000000000000000000000000000000000000000000000000000000000000000",
            chain: "ethereum-sepolia",
            destinationChain: policy.destinationChain,
            inputToken: asset,
            inputAmount,
            inputDecimals,
            isRailgun: policy.isRailgun,
            isOfframp: policy.isOfframp,
            conditions: [] as unknown[],
            elseActions: [] as unknown[],
          };

      if (!tokenEntry) {
        console.log(
          `[webhook] No token entry for "${asset}" in policy of ${record.ensSubdomain} — CRE with empty conditions/elseActions (decimals=${inputDecimals})`,
        );
      }

      const toNormalized = to.toLowerCase();
      if (deps.removeWatchedStealthAddress) {
        try {
          await deps.removeWatchedStealthAddress(toNormalized);
          console.log(`[webhook] Removed ${toNormalized} from Alchemy watch list before CRE`);
        } catch (err) {
          console.error(`[webhook] Failed to remove ${toNormalized} from Alchemy watch list:`, err);
        }
      }

      console.log("[webhook] Triggering CRE workflow:", JSON.stringify(crePayload, null, 2));

      triggerCreWithPayload(crePayload)
        .then(async (result) => {
          if (result.ok) {
            console.log(`[webhook] CRE workflow completed (exit ${result.exitCode})`);
          } else {
            console.error(`[webhook] CRE workflow failed (exit ${result.exitCode})`);
          }
          if (result.stdout) console.log("[cre:stdout]", result.stdout);
          if (result.stderr) console.error("[cre:stderr]", result.stderr);
          await chainEventWorkflowAfterHttp(result);
        })
        .catch((err) => {
          console.error("[webhook] CRE trigger error:", err);
        });
    }

    res.status(200).json({ ok: true, matched: matched.length });
  };
}
