import type { DeleteResult, InsertResult, Kysely, UpdateResult } from "kysely";
import type { Address, Hex } from "viem";

import {
  StorageConsistencyError,
  StorageInitializationError,
  TargetMetadataConflictError,
} from "../errors/evm-event-lake-errors.js";
import type {
  AcquireLeaseRequest,
  ReleaseLeaseRequest,
  RenewLeaseRequest,
  StorageAdapter,
} from "./storage-adapter.js";
import type { StorageDatabaseSchema } from "./storage-database-schema.js";
import {
  blockNumberToStorageKey,
  storageKeyToBlockNumber,
  type CommitRangeRequest,
  type CommitRangeResult,
  type RewindResult,
  type StoredEventLog,
  type StoredEventQuery,
  type SyncCheckpoint,
  type TargetRegistration,
  type TargetState,
} from "./storage-models.js";

const SCHEMA_VERSION = 1;

export class SqlStorageAdapter implements StorageAdapter {
  readonly #closeDatabase: () => Promise<void>;
  readonly #database: Kysely<StorageDatabaseSchema>;

  public constructor(
    database: Kysely<StorageDatabaseSchema>,
    closeDatabase: () => Promise<void>,
  ) {
    this.#database = database;
    this.#closeDatabase = closeDatabase;
  }

  public async initialize(): Promise<void> {
    try {
      await this.#createSchema();
      await this.#database
        .insertInto("schema_migrations")
        .values({
          applied_at: new Date().toISOString(),
          version: SCHEMA_VERSION,
        })
        .onConflict((conflict) => conflict.column("version").doNothing())
        .execute();
    } catch (cause) {
      throw new StorageInitializationError(
        "Unable to initialize storage schema",
        {
          cause,
        },
      );
    }
  }

