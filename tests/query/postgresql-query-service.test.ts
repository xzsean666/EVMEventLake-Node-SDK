import { newDb } from "pg-mem";
import type { Pool } from "pg";

import { createPostgresqlStorageAdapter } from "../../src/index.js";
import { runQueryServiceContract } from "./query-service.contract.js";

runQueryServiceContract("PostgreSQL", () => {
  const memoryDatabase = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memoryDatabase.adapters.createPg() as unknown as {
    readonly Pool: new () => Pool;
  };
  return Promise.resolve(
    createPostgresqlStorageAdapter({ pool: new adapter.Pool() }),
  );
});
