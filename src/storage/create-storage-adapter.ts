import type { DatabaseConfiguration } from "../configuration/sdk-options.js";
import { createPostgresqlStorageAdapter } from "./postgresql/postgresql-storage-adapter.js";
import type { StorageAdapter } from "./storage-adapter.js";
import { createSqliteStorageAdapter } from "./sqlite/sqlite-storage-adapter.js";

export function createStorageAdapter(
  configuration: DatabaseConfiguration,
): StorageAdapter {
  if (configuration.kind === "sqlite") {
    return createSqliteStorageAdapter(configuration.filename);
  }
  return createPostgresqlStorageAdapter({
    connectionString: configuration.connectionString,
  });
}