  public async registerTarget(
    registration: TargetRegistration,
  ): Promise<TargetState> {
    const now = new Date().toISOString();
    await this.#database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("lake_targets")
        .values({
          active_abi_fingerprint: registration.abiFingerprint,
          chain_id: registration.target.chainId,
          contract_address: registration.target.contractAddress,
          created_at: now,
          next_block_key: blockNumberToStorageKey(
            registration.target.startBlock,
          ),
          start_block_key: blockNumberToStorageKey(
            registration.target.startBlock,
          ),
          target_key: registration.target.targetKey,
          updated_at: now,
        })
        .onConflict((conflict) => conflict.column("target_key").doNothing())
        .execute();

      const existingTarget = await transaction
        .selectFrom("lake_targets")
        .selectAll()
        .where("target_key", "=", registration.target.targetKey)
        .executeTakeFirstOrThrow();

      if (
        existingTarget.chain_id !== registration.target.chainId ||
        existingTarget.contract_address.toLowerCase() !==
          registration.target.contractAddress.toLowerCase() ||
        existingTarget.start_block_key !==
          blockNumberToStorageKey(registration.target.startBlock)
      ) {
        throw new TargetMetadataConflictError(
          "Existing target metadata conflicts with SDK options",
          { context: { targetKey: registration.target.targetKey } },
        );
      }

      await transaction
        .insertInto("abi_versions")
        .values({
          abi_fingerprint: registration.abiFingerprint,
          canonical_abi_json: registration.canonicalAbiJson,
          registered_at: now,
          target_key: registration.target.targetKey,
        })
        .onConflict((conflict) =>
          conflict.columns(["target_key", "abi_fingerprint"]).doNothing(),
        )
        .execute();

      await transaction
        .updateTable("lake_targets")
        .set({
          active_abi_fingerprint: registration.abiFingerprint,
          updated_at: now,
        })
        .where("target_key", "=", registration.target.targetKey)
        .execute();
    });

    const state = await this.getTargetState(registration.target.targetKey);
    if (state === null) {
      throw new StorageConsistencyError(
        "Registered target could not be loaded",
      );
    }
    return state;
  }

  public async getTargetState(targetKey: string): Promise<TargetState | null> {
    const target = await this.#database
      .selectFrom("lake_targets")
      .selectAll()
      .where("target_key", "=", targetKey)
      .executeTakeFirst();
    if (target === undefined) return null;

    const [latestCheckpoint, activeLease] = await Promise.all([
      this.#database
        .selectFrom("sync_checkpoints")
        .selectAll()
        .where("target_key", "=", targetKey)
        .orderBy("block_number_key", "desc")
        .limit(1)
        .executeTakeFirst(),
      this.#database
        .selectFrom("sync_leases")
        .select("target_key")
        .where("target_key", "=", targetKey)
        .where("expires_at", ">", new Date().toISOString())
        .executeTakeFirst(),
    ]);

    const startBlock = storageKeyToBlockNumber(target.start_block_key);
    const nextBlock = storageKeyToBlockNumber(target.next_block_key);
    return Object.freeze({
      activeAbiFingerprint: target.active_abi_fingerprint,
      chainId: target.chain_id,
      contractAddress: target.contract_address as Address,
      createdAt: target.created_at,
      hasActiveLease: activeLease !== undefined,
      latestCheckpoint:
        latestCheckpoint === undefined ? null : mapCheckpoint(latestCheckpoint),
      nextBlock,
      startBlock,
      syncedThroughBlock: nextBlock === startBlock ? null : nextBlock - 1n,
      targetKey: target.target_key,
      updatedAt: target.updated_at,
    });
  }

  public async getRecentCheckpoints(
    targetKey: string,
    limit: number,
  ): Promise<readonly SyncCheckpoint[]> {
    const checkpoints = await this.#database
      .selectFrom("sync_checkpoints")
      .selectAll()
      .where("target_key", "=", targetKey)
      .orderBy("block_number_key", "desc")
      .limit(limit)
      .execute();
    return Object.freeze(
      checkpoints.map((checkpoint) => mapCheckpoint(checkpoint)),
    );
  }

  public async acquireLease(request: AcquireLeaseRequest): Promise<boolean> {
    await this.#database
      .insertInto("sync_leases")
      .values({
        expires_at: request.expiresAt,
        owner_token: request.ownerToken,
        target_key: request.targetKey,
      })
      .onConflict((conflict) =>
        conflict
          .column("target_key")
          .doUpdateSet({
            expires_at: request.expiresAt,
            owner_token: request.ownerToken,
          })
          .where("sync_leases.expires_at", "<=", new Date().toISOString()),
      )
      .execute();
    const currentLease = await this.#database
      .selectFrom("sync_leases")
      .select("owner_token")
      .where("target_key", "=", request.targetKey)
      .executeTakeFirst();
    return currentLease?.owner_token === request.ownerToken;
  }

  public async renewLease(request: RenewLeaseRequest): Promise<boolean> {
    const result = await this.#database
      .updateTable("sync_leases")
      .set({ expires_at: request.expiresAt })
      .where("target_key", "=", request.targetKey)
      .where("owner_token", "=", request.ownerToken)
      .executeTakeFirst();
    return mutationChangedRows(result) > 0n;
  }

  public async releaseLease(request: ReleaseLeaseRequest): Promise<boolean> {
    const result = await this.#database
      .deleteFrom("sync_leases")
      .where("target_key", "=", request.targetKey)
      .where("owner_token", "=", request.ownerToken)
      .executeTakeFirst();
    return mutationChangedRows(result) > 0n;
  }

  public async commitRange(
    request: CommitRangeRequest,
  ): Promise<CommitRangeResult> {
    validateCommitRangeRequest(request);
    return this.#database.transaction().execute(async (transaction) => {
      const target = await transaction
        .selectFrom("lake_targets")
        .select(["next_block_key"])
        .where("target_key", "=", request.targetKey)
        .executeTakeFirst();
      if (target === undefined) {
        throw new StorageConsistencyError("Cannot commit an unknown target", {
          context: { targetKey: request.targetKey },
        });
      }
      if (
        target.next_block_key !== blockNumberToStorageKey(request.fromBlock)
      ) {
        throw new StorageConsistencyError(
          "Commit range does not start at the durable next block",
          {
            context: {
              durableNextBlock: storageKeyToBlockNumber(
                target.next_block_key,
              ).toString(),
              fromBlock: request.fromBlock.toString(),
              targetKey: request.targetKey,
            },
          },
        );
      }

      const uniqueLogs = [
        ...new Map(request.logs.map((log) => [log.eventId, log])).values(),
      ];
      const insertedEventIds =
        uniqueLogs.length === 0
          ? []
          : await transaction
              .insertInto("event_logs")
              .values(uniqueLogs.map((log) => eventLogToRow(log)))
              .onConflict((conflict) => conflict.column("event_id").doNothing())
              .returning("event_id")
              .execute();
      const insertedEventIdSet = new Set(
        insertedEventIds.map((row) => row.event_id),
      );
      const parameterRows = uniqueLogs
        .filter((log) => insertedEventIdSet.has(log.eventId))
        .flatMap((log) =>
          log.parameters.map((parameter) => ({
            comparable_value: parameter.comparableValue,
            event_id: log.eventId,
            is_indexed: parameter.indexed ? 1 : 0,
            name: parameter.name,
            position: parameter.position,
            raw_topic: parameter.rawTopicValue,
            solidity_type: parameter.solidityType,
            target_key: log.targetKey,
          })),
        );
      if (parameterRows.length > 0) {
        await transaction
          .insertInto("event_parameters")
          .values(parameterRows)
          .execute();
      }

      const now = new Date().toISOString();
      const updatedTarget = await transaction
        .updateTable("lake_targets")
        .set({
          active_abi_fingerprint: request.abiFingerprint,
          next_block_key: blockNumberToStorageKey(request.toBlock + 1n),
          updated_at: now,
        })
        .where("target_key", "=", request.targetKey)
        .where(
          "next_block_key",
          "=",
          blockNumberToStorageKey(request.fromBlock),
        )
        .executeTakeFirst();
      if (mutationChangedRows(updatedTarget) !== 1n) {
        throw new StorageConsistencyError(
          "Target cursor changed during commit",
          {
            context: { targetKey: request.targetKey },
          },
        );
      }

      await transaction
        .insertInto("sync_checkpoints")
        .values({
          block_hash: request.endBlockHash,
          block_number_key: blockNumberToStorageKey(request.toBlock),
          committed_at: now,
          target_key: request.targetKey,
        })
        .onConflict((conflict) =>
          conflict.columns(["target_key", "block_number_key"]).doUpdateSet({
            block_hash: request.endBlockHash,
            committed_at: now,
          }),
        )
        .execute();

      return Object.freeze({
        duplicateLogs: request.logs.length - insertedEventIdSet.size,
        insertedLogs: insertedEventIdSet.size,
      });
    });
  }

  public async rewind(
    targetKey: string,
    rewindToBlock: bigint,
  ): Promise<RewindResult> {
    const rewindBlockKey = blockNumberToStorageKey(rewindToBlock);
    return this.#database.transaction().execute(async (transaction) => {
      const eventIds = transaction
        .selectFrom("event_logs")
        .select("event_id")
        .where("target_key", "=", targetKey)
        .where("block_number_key", ">", rewindBlockKey);
      await transaction
        .deleteFrom("event_parameters")
        .where("event_id", "in", eventIds)
        .execute();
      const deletedLogs = await transaction
        .deleteFrom("event_logs")
        .where("target_key", "=", targetKey)
        .where("block_number_key", ">", rewindBlockKey)
        .executeTakeFirst();
      await transaction
        .deleteFrom("sync_checkpoints")
        .where("target_key", "=", targetKey)
        .where("block_number_key", ">", rewindBlockKey)
        .execute();
      const nextBlock = rewindToBlock + 1n;
      const updated = await transaction
        .updateTable("lake_targets")
        .set({
          next_block_key: blockNumberToStorageKey(nextBlock),
          updated_at: new Date().toISOString(),
        })
        .where("target_key", "=", targetKey)
        .executeTakeFirst();
      if (mutationChangedRows(updated) !== 1n) {
        throw new StorageConsistencyError("Cannot rewind an unknown target", {
          context: { targetKey },
        });
      }
      return Object.freeze({
        deletedLogs: Number(mutationChangedRows(deletedLogs)),
        nextBlock,
      });
    });
  }

  public async queryEvents(
    input: StoredEventQuery,
  ): Promise<readonly StoredEventLog[]> {
    let query = this.#database
      .selectFrom("event_logs")
      .selectAll()
      .where("target_key", "=", input.targetKey);
    if (input.blockNumber !== undefined) {
      query = query.where(
        "block_number_key",
        "=",
        blockNumberToStorageKey(input.blockNumber),
      );
    }
    if (input.fromBlock !== undefined) {
      query = query.where(
        "block_number_key",
        ">=",
        blockNumberToStorageKey(input.fromBlock),
      );
    }
    if (input.toBlock !== undefined) {
      query = query.where(
        "block_number_key",
        "<=",
        blockNumberToStorageKey(input.toBlock),
      );
    }
    if (input.transactionHash !== undefined) {
      query = query.where(
        "transaction_hash",
        "=",
        input.transactionHash.toLowerCase(),
      );
    }
    if (input.eventName !== undefined) {
      query = query.where("event_name", "=", input.eventName);
    }
    if (input.eventSignature !== undefined) {
      query = query.where("event_signature", "=", input.eventSignature);
    }
    for (const parameter of input.indexedParameters ?? []) {
      query = query.where(
        "event_id",
        "in",
        this.#database
          .selectFrom("event_parameters")
          .select("event_id")
          .where("target_key", "=", input.targetKey)
          .where("is_indexed", "=", 1)
          .where("name", "=", parameter.name)
          .where("comparable_value", "=", parameter.comparableValue),
      );
    }
    if (input.after !== undefined) {
      const after = input.after;
      const comparison = input.order === "ascending" ? ">" : "<";
      const blockKey = blockNumberToStorageKey(after.blockNumber);
      query = query.where((expressionBuilder) =>
        expressionBuilder.or([
          expressionBuilder("block_number_key", comparison, blockKey),
          expressionBuilder.and([
            expressionBuilder("block_number_key", "=", blockKey),
            expressionBuilder(
              "transaction_index",
              comparison,
              after.transactionIndex,
            ),
          ]),
          expressionBuilder.and([
            expressionBuilder("block_number_key", "=", blockKey),
            expressionBuilder("transaction_index", "=", after.transactionIndex),
            expressionBuilder("log_index", comparison, after.logIndex),
          ]),
          expressionBuilder.and([
            expressionBuilder("block_number_key", "=", blockKey),
            expressionBuilder("transaction_index", "=", after.transactionIndex),
            expressionBuilder("log_index", "=", after.logIndex),
            expressionBuilder("event_id", comparison, after.eventId),
          ]),
        ]),
      );
    }

    const direction = input.order === "ascending" ? "asc" : "desc";
    const rows = await query
      .orderBy("block_number_key", direction)
      .orderBy("transaction_index", direction)
      .orderBy("log_index", direction)
      .orderBy("event_id", direction)
      .limit(input.limit)
      .execute();
    return Object.freeze(rows.map((row) => rowToStoredEventLog(row)));
  }

  public async close(): Promise<void> {
    await this.#closeDatabase();
  }

  async #createSchema(): Promise<void> {
    await this.#database.schema
      .createTable("schema_migrations")
      .ifNotExists()
      .addColumn("version", "integer", (column) => column.primaryKey())
      .addColumn("applied_at", "text", (column) => column.notNull())
      .execute();
    await this.#database.schema
      .createTable("lake_targets")
      .ifNotExists()
      .addColumn("target_key", "text", (column) => column.primaryKey())
      .addColumn("chain_id", "integer", (column) => column.notNull())
      .addColumn("contract_address", "text", (column) => column.notNull())
      .addColumn("start_block_key", "text", (column) => column.notNull())
      .addColumn("next_block_key", "text", (column) => column.notNull())
      .addColumn("active_abi_fingerprint", "text", (column) => column.notNull())
      .addColumn("created_at", "text", (column) => column.notNull())
      .addColumn("updated_at", "text", (column) => column.notNull())
      .execute();
    await this.#database.schema
      .createTable("abi_versions")
      .ifNotExists()
      .addColumn("target_key", "text", (column) =>
        column
          .notNull()
          .references("lake_targets.target_key")
          .onDelete("cascade"),
      )
      .addColumn("abi_fingerprint", "text", (column) => column.notNull())
      .addColumn("canonical_abi_json", "text", (column) => column.notNull())
      .addColumn("registered_at", "text", (column) => column.notNull())
      .addPrimaryKeyConstraint("abi_versions_primary", [
        "target_key",
        "abi_fingerprint",
      ])
      .execute();
    await this.#database.schema
      .createTable("event_logs")
      .ifNotExists()
      .addColumn("event_id", "text", (column) => column.primaryKey())
      .addColumn("target_key", "text", (column) =>
        column
          .notNull()
          .references("lake_targets.target_key")
          .onDelete("cascade"),
      )
      .addColumn("abi_fingerprint", "text", (column) => column.notNull())
      .addColumn("block_number_key", "text", (column) => column.notNull())
      .addColumn("block_hash", "text", (column) => column.notNull())
      .addColumn("transaction_hash", "text", (column) => column.notNull())
      .addColumn("transaction_index", "integer", (column) => column.notNull())
      .addColumn("log_index", "integer", (column) => column.notNull())
      .addColumn("contract_address", "text", (column) => column.notNull())
      .addColumn("topics_json", "text", (column) => column.notNull())
      .addColumn("data", "text", (column) => column.notNull())
      .addColumn("removed", "integer", (column) => column.notNull())
      .addColumn("decode_status", "text", (column) => column.notNull())
      .addColumn("event_name", "text")
      .addColumn("event_signature", "text")
      .addColumn("decoded_arguments", "text")
      .addColumn("created_at", "text", (column) => column.notNull())
      .execute();
    await this.#database.schema
      .createIndex("event_logs_chain_order")
      .ifNotExists()
      .on("event_logs")
      .columns([
        "target_key",
        "block_number_key",
        "transaction_index",
        "log_index",
      ])
      .execute();
    await this.#database.schema
      .createIndex("event_logs_transaction_hash")
      .ifNotExists()
      .on("event_logs")
      .columns(["target_key", "transaction_hash"])
      .execute();
    await this.#database.schema
      .createIndex("event_logs_event_signature")
      .ifNotExists()
      .on("event_logs")
      .columns(["target_key", "event_signature"])
      .execute();
    await this.#database.schema
      .createTable("event_parameters")
      .ifNotExists()
      .addColumn("event_id", "text", (column) =>
        column.notNull().references("event_logs.event_id").onDelete("cascade"),
      )
      .addColumn("target_key", "text", (column) => column.notNull())
      .addColumn("name", "text", (column) => column.notNull())
      .addColumn("position", "integer", (column) => column.notNull())
      .addColumn("solidity_type", "text", (column) => column.notNull())
      .addColumn("is_indexed", "integer", (column) => column.notNull())
      .addColumn("comparable_value", "text", (column) => column.notNull())
      .addColumn("raw_topic", "text")
      .addPrimaryKeyConstraint("event_parameters_primary", [
        "event_id",
        "position",
      ])
      .execute();
    await this.#database.schema
      .createIndex("event_parameters_lookup")
      .ifNotExists()
      .on("event_parameters")
      .columns(["target_key", "name", "comparable_value", "is_indexed"])
      .execute();
    await this.#database.schema
      .createTable("sync_checkpoints")
      .ifNotExists()
      .addColumn("target_key", "text", (column) =>
        column
          .notNull()
          .references("lake_targets.target_key")
          .onDelete("cascade"),
      )
      .addColumn("block_number_key", "text", (column) => column.notNull())
      .addColumn("block_hash", "text", (column) => column.notNull())
      .addColumn("committed_at", "text", (column) => column.notNull())
      .addPrimaryKeyConstraint("sync_checkpoints_primary", [
        "target_key",
        "block_number_key",
      ])
      .execute();
    await this.#database.schema
      .createTable("sync_leases")
      .ifNotExists()
      .addColumn("target_key", "text", (column) =>
        column
          .primaryKey()
          .references("lake_targets.target_key")
          .onDelete("cascade"),
      )
      .addColumn("owner_token", "text", (column) => column.notNull())
      .addColumn("expires_at", "text", (column) => column.notNull())
      .execute();
  }
}

