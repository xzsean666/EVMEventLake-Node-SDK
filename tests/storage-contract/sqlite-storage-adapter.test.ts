import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { CompiledQuery } from "kysely";
import { afterAll, describe, expect, it } from "vitest";

import { NodeSqliteDialect } from "../../src/storage/sqlite/node-sqlite-dialect.js";
import { createSqliteStorageAdapter } from "../support/internal-exports.js";
import { runStorageAdapterContract } from "./storage-adapter.contract.js";

const temporaryDirectories: string[] = [];

runStorageAdapterContract("SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eventlake-sqlite-"));
  temporaryDirectories.push(directory);
  return createSqliteStorageAdapter(join(directory, "events.db"));
});

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map(async (directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("NodeSqliteDialect & Driver edge cases", () => {
  it("converts Date and ArrayBuffer inputs and executes queries with rejected promises on error", async () => {
    const rawDb = new DatabaseSync(":memory:");
    rawDb.exec(
      "CREATE TABLE test_params (id INT, created_at TEXT, blob_data BLOB);",
    );

    const dialect = new NodeSqliteDialect(rawDb);
    const driver = dialect.createDriver();
    await driver.init();
    const conn = await driver.acquireConnection();

    const now = new Date();
    const arrayBuffer = new ArrayBuffer(4);
    new Uint8Array(arrayBuffer).set([1, 2, 3, 4]);

    const result = await conn.executeQuery(
      CompiledQuery.raw(
        "INSERT INTO test_params (id, created_at, blob_data) VALUES (?, ?, ?);",
        [1, now, arrayBuffer],
      ),
    );
    expect(result.numAffectedRows).toBe(1n);

    // Test async error rejection
    const invalidQueryPromise = conn.executeQuery(
      CompiledQuery.raw("INVALID SQL SYNTAX THAT FAILS"),
    );
    expect(invalidQueryPromise).toBeInstanceOf(Promise);
    await expect(invalidQueryPromise).rejects.toThrow();

    // Test idempotent driver destroy
    await driver.destroy();
    await expect(driver.destroy()).resolves.toBeUndefined();
  });
});
