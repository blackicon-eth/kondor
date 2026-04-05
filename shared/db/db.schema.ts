import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  seedAddress: text("seed_address").primaryKey(),
  ensSubdomain: text("ens_subdomain"),
  textRecords: text("text_records").notNull().default("{}"),
  coinType: integer("coin_type").notNull(),
  queryNonce: integer("query_nonce").notNull().default(0),
  lastQueryAt: integer("last_query_at", { mode: "timestamp" }),
  moneriumData: text("monerium_data"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const stealthAddresses = sqliteTable("stealth_addresses", {
  address: text("address").primaryKey(),
  ensSubdomain: text("ens_subdomain").notNull(),
  salt: text("salt").notNull(),
  triggered: integer("triggered", { mode: "boolean" }).notNull().default(false),
  lastTriggeredAt: integer("last_triggered_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Alchemy webhook address tracking ─────────────────────────────────

export const watchedAddresses = sqliteTable("watched_addresses", {
  address: text("address").primaryKey(),
  addedAt: integer("added_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
