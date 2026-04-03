import { getDb } from "./db.js";
import { watchedAddresses, syncedAddresses } from "../../shared/db/db.schema.js";
import { dedupeNormalized } from "../../shared/utils.js";

export async function loadWatchedAddresses(): Promise<string[]> {
  const rows = await getDb().select().from(watchedAddresses);
  return dedupeNormalized(rows.map((r) => r.address));
}

export async function saveWatchedAddresses(addresses: string[]): Promise<void> {
  const deduped = dedupeNormalized(addresses);
  await getDb().delete(watchedAddresses);
  if (deduped.length > 0) {
    await getDb().insert(watchedAddresses).values(deduped.map((address) => ({ address })));
  }
}

export async function loadSyncedAddresses(): Promise<string[]> {
  const rows = await getDb().select().from(syncedAddresses);
  return dedupeNormalized(rows.map((r) => r.address));
}

export async function saveSyncedAddresses(addresses: string[]): Promise<void> {
  const deduped = dedupeNormalized(addresses);
  await getDb().delete(syncedAddresses);
  if (deduped.length > 0) {
    await getDb().insert(syncedAddresses).values(deduped.map((address) => ({ address })));
  }
}
