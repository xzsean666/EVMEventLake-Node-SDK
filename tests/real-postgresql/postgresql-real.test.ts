import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { describe, it } from "vitest";

import {
  createPostgresqlStorageAdapter,
  type StorageAdapter,
} from "../support/internal-exports.js";
import { runQueryServiceContract } from "../query/query-service.contract.js";
import { runStorageAdapterContract } from "../storage-contract/storage-adapter.contract.js";

const connectionString = process.env.EVM_EVENT_LAKE_POSTGRESQL_TEST_URL;

if (connectionString === undefined) {
  describe.skip("real PostgreSQL release verification", () => {
    it("requires EVM_EVENT_LAKE_POSTGRESQL_TEST_URL", () => undefined);
  });
} else {
  const createAdapter = (): Promise<StorageAdapter> =>
    createIsolatedPostgresqlAdapter(connectionString);

  runStorageAdapterContract("Real PostgreSQL", createAdapter);
  runQueryServiceContract("Real PostgreSQL", createAdapter);
}

async function createIsolatedPostgresqlAdapter(
  databaseUrl: string,
): Promise<StorageAdapter> {
  const schemaName = `evm_event_lake_test_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
  } catch (error) {
    await adminPool.end();
    throw error;
  }

  const testPool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    options: `-c search_path=${schemaName}`,
  });
  const adapter = createPostgresqlStorageAdapter({ pool: testPool });
  let closed = false;

  const isolatedAdapter: StorageAdapter = {
    acquireLease: (request) => adapter.acquireLease(request),
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      let closeError: unknown;
      try {
        await adapter.close();
      } catch (error) {
        closeError = error;
      }
      try {
        await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } finally {
        await adminPool.end();
      }
      if (closeError instanceof Error) throw closeError;
      if (closeError !== undefined) {
        throw new Error("PostgreSQL adapter close failed", {
          cause: closeError,
        });
      }
    },
    commitRange: (request) => adapter.commitRange(request),
    getRecentCheckpoints: (targetKey, limit) =>
      adapter.getRecentCheckpoints(targetKey, limit),
    getTargetState: (targetKey) => adapter.getTargetState(targetKey),
    initialize: () => adapter.initialize(),
    queryEvents: (query) => adapter.queryEvents(query),
    registerTarget: (registration) => adapter.registerTarget(registration),
    releaseLease: (request) => adapter.releaseLease(request),
    renewLease: (request) => adapter.renewLease(request),
    rewind: (targetKey, rewindToBlock) =>
      adapter.rewind(targetKey, rewindToBlock),
  };
  return isolatedAdapter;
}
