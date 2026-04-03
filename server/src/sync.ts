import { loadSyncedAddresses, saveSyncedAddresses, saveWatchedAddresses } from "./addressStore";
import { AlchemyWebhookManager } from "./alchemyWebhookManager";
import { config } from "./config";
import { getDb } from "./db.js";
import { subdomainAddresses, stealthAddresses } from "../../shared/db/db.schema.js";

export interface SyncResult {
  webhookId: string;
  added: number;
  removed: number;
  total: number;
}

function diffAddresses(previous: string[], next: string[]): { toAdd: string[]; toRemove: string[] } {
  const prevLower = new Set(previous.map((a) => a.toLowerCase()));
  const nextLower = new Set(next.map((a) => a.toLowerCase()));

  const toAdd = next.filter((address) => !prevLower.has(address.toLowerCase()));
  const toRemove = previous.filter((address) => !nextLower.has(address.toLowerCase()));

  return { toAdd, toRemove };
}

async function getAddressesFromDb(): Promise<string[]> {
  const rows = await getDb().select({ address: subdomainAddresses.address }).from(subdomainAddresses);
  const stealthRows = await getDb().select().from(stealthAddresses);
  const cutoff = Date.now() - 20 * 60 * 1000;
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const row of rows) {
    const v = row.address.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      addresses.push(v);
    }
  }

  for (const row of stealthRows) {
    const createdAtMs = row.createdAt?.getTime() ?? 0;
    const triggeredAtMs = row.lastTriggeredAt?.getTime() ?? 0;
    const isFresh = createdAtMs >= cutoff || triggeredAtMs >= cutoff;
    if (!isFresh) continue;

    const v = row.address.trim().toLowerCase();
    if (v && !seen.has(v)) {
      seen.add(v);
      addresses.push(v);
    }
  }

  return addresses;
}

export async function syncAlchemyWebhookAddresses(manager: AlchemyWebhookManager): Promise<SyncResult> {
  const watchedAddrs = await getAddressesFromDb();
  const lastSyncedAddrs = await loadSyncedAddresses();

  let webhookId = config.webhookId;
  if (!webhookId) {
    if (!config.autoCreateWebhook) {
      throw new Error("WEBHOOK_ID is empty and AUTO_CREATE_WEBHOOK=false. Cannot sync.");
    }
    if (!config.webhookUrl) {
      throw new Error("WEBHOOK_URL is required when auto-creating a webhook.");
    }

    webhookId = await manager.createAddressActivityWebhook({
      webhookUrl: config.webhookUrl,
      webhookName: config.webhookName,
      watchedAddresses: watchedAddrs,
    });
    console.log(`[sync] created webhook ${webhookId} with ${watchedAddrs.length} addresses`);
    await saveSyncedAddresses(watchedAddrs);
    await saveWatchedAddresses(watchedAddrs);

    return {
      webhookId,
      added: watchedAddrs.length,
      removed: 0,
      total: watchedAddrs.length,
    };
  }

  const { toAdd, toRemove } = diffAddresses(lastSyncedAddrs, watchedAddrs);
  if (toAdd.length > 0 || toRemove.length > 0) {
    await manager.updateWatchedAddresses({
      webhookId,
      addressesToAdd: toAdd,
      addressesToRemove: toRemove,
    });
    await saveSyncedAddresses(watchedAddrs);
    await saveWatchedAddresses(watchedAddrs);
  }

  return {
    webhookId,
    added: toAdd.length,
    removed: toRemove.length,
    total: watchedAddrs.length,
  };
}
