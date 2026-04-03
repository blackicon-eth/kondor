import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  seedAddress: text("seed_address").primaryKey(),
  ensSubdomain: text("ens_subdomain"),
});

// ── Subdomains (ENS offchain resolver data) ──────────────────────────

export const subdomains = sqliteTable("subdomains", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const subdomainTextRecords = sqliteTable("subdomain_text_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subdomainName: text("subdomain_name").notNull().references(() => subdomains.name, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: text("value").notNull(),
});

export const subdomainAddresses = sqliteTable("subdomain_addresses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subdomainName: text("subdomain_name").notNull().references(() => subdomains.name, { onDelete: "cascade" }),
  coinType: integer("coin_type").notNull(),
  address: text("address").notNull(),
});

// ── Alchemy webhook address tracking ─────────────────────────────────

export const watchedAddresses = sqliteTable("watched_addresses", {
  address: text("address").primaryKey(),
  addedAt: integer("added_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const syncedAddresses = sqliteTable("synced_addresses", {
  address: text("address").primaryKey(),
  syncedAt: integer("synced_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const syncState = sqliteTable("sync_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
