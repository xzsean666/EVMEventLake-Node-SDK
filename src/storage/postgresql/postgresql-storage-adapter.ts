import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import { SqlStorageAdapter } from "../sql-storage-adapter.js";
import type { StorageDatabaseSchema } from "../storage-database-schema.js";

export interface PostgresqlStorageAdapterOptions {
  readonly connectionString?: string;
  readonly pool?: Pool;
}

export function createPostgresqlStorageAdapter(
  options: PostgresqlStorageAdapterOptions,
): SqlStorageAdapter {
  const pool =
    options.pool ??
    new Pool({
      connectionString: options.connectionString,
      max: 10,
    });
  const database = new Kysely<StorageDatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
  });
  return new SqlStorageAdapter(database, async () => {
    await database.destroy();
  });
}