function validateCommitRangeRequest(request: CommitRangeRequest): void {
  if (request.fromBlock < 0n || request.toBlock < request.fromBlock) {
    throw new StorageConsistencyError("Commit range is invalid");
  }
  for (const log of request.logs) {
    if (
      log.targetKey !== request.targetKey ||
      log.abiFingerprint !== request.abiFingerprint ||
      log.blockNumber < request.fromBlock ||
      log.blockNumber > request.toBlock
    ) {
      throw new StorageConsistencyError("Commit contains an out-of-range log", {
        context: { eventId: log.eventId, targetKey: request.targetKey },
      });
    }
    const parameterPositions = new Set<number>();
    for (const parameter of log.parameters) {
      if (
        !Number.isSafeInteger(parameter.position) ||
        parameter.position < 0 ||
        parameterPositions.has(parameter.position)
      ) {
        throw new StorageConsistencyError(
          "Commit contains invalid or duplicate event parameter positions",
          { context: { eventId: log.eventId, position: parameter.position } },
        );
      }
      parameterPositions.add(parameter.position);
    }
  }
}

function eventLogToRow(
  log: StoredEventLog,
): StorageDatabaseSchema["event_logs"] {
  return {
    abi_fingerprint: log.abiFingerprint,
    block_hash: log.blockHash.toLowerCase(),
    block_number_key: blockNumberToStorageKey(log.blockNumber),
    contract_address: log.contractAddress.toLowerCase(),
    created_at: new Date().toISOString(),
    data: log.data.toLowerCase(),
    decode_status: log.decodeStatus,
    decoded_arguments: log.decodedArguments,
    event_id: log.eventId,
    event_name: log.eventName,
    event_signature: log.eventSignature,
    log_index: log.logIndex,
    removed: log.removed ? 1 : 0,
    target_key: log.targetKey,
    topics_json: JSON.stringify(log.topics.map((topic) => topic.toLowerCase())),
    transaction_hash: log.transactionHash.toLowerCase(),
    transaction_index: log.transactionIndex,
  };
}

