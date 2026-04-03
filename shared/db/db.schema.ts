import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  seedAddress: text("seed_address").primaryKey(),
  ensSubdomain: text("ens_subdomain"),
});
