import type { Address, Hex } from "viem";

import { decodeDecodedValue } from "../../abi/decoded-value-codec.js";
import {
  readDecodedArgument,
  type DecodedEventParameter,
} from "../../abi/event-decoder.js";
import {
  StorageConsistencyError,
  StorageInitializationError,
  TargetMetadataConflictError,
} from "../../errors/evm-event-lake-errors.js";
import type {
  AcquireLeaseRequest,
  ReleaseLeaseRequest,
  RenewLeaseRequest,
  StorageAdapter,
} from "../storage-adapter.js";
import {
  blockNumberToStorageKey,
  storageKeyToBlockNumber,
  type CommitRangeRequest,
  type CommitRangeResult,
  type CountLogsForRedecodeRequest,
  type GetLogsForRedecodeRequest,
  type RewindResult,
  type StoredEventLog,
  type StoredEventQuery,
  type StoredEventQueryCursor,
  type SyncCheckpoint,
  type TargetRegistration,
  type TargetState,
  type UpdateDecodedLogsRequest,
  type UpdateDecodedLogsResult,
} from "../storage-models.js";
import type {
  AbiVersionStoreRow,
  EventLogStoreRow,
  EventParameterStoreRow,
  LakeTargetStoreRow,
  SchemaMigrationStoreRow,
  SyncCheckpointStoreRow,
  SyncLeaseStoreRow,
} from "./indexeddb-types.js";

const SCHEMA_VERSION = 1;

const STORES = {
  abiVersions: "abi_versions",
  eventLogs: "event_logs",
  eventParameters: "event_parameters",
  lakeTargets: "lake_targets",
  schemaMigrations: "schema_migrations",
  syncCheckpoints: "sync_checkpoints",
  syncLeases: "sync_leases",
} as const;

interface UntypedIDBRequest {
  readonly error: DOMException | null;
  readonly result: unknown;
  onerror: ((this: IDBRequest, ev: Event) => unknown) | null;
  onsuccess: ((this: IDBRequest, ev: Event) => unknown) | null;
}

export interface IndexeddbStorageAdapterOptions {
  readonly databaseName: string;
  readonly idbFactory?: IDBFactory | undefined;
}

export class IndexeddbStorageAdapter implements StorageAdapter {
  readonly #databaseName: string;
  readonly #idbFactory: IDBFactory;
  #database: IDBDatabase | null = null;

