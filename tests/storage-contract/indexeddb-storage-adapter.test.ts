import "fake-indexeddb/auto";

import { randomUUID } from "node:crypto";

import { createIndexeddbStorageAdapter } from "../support/internal-exports.js";
import { runStorageAdapterContract } from "./storage-adapter.contract.js";

runStorageAdapterContract("IndexedDB", () => {
  const databaseName = `test-lake-${randomUUID()}`;
  return Promise.resolve(createIndexeddbStorageAdapter(databaseName));
});
