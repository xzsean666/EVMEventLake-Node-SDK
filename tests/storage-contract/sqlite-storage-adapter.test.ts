import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll } from "vitest";

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