  public constructor(options: IndexeddbStorageAdapterOptions) {
    this.#databaseName = options.databaseName;
    const factory =
      options.idbFactory ??
      (typeof indexedDB !== "undefined"
        ? indexedDB
        : typeof globalThis !== "undefined"
          ? (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB
          : undefined);

    if (factory === undefined) {
      throw new StorageInitializationError(
        "IndexedDB is not available in the current environment",
      );
    }
    this.#idbFactory = factory;
  }

  public async initialize(): Promise<void> {
    if (this.#database !== null) {
      return;
    }
    try {
      this.#database = await this.#openDatabase();
      await runTransaction(
        this.#database,
        [STORES.schemaMigrations],
        "readwrite",
        async (tx) => {
          const store = tx.objectStore(STORES.schemaMigrations);
          const existing = (await promisifyRequest(
            store.get(SCHEMA_VERSION),
          )) as SchemaMigrationStoreRow | undefined;
          if (!existing) {
            await promisifyRequest(
              store.put({
                appliedAt: new Date().toISOString(),
                version: SCHEMA_VERSION,
              }),
            );
          }
        },
      );
    } catch (cause) {
      if (cause instanceof StorageInitializationError) {
        throw cause;
      }
      throw new StorageInitializationError(
        "Unable to initialize IndexedDB schema",
        { cause },
      );
    }
  }

  public async registerTarget(
    registration: TargetRegistration,
  ): Promise<TargetState> {
    const db = this.#getDatabase();
    const now = new Date().toISOString();

    await runTransaction(
      db,
      [STORES.lakeTargets, STORES.abiVersions],
      "readwrite",
      async (tx) => {
        const targetStore = tx.objectStore(STORES.lakeTargets);
        const existingTarget = (await promisifyRequest(
          targetStore.get(registration.target.targetKey),
        )) as LakeTargetStoreRow | undefined;

        if (existingTarget !== undefined) {
          if (
            existingTarget.chainId !== registration.target.chainId ||
            existingTarget.contractAddress.toLowerCase() !==
              registration.target.contractAddress.toLowerCase() ||
            existingTarget.startBlockKey !==
              blockNumberToStorageKey(registration.target.startBlock)
          ) {
            throw new TargetMetadataConflictError(
              "Existing target metadata conflicts with SDK options",
              { context: { targetKey: registration.target.targetKey } },
            );
          }
          existingTarget.activeAbiFingerprint = registration.abiFingerprint;
          existingTarget.updatedAt = now;
          await promisifyRequest(targetStore.put(existingTarget));
        } else {
          const newTarget: LakeTargetStoreRow = {
            activeAbiFingerprint: registration.abiFingerprint,
            chainId: registration.target.chainId,
            contractAddress: registration.target.contractAddress,
            createdAt: now,
            nextBlockKey: blockNumberToStorageKey(
              registration.target.startBlock,
            ),
            startBlockKey: blockNumberToStorageKey(
              registration.target.startBlock,
            ),
            targetKey: registration.target.targetKey,
            updatedAt: now,
          };
          await promisifyRequest(targetStore.put(newTarget));
        }

        const abiStore = tx.objectStore(STORES.abiVersions);
        const abiRow: AbiVersionStoreRow = {
          abiFingerprint: registration.abiFingerprint,
          canonicalAbiJson: registration.canonicalAbiJson,
          registeredAt: now,
          targetKey: registration.target.targetKey,
        };
        await promisifyRequest(abiStore.put(abiRow));
      },
    );

    const state = await this.getTargetState(registration.target.targetKey);
    if (state === null) {
      throw new StorageConsistencyError(
        "Registered target could not be loaded",
      );
    }
    return state;
  }

  public async getTargetState(targetKey: string): Promise<TargetState | null> {
    const [target, latestCheckpoints, activeLease] = await Promise.all([
      this.#getLakeTarget(targetKey),
      this.getRecentCheckpoints(targetKey, 1),
      this.#getActiveLease(targetKey),
    ]);
    if (target === null) {
      return null;
    }

    const startBlock = storageKeyToBlockNumber(target.startBlockKey);
    const nextBlock = storageKeyToBlockNumber(target.nextBlockKey);
    return Object.freeze({
      activeAbiFingerprint: target.activeAbiFingerprint,
      chainId: target.chainId,
      contractAddress: target.contractAddress as Address,
      createdAt: target.createdAt,
      hasActiveLease: activeLease !== null,
      latestCheckpoint: latestCheckpoints[0] ?? null,
      nextBlock,
      startBlock,
      syncedThroughBlock: nextBlock === startBlock ? null : nextBlock - 1n,
      targetKey: target.targetKey,
      updatedAt: target.updatedAt,
    });
  }

  public async getRecentCheckpoints(
    targetKey: string,
    limit: number,
  ): Promise<readonly SyncCheckpoint[]> {
    const db = this.#getDatabase();
    const minKey = [targetKey, "0".repeat(78)];
    const maxKey = [targetKey, "9".repeat(78)];
    const range = IDBKeyRange.bound(minKey, maxKey);

    return runTransaction(
      db,
      [STORES.syncCheckpoints],
      "readonly",
      async (tx) => {
        const store = tx.objectStore(STORES.syncCheckpoints);
        const results: SyncCheckpoint[] = [];
        const request = store.openCursor(range, "prev");

        await new Promise<void>((resolve, reject) => {
          request.onerror = () => {
            reject(
              request.error
                ? new Error(request.error.message, { cause: request.error })
                : new Error("Cursor request failed"),
            );
          };
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve();
              return;
            }
            const row = cursor.value as SyncCheckpointStoreRow;
            results.push(
              Object.freeze({
                blockHash: row.blockHash,
                blockNumber: storageKeyToBlockNumber(row.blockNumberKey),
                committedAt: row.committedAt,
                targetKey: row.targetKey,
              }),
            );
            if (results.length >= limit) {
              resolve();
              return;
            }
            cursor.continue();
          };
        });

        return Object.freeze(results);
      },
    );
  }

  public async acquireLease(request: AcquireLeaseRequest): Promise<boolean> {
    const db = this.#getDatabase();
    const now = new Date().toISOString();
    return runTransaction(db, [STORES.syncLeases], "readwrite", async (tx) => {
      const store = tx.objectStore(STORES.syncLeases);
      const existing = (await promisifyRequest(
        store.get(request.targetKey),
      )) as SyncLeaseStoreRow | undefined;
      if (
        existing === undefined ||
        existing.expiresAt <= now ||
        existing.ownerToken === request.ownerToken
      ) {
        await promisifyRequest(
          store.put({
            expiresAt: request.expiresAt,
            ownerToken: request.ownerToken,
            targetKey: request.targetKey,
          }),
        );
        return true;
      }
      return false;
    });
  }

  public async renewLease(request: RenewLeaseRequest): Promise<boolean> {
    const db = this.#getDatabase();
    return runTransaction(db, [STORES.syncLeases], "readwrite", async (tx) => {
      const store = tx.objectStore(STORES.syncLeases);
      const existing = (await promisifyRequest(
        store.get(request.targetKey),
      )) as SyncLeaseStoreRow | undefined;
      if (
        existing !== undefined &&
        existing.ownerToken === request.ownerToken
      ) {
        await promisifyRequest(
          store.put({
            ...existing,
            expiresAt: request.expiresAt,
          }),
        );
        return true;
      }
      return false;
    });
  }

  public async releaseLease(request: ReleaseLeaseRequest): Promise<boolean> {
    const db = this.#getDatabase();
    return runTransaction(db, [STORES.syncLeases], "readwrite", async (tx) => {
      const store = tx.objectStore(STORES.syncLeases);
      const existing = (await promisifyRequest(
        store.get(request.targetKey),
      )) as SyncLeaseStoreRow | undefined;
      if (
        existing !== undefined &&
        existing.ownerToken === request.ownerToken
      ) {
        await promisifyRequest(store.delete(request.targetKey));
        return true;
      }
      return false;
    });
  }

  public async commitRange(
    request: CommitRangeRequest,
  ): Promise<CommitRangeResult> {
    validateCommitRangeRequest(request);
    const db = this.#getDatabase();
    const now = new Date().toISOString();

    return runTransaction(
      db,
      [
        STORES.lakeTargets,
        STORES.eventLogs,
        STORES.eventParameters,
        STORES.syncCheckpoints,
      ],
      "readwrite",
      async (tx) => {
        const targetStore = tx.objectStore(STORES.lakeTargets);
        const target = (await promisifyRequest(
          targetStore.get(request.targetKey),
        )) as LakeTargetStoreRow | undefined;
        if (target === undefined) {
          throw new StorageConsistencyError("Cannot commit an unknown target", {
            context: { targetKey: request.targetKey },
          });
        }
        if (
          target.nextBlockKey !== blockNumberToStorageKey(request.fromBlock)
        ) {
          throw new StorageConsistencyError(
            "Commit range does not start at the durable next block",
            {
              context: {
                durableNextBlock: storageKeyToBlockNumber(
                  target.nextBlockKey,
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
        const eventLogsStore = tx.objectStore(STORES.eventLogs);
        const eventParamsStore = tx.objectStore(STORES.eventParameters);
        const eventIdIndex = eventLogsStore.index("by_event_id");

        let insertedLogs = 0;
        for (const log of uniqueLogs) {
          const existing = (await promisifyRequest(
            eventIdIndex.get(log.eventId),
          )) as EventLogStoreRow | undefined;
          if (existing !== undefined) {
            continue;
          }

          const blockNumberKey = blockNumberToStorageKey(log.blockNumber);
          const logRow: EventLogStoreRow = {
            abiFingerprint: log.abiFingerprint,
            blockHash: log.blockHash.toLowerCase() as Hex,
            blockNumberKey,
            contractAddress: log.contractAddress.toLowerCase(),
            createdAt: now,
            data: log.data.toLowerCase() as Hex,
            decodeStatus: log.decodeStatus,
            decodedArguments: log.decodedArguments,
            eventId: log.eventId,
            eventName: log.eventName,
            eventSignature: log.eventSignature,
            logIndex: log.logIndex,
            parameters: log.parameters,
            removed: log.removed,
            targetKey: log.targetKey,
            topics: log.topics.map((t) => t.toLowerCase() as Hex),
            transactionHash: log.transactionHash.toLowerCase() as Hex,
            transactionIndex: log.transactionIndex,
          };
          await promisifyRequest(eventLogsStore.put(logRow));
          insertedLogs++;

          for (const param of log.parameters) {
            const paramRow: EventParameterStoreRow = {
              blockNumberKey,
              comparableValue: param.comparableValue,
              eventId: log.eventId,
              indexed: param.indexed ? 1 : 0,
              logIndex: log.logIndex,
              name: param.name,
              position: param.position,
              rawTopic: param.rawTopicValue
                ? (param.rawTopicValue.toLowerCase() as Hex)
                : null,
              solidityType: param.solidityType,
              targetKey: log.targetKey,
            };
            await promisifyRequest(eventParamsStore.put(paramRow));
          }
        }

        target.activeAbiFingerprint = request.abiFingerprint;
        target.nextBlockKey = blockNumberToStorageKey(request.toBlock + 1n);
        target.updatedAt = now;
        await promisifyRequest(targetStore.put(target));

        const checkpointsStore = tx.objectStore(STORES.syncCheckpoints);
        const checkpointRow: SyncCheckpointStoreRow = {
          blockHash: request.endBlockHash,
          blockNumberKey: blockNumberToStorageKey(request.toBlock),
          committedAt: now,
          targetKey: request.targetKey,
        };
        await promisifyRequest(checkpointsStore.put(checkpointRow));

        return Object.freeze({
          duplicateLogs: request.logs.length - insertedLogs,
          insertedLogs,
        });
      },
    );
  }

  public async rewind(
    targetKey: string,
    rewindToBlock: bigint,
  ): Promise<RewindResult> {
    const nextBlockKey = blockNumberToStorageKey(rewindToBlock + 1n);
    const maxBlockKey = "9".repeat(78);
    const db = this.#getDatabase();

    return runTransaction(
      db,
      [
        STORES.lakeTargets,
        STORES.eventLogs,
        STORES.eventParameters,
        STORES.syncCheckpoints,
      ],
      "readwrite",
      async (tx) => {
        const targetStore = tx.objectStore(STORES.lakeTargets);
        const target = (await promisifyRequest(targetStore.get(targetKey))) as
          LakeTargetStoreRow | undefined;
        if (target === undefined) {
          throw new StorageConsistencyError("Cannot rewind an unknown target", {
            context: { targetKey },
          });
        }

        const checkpointsStore = tx.objectStore(STORES.syncCheckpoints);
        const checkpointsRange = IDBKeyRange.bound(
          [targetKey, nextBlockKey],
          [targetKey, maxBlockKey],
        );
        await promisifyRequest(checkpointsStore.delete(checkpointsRange));

        const paramsStore = tx.objectStore(STORES.eventParameters);
        const paramsRange = IDBKeyRange.bound(
          [targetKey, nextBlockKey, 0, 0],
          [
            targetKey,
            maxBlockKey,
            Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER,
          ],
        );
        await promisifyRequest(paramsStore.delete(paramsRange));

        const logsStore = tx.objectStore(STORES.eventLogs);
        const logsRange = IDBKeyRange.bound(
          [targetKey, nextBlockKey, 0],
          [targetKey, maxBlockKey, Number.MAX_SAFE_INTEGER],
        );
        const deletedLogs = await countAndDeleteRange(logsStore, logsRange);

        const nextBlock = rewindToBlock + 1n;
        target.nextBlockKey = blockNumberToStorageKey(nextBlock);
        target.updatedAt = new Date().toISOString();
        await promisifyRequest(targetStore.put(target));

        return Object.freeze({
          deletedLogs,
          nextBlock,
        });
      },
    );
  }

  public async countLogsForRedecode(
    request: CountLogsForRedecodeRequest,
  ): Promise<number> {
    const db = this.#getDatabase();
    const fromBlockKey =
      request.fromBlock !== undefined
        ? blockNumberToStorageKey(request.fromBlock)
        : blockNumberToStorageKey(0n);
    const toBlockKey =
      request.toBlock !== undefined
        ? blockNumberToStorageKey(request.toBlock)
        : "".padEnd(78, "9");

    return runTransaction(db, [STORES.eventLogs], "readonly", async (tx) => {
      const store = tx.objectStore(STORES.eventLogs);
      const range = IDBKeyRange.bound(
        [request.targetKey, fromBlockKey, 0],
        [request.targetKey, toBlockKey, Number.MAX_SAFE_INTEGER],
      );

      const cursorRequest = store.openCursor(range, "next");
      let count = 0;

      await new Promise<void>((resolve, reject) => {
        cursorRequest.onerror = () => {
          reject(
            cursorRequest.error
              ? new Error(cursorRequest.error.message, {
                  cause: cursorRequest.error,
                })
              : new Error("Cursor request failed"),
          );
        };
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            resolve();
            return;
          }
          const row = cursor.value as EventLogStoreRow;
          if (
            request.redecodeAll === true ||
            row.decodeStatus === "unknown" ||
            row.decodeStatus === "decode_failed"
          ) {
            count++;
          }
          cursor.continue();
        };
      });

      return count;
    });
  }

  public async getLogsForRedecode(
    request: GetLogsForRedecodeRequest,
  ): Promise<readonly StoredEventLog[]> {
    const db = this.#getDatabase();
    const fromBlockKey =
      request.fromBlock !== undefined
        ? blockNumberToStorageKey(request.fromBlock)
        : blockNumberToStorageKey(0n);
    const toBlockKey =
      request.toBlock !== undefined
        ? blockNumberToStorageKey(request.toBlock)
        : "".padEnd(78, "9");

    let lower: [string, string, number] = [request.targetKey, fromBlockKey, 0];
    let lowerOpen = false;

    if (request.after !== undefined) {
      const afterBlockKey = blockNumberToStorageKey(request.after.blockNumber);
      if (afterBlockKey >= fromBlockKey) {
        lower = [request.targetKey, afterBlockKey, request.after.logIndex];
        lowerOpen = true;
      }
    }

    const upper: [string, string, number] = [
      request.targetKey,
      toBlockKey,
      Number.MAX_SAFE_INTEGER,
    ];

    return runTransaction(db, [STORES.eventLogs], "readonly", async (tx) => {
      const store = tx.objectStore(STORES.eventLogs);
      const range = IDBKeyRange.bound(lower, upper, lowerOpen, false);

      const cursorRequest = store.openCursor(range, "next");
      const matchedLogs: StoredEventLog[] = [];

      await new Promise<void>((resolve, reject) => {
        cursorRequest.onerror = () => {
          reject(
            cursorRequest.error
              ? new Error(cursorRequest.error.message, {
                  cause: cursorRequest.error,
                })
              : new Error("Cursor request failed"),
          );
        };
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            resolve();
            return;
          }
          const row = cursor.value as EventLogStoreRow;
          if (
            request.redecodeAll === true ||
            row.decodeStatus === "unknown" ||
            row.decodeStatus === "decode_failed"
          ) {
            matchedLogs.push(rowToStoredEventLog(row));
          }
          if (matchedLogs.length >= request.limit) {
            resolve();
            return;
          }
          cursor.continue();
        };
      });

      return Object.freeze(matchedLogs);
    });
  }

  public async updateDecodedLogs(
    request: UpdateDecodedLogsRequest,
  ): Promise<UpdateDecodedLogsResult> {
    if (request.logs.length === 0) {
      return Object.freeze({ updatedLogs: 0 });
    }

    const db = this.#getDatabase();

    return runTransaction(
      db,
      [STORES.eventLogs, STORES.eventParameters],
      "readwrite",
      async (tx) => {
        const logsStore = tx.objectStore(STORES.eventLogs);
        const paramsStore = tx.objectStore(STORES.eventParameters);

        for (const log of request.logs) {
          const blockKey = blockNumberToStorageKey(log.blockNumber);
          const key = [log.targetKey, blockKey, log.logIndex];
          const existingRow = (await promisifyRequest(logsStore.get(key))) as
            EventLogStoreRow | undefined;

          if (existingRow !== undefined) {
            existingRow.abiFingerprint = log.abiFingerprint;
            existingRow.decodeStatus = log.decodeStatus;
            existingRow.decodedArguments = log.decodedArguments;
            existingRow.eventName = log.eventName;
            existingRow.eventSignature = log.eventSignature;
            existingRow.parameters = log.parameters;
            await promisifyRequest(logsStore.put(existingRow));
          }

          // Delete old parameters for this event log
          const paramRange = IDBKeyRange.bound(
            [log.targetKey, blockKey, log.logIndex, 0],
            [log.targetKey, blockKey, log.logIndex, Number.MAX_SAFE_INTEGER],
          );
          await promisifyRequest(paramsStore.delete(paramRange));

          // Insert new parameters
          for (const param of log.parameters) {
            const paramRow: EventParameterStoreRow = {
              blockNumberKey: blockKey,
              comparableValue: param.comparableValue,
              eventId: log.eventId,
              indexed: param.indexed ? 1 : 0,
              logIndex: log.logIndex,
              name: param.name,
              position: param.position,
              rawTopic: param.rawTopicValue,
              solidityType: param.solidityType,
              targetKey: log.targetKey,
            };
            await promisifyRequest(paramsStore.put(paramRow));
          }
        }

        return Object.freeze({ updatedLogs: request.logs.length });
      },
    );
  }

  public async queryEvents(
    input: StoredEventQuery,
  ): Promise<readonly StoredEventLog[]> {
    const db = this.#getDatabase();

    return runTransaction(
      db,
      [STORES.eventLogs, STORES.eventParameters],
      "readonly",
      async (tx) => {
        let candidateEventIds: Set<string> | null = null;
        if (input.indexedParameters && input.indexedParameters.length > 0) {
          const paramsStore = tx.objectStore(STORES.eventParameters);
          const lookupIndex = paramsStore.index("by_lookup");

          for (const filter of input.indexedParameters) {
            const key = [
              input.targetKey,
              filter.name,
              filter.comparableValue,
              1,
            ];
            const matchingParams = (await promisifyRequest(
              lookupIndex.getAll(IDBKeyRange.only(key)),
            )) as EventParameterStoreRow[];
            const matchingIds = new Set(matchingParams.map((p) => p.eventId));

            if (candidateEventIds === null) {
              candidateEventIds = matchingIds;
            } else {
              for (const id of Array.from(candidateEventIds)) {
                if (!matchingIds.has(id)) {
                  candidateEventIds.delete(id);
                }
              }
            }
            if (candidateEventIds.size === 0) {
              return Object.freeze([]);
            }
          }
        }

        if (input.unindexedParameters && input.unindexedParameters.length > 0) {
          const paramsStore = tx.objectStore(STORES.eventParameters);
          const lookupIndex = paramsStore.index("by_lookup");

          for (const filter of input.unindexedParameters) {
            const key = [
              input.targetKey,
              filter.name,
              filter.comparableValue,
              0,
            ];
            const matchingParams = (await promisifyRequest(
              lookupIndex.getAll(IDBKeyRange.only(key)),
            )) as EventParameterStoreRow[];
            const matchingIds = new Set(matchingParams.map((p) => p.eventId));

            if (candidateEventIds === null) {
              candidateEventIds = matchingIds;
            } else {
              for (const id of Array.from(candidateEventIds)) {
                if (!matchingIds.has(id)) {
                  candidateEventIds.delete(id);
                }
              }
            }
            if (candidateEventIds.size === 0) {
              return Object.freeze([]);
            }
          }
        }

        let minBlockKey = "0".repeat(78);
        let maxBlockKey = "9".repeat(78);

        if (input.blockNumber !== undefined) {
          minBlockKey = blockNumberToStorageKey(input.blockNumber);
          maxBlockKey = minBlockKey;
        } else {
          if (input.fromBlock !== undefined) {
            minBlockKey = blockNumberToStorageKey(input.fromBlock);
          }
          if (input.toBlock !== undefined) {
            maxBlockKey = blockNumberToStorageKey(input.toBlock);
          }
        }

        const lowerBound = [input.targetKey, minBlockKey, 0, 0, ""];
        const upperBound = [
          input.targetKey,
          maxBlockKey,
          Number.MAX_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER,
          "\uffff",
        ];
        const keyRange = IDBKeyRange.bound(lowerBound, upperBound);
        const idbDirection: IDBCursorDirection =
          input.order === "ascending" ? "next" : "prev";

        const logsStore = tx.objectStore(STORES.eventLogs);
        const orderIndex = logsStore.index("by_chain_order");
        const cursorRequest = orderIndex.openCursor(keyRange, idbDirection);
        const matchedRows: EventLogStoreRow[] = [];

        await new Promise<void>((resolve, reject) => {
          cursorRequest.onerror = () => {
            reject(
              cursorRequest.error
                ? new Error(cursorRequest.error.message, {
                    cause: cursorRequest.error,
                  })
                : new Error("Cursor request failed"),
            );
          };
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) {
              resolve();
              return;
            }
            const row = cursor.value as EventLogStoreRow;

            if (
              candidateEventIds !== null &&
              !candidateEventIds.has(row.eventId)
            ) {
              cursor.continue();
              return;
            }

            if (
              input.transactionHash !== undefined &&
              row.transactionHash.toLowerCase() !==
                input.transactionHash.toLowerCase()
            ) {
              cursor.continue();
              return;
            }

            if (
              input.eventName !== undefined &&
              row.eventName !== input.eventName
            ) {
              cursor.continue();
              return;
            }

            if (
              input.eventSignature !== undefined &&
              row.eventSignature !== input.eventSignature
            ) {
              cursor.continue();
              return;
            }

            if (
              input.decodeStatus !== undefined &&
              row.decodeStatus !== input.decodeStatus
            ) {
              cursor.continue();
              return;
            }

            if (input.after !== undefined) {
              const cmp = compareChainOrder(row, input.after);
              if (input.order === "ascending" && cmp <= 0) {
                cursor.continue();
                return;
              }
              if (input.order === "descending" && cmp >= 0) {
                cursor.continue();
                return;
              }
            }

            matchedRows.push(row);
            if (matchedRows.length >= input.limit) {
              resolve();
              return;
            }
            cursor.continue();
          };
        });

        if (matchedRows.length === 0) {
          return Object.freeze([]);
        }

        return Object.freeze(
          matchedRows.map((row) => rowToStoredEventLog(row)),
        );
      },
    );
  }

  public close(): Promise<void> {
    if (this.#database !== null) {
      this.#database.close();
      this.#database = null;
    }
    return Promise.resolve();
  }

  #getDatabase(): IDBDatabase {
    if (this.#database === null) {
      throw new StorageConsistencyError("IndexedDB storage is not initialized");
    }
    return this.#database;
  }

  async #getLakeTarget(targetKey: string): Promise<LakeTargetStoreRow | null> {
    const db = this.#getDatabase();
    return runTransaction(db, [STORES.lakeTargets], "readonly", async (tx) => {
      const store = tx.objectStore(STORES.lakeTargets);
      const target = (await promisifyRequest(store.get(targetKey))) as
        LakeTargetStoreRow | undefined;
      return target ?? null;
    });
  }

  async #getActiveLease(targetKey: string): Promise<SyncLeaseStoreRow | null> {
    const db = this.#getDatabase();
    const now = new Date().toISOString();
    return runTransaction(db, [STORES.syncLeases], "readonly", async (tx) => {
      const store = tx.objectStore(STORES.syncLeases);
      const lease = (await promisifyRequest(store.get(targetKey))) as
        SyncLeaseStoreRow | undefined;
      if (lease !== undefined && lease.expiresAt > now) {
        return lease;
      }
      return null;
    });
  }

  async #openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const openRequest = this.#idbFactory.open(
        this.#databaseName,
        SCHEMA_VERSION,
      );

      openRequest.onerror = () => {
        const message = openRequest.error?.message ?? "Unknown error";
        reject(
          new StorageInitializationError(
            `Failed to open IndexedDB database "${this.#databaseName}": ${message}`,
            openRequest.error ? { cause: openRequest.error } : undefined,
          ),
        );
      };

      openRequest.onblocked = () => {
        reject(
          new StorageInitializationError(
            `IndexedDB database "${this.#databaseName}" open request blocked by other tabs`,
          ),
        );
      };

      openRequest.onupgradeneeded = () => {
        const db = openRequest.result;

        if (!db.objectStoreNames.contains(STORES.lakeTargets)) {
          db.createObjectStore(STORES.lakeTargets, { keyPath: "targetKey" });
        }

        if (!db.objectStoreNames.contains(STORES.abiVersions)) {
          db.createObjectStore(STORES.abiVersions, {
            keyPath: ["targetKey", "abiFingerprint"],
          });
        }

        if (!db.objectStoreNames.contains(STORES.eventLogs)) {
          const store = db.createObjectStore(STORES.eventLogs, {
            keyPath: ["targetKey", "blockNumberKey", "logIndex"],
          });
          store.createIndex("by_chain_order", [
            "targetKey",
            "blockNumberKey",
            "transactionIndex",
            "logIndex",
            "eventId",
          ]);
          store.createIndex("by_event_id", "eventId", { unique: true });
          store.createIndex("by_target_tx", ["targetKey", "transactionHash"]);
          store.createIndex("by_target_signature", [
            "targetKey",
            "eventSignature",
          ]);
          store.createIndex("by_target_name", ["targetKey", "eventName"]);
        }

        if (!db.objectStoreNames.contains(STORES.eventParameters)) {
          const store = db.createObjectStore(STORES.eventParameters, {
            keyPath: ["targetKey", "blockNumberKey", "logIndex", "position"],
          });
          store.createIndex("by_lookup", [
            "targetKey",
            "name",
            "comparableValue",
            "indexed",
          ]);
          store.createIndex("by_event_id", "eventId");
        }

        if (!db.objectStoreNames.contains(STORES.syncCheckpoints)) {
          db.createObjectStore(STORES.syncCheckpoints, {
            keyPath: ["targetKey", "blockNumberKey"],
          });
        }

        if (!db.objectStoreNames.contains(STORES.syncLeases)) {
          db.createObjectStore(STORES.syncLeases, { keyPath: "targetKey" });
        }

        if (!db.objectStoreNames.contains(STORES.schemaMigrations)) {
          db.createObjectStore(STORES.schemaMigrations, { keyPath: "version" });
        }
      };

      openRequest.onsuccess = () => {
        resolve(openRequest.result);
      };
    });
  }
}

