import { existsSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

import { StorageInitializationError } from "../../errors/evm-event-lake-errors.js";
import { SqlStorageAdapter } from "../sql-storage-adapter.js";
import type { StorageDatabaseSchema } from "../storage-database-schema.js";

export function createSqliteStorageAdapter(
  filename: string,
): SqlStorageAdapter {
  const parentDirectory = dirname(filename);
  if (!existsSync(parentDirectory)) {
    throw new StorageInitializationError(
      "SQLite parent directory does not exist",
      { context: { parentDirectory } },
    );
  }

  let sqliteDatabase: Database.Database;
  try {
    sqliteDatabase = new Database(filename);
    sqliteDatabase.pragma("foreign_keys = ON");
    sqliteDatabase.pragma("journal_mode = WAL");
    sqliteDatabase.pragma("busy_timeout = 5000");
  } catch (cause) {
    throw new StorageInitializationError("Unable to open SQLite database", {
      cause,
      context: { filename },
    });
  }

  const database = new Kysely<StorageDatabaseSchema>({
    dialect: new SqliteDialect({ database: sqliteDatabase }),
  });
  return new SqlStorageAdapter(database, async () => {
    await database.destroy();
  });
}