function rowToStoredEventLog(
  row: StorageDatabaseSchema["event_logs"],
): StoredEventLog {
  return Object.freeze({
    abiFingerprint: row.abi_fingerprint,
    blockHash: row.block_hash as Hex,
    blockNumber: storageKeyToBlockNumber(row.block_number_key),
    contractAddress: row.contract_address as Address,
    data: row.data as Hex,
    decodedArguments: row.decoded_arguments,
    decodeStatus: row.decode_status as StoredEventLog["decodeStatus"],
    eventId: row.event_id,
    eventName: row.event_name,
    eventSignature: row.event_signature,
    logIndex: row.log_index,
    parameters: Object.freeze([]),
    removed: row.removed === 1,
    targetKey: row.target_key,
    topics: Object.freeze(JSON.parse(row.topics_json) as Hex[]),
    transactionHash: row.transaction_hash as Hex,
    transactionIndex: row.transaction_index,
  });
}

function mapCheckpoint(
  row: StorageDatabaseSchema["sync_checkpoints"],
): SyncCheckpoint {
  return Object.freeze({
    blockHash: row.block_hash as Hex,
    blockNumber: storageKeyToBlockNumber(row.block_number_key),
    committedAt: row.committed_at,
    targetKey: row.target_key,
  });
}

function mutationChangedRows(
  result: DeleteResult | InsertResult | UpdateResult,
): bigint {
  if ("numUpdatedRows" in result) return result.numUpdatedRows;
  if ("numDeletedRows" in result) return result.numDeletedRows;
  return result.numInsertedOrUpdatedRows ?? 0n;
}
