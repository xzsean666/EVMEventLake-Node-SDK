import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll } from "vitest";

import { createSqliteStorageAdapter } from "../../src/index.js";
import { runQueryServiceContract } from "./query-service.contract.js";

const directories: string[] = [];

runQueryServiceContract("SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eventlake-query-"));
  directories.push(directory);
  return createSqliteStorageAdapter(join(directory, "events.db"));
});

afterAll(async () => {
  await Promise.all(
    directories.map(async (directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});
