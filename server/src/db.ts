import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "../../shared/db/db.schema.js";

let _db: LibSQLDatabase<typeof schema> | undefined;

export function getDb(): LibSQLDatabase<typeof schema> {
  if (!_db) {
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}

export { schema };