export function createIndexeddbStorageAdapter(
  databaseName: string,
  idbFactory?: IDBFactory,
): StorageAdapter {
  return new IndexeddbStorageAdapter({ databaseName, idbFactory });
}

function promisifyRequest(request: UntypedIDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error
          ? new Error(request.error.message, { cause: request.error })
          : new Error("IndexedDB request failed"),
      );
  });
}

async function runTransaction<T>(
  db: IDBDatabase,
  storeNames: readonly string[],
  mode: IDBTransactionMode,
  operation: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(storeNames as string[], mode);
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let operationError: unknown = null;

    tx.oncomplete = () => {
      resolve(result);
    };
    tx.onerror = () => {
      const err =
        operationError instanceof Error
          ? operationError
          : tx.error
            ? new Error(tx.error.message, { cause: tx.error })
            : new Error("IndexedDB transaction error");
      reject(err);
    };
    tx.onabort = () => {
      const err =
        operationError instanceof Error
          ? operationError
          : tx.error
            ? new Error(tx.error.message, { cause: tx.error })
            : new Error("IndexedDB transaction aborted");
      reject(err);
    };

    operation(tx)
      .then((res) => {
        result = res;
      })
      .catch((err) => {
        operationError = err;
        try {
          tx.abort();
        } catch {
          // Ignore if already aborted
        }
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

async function countAndDeleteRange(
  store: IDBObjectStore,
  range: IDBKeyRange,
): Promise<number> {
  const count = Number(await promisifyRequest(store.count(range)));
  await promisifyRequest(store.delete(range));
  return count;
}

function compareChainOrder(
  row: EventLogStoreRow,
  cursor: StoredEventQueryCursor,
): number {
  const rowBlock = storageKeyToBlockNumber(row.blockNumberKey);
  if (rowBlock !== cursor.blockNumber) {
    return rowBlock < cursor.blockNumber ? -1 : 1;
  }
  if (row.transactionIndex !== cursor.transactionIndex) {
    return row.transactionIndex - cursor.transactionIndex;
  }
  if (row.logIndex !== cursor.logIndex) {
    return row.logIndex - cursor.logIndex;
  }
  if (row.eventId !== cursor.eventId) {
    return row.eventId < cursor.eventId ? -1 : 1;
  }
  return 0;
}

function rowToStoredEventLog(row: EventLogStoreRow): StoredEventLog {
  const decodedArguments =
    row.decodedArguments === null
      ? undefined
      : decodeDecodedValue(row.decodedArguments);

  const parameters: readonly DecodedEventParameter[] = Object.freeze(
    row.parameters.map((param) =>
      Object.freeze({
        comparableValue: param.comparableValue,
        indexed: param.indexed,
        name: param.name,
        position: param.position,
        rawTopicValue: param.rawTopicValue,
        solidityType: param.solidityType,
        value: readDecodedArgument(
          decodedArguments,
          param.name,
          param.position,
        ),
      }),
    ),
  );

  return Object.freeze({
    abiFingerprint: row.abiFingerprint,
    blockHash: row.blockHash,
    blockNumber: storageKeyToBlockNumber(row.blockNumberKey),
    contractAddress: row.contractAddress as Address,
    data: row.data,
    decodedArguments: row.decodedArguments,
    decodeStatus: row.decodeStatus,
    eventId: row.eventId,
    eventName: row.eventName,
    eventSignature: row.eventSignature,
    logIndex: row.logIndex,
    parameters,
    removed: row.removed,
    targetKey: row.targetKey,
    topics: Object.freeze([...row.topics]),
    transactionHash: row.transactionHash,
    transactionIndex: row.transactionIndex,
  });
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
