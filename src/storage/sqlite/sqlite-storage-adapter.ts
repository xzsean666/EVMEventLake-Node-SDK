import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Kysely } from "kysely";

import { StorageInitializationError } from "../../errors/evm-event-lake-errors.js";
import { SqlStorageAdapter } from "../sql-storage-adapter.js";
import type { StorageDatabaseSchema } from "../storage-database-schema.js";
import { NodeSqliteDialect } from "./node-sqlite-dialect.js";

export function createSqliteStorageAdapter(
  filename: string,
): SqlStorageAdapter {
  if (filename !== ":memory:") {
    const parentDirectory = dirname(filename);
    if (!existsSync(parentDirectory)) {
      throw new StorageInitializationError(
        "SQLite parent directory does not exist",
        { context: { parentDirectory } },
      );
    }
  }

  let sqliteDatabase: DatabaseSync;
  try {
    sqliteDatabase = new DatabaseSync(filename);
    sqliteDatabase.exec("PRAGMA foreign_keys = ON;");
    sqliteDatabase.exec("PRAGMA journal_mode = WAL;");
    sqliteDatabase.exec("PRAGMA busy_timeout = 5000;");
  } catch (cause) {
    throw new StorageInitializationError("Unable to open SQLite database", {
      cause,
      context: { filename },
    });
  }

  const database = new Kysely<StorageDatabaseSchema>({
    dialect: new NodeSqliteDialect(sqliteDatabase),
  });
  return new SqlStorageAdapter(database, async () => {
    await database.destroy();
  });
}
