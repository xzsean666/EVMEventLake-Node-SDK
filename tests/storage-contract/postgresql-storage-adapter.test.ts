import { newDb } from "pg-mem";
import type { Pool } from "pg";

import { createPostgresqlStorageAdapter } from "../support/internal-exports.js";
import { runStorageAdapterContract } from "./storage-adapter.contract.js";

runStorageAdapterContract("PostgreSQL", () => {
  const memoryDatabase = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memoryDatabase.adapters.createPg() as unknown as {
    readonly Pool: new () => Pool;
  };
  const pool = new adapter.Pool();
  return Promise.resolve(createPostgresqlStorageAdapter({ pool }));
});
