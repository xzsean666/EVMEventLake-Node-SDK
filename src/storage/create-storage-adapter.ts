import type { DatabaseConfiguration } from "../configuration/sdk-options.js";
import { UnsupportedDatabaseUrlError } from "../errors/evm-event-lake-errors.js";
import type { StorageAdapter } from "./storage-adapter.js";

export async function createStorageAdapter(
  configuration: DatabaseConfiguration,
): Promise<StorageAdapter> {
  if (configuration.kind === "sqlite") {
    const { createSqliteStorageAdapter } =
      await import("./sqlite/sqlite-storage-adapter.js");
    return createSqliteStorageAdapter(configuration.filename);
  }
  if (configuration.kind === "postgresql") {
    const { createPostgresqlStorageAdapter } =
      await import("./postgresql/postgresql-storage-adapter.js");
    return createPostgresqlStorageAdapter({
      connectionString: configuration.connectionString,
    });
  }
  if (configuration.kind === "indexeddb") {
    const { createIndexeddbStorageAdapter } =
      await import("./indexeddb/indexeddb-storage-adapter.js");
    return createIndexeddbStorageAdapter(configuration.databaseName);
  }
  throw new UnsupportedDatabaseUrlError("Unsupported database configuration");
}
