import { getDb } from "./db.js";
import { watchedAddresses } from "../../shared/db/db.schema.js";
import { dedupeNormalized } from "../../shared/utils.js";

export async function loadWatchedAddresses(): Promise<string[]> {
  const rows = await getDb().select().from(watchedAddresses);
  return dedupeNormalized(rows.map((r: { address: string }) => r.address));
}

export async function saveWatchedAddresses(addresses: string[]): Promise<void> {
  const deduped = dedupeNormalized(addresses);
  await getDb().delete(watchedAddresses);
  if (deduped.length > 0) {
    await getDb().insert(watchedAddresses).values(deduped.map((address) => ({ address })));
  }
}
