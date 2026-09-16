import "fake-indexeddb/auto";

import { randomUUID } from "node:crypto";

import { runQueryServiceContract } from "../query/query-service.contract.js";
import { createIndexeddbStorageAdapter } from "../support/internal-exports.js";

runQueryServiceContract("IndexedDB", () => {
  const databaseName = `test-query-${randomUUID()}`;
  return Promise.resolve(createIndexeddbStorageAdapter(databaseName));
});
