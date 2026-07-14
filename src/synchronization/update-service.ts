import { randomUUID } from "node:crypto";

import type { Address } from "viem";

import { encodeDecodedValue } from "../abi/decoded-value-codec.js";
import { decodeRawEventLog } from "../abi/event-decoder.js";
import type { EventCatalog } from "../abi/event-catalog.js";
import type {
  NormalizedRpcPolicy,
  NormalizedSynchronizationPolicy,
} from "../configuration/sdk-options.js";
import { normalizeBlockNumber } from "../configuration/validate-sdk-options.js";
import type { ContractTarget } from "../contract-target/contract-target.js";
import {
  ConfigurationValidationError,
  OperationCancelledError,
  StorageConsistencyError,
  SynchronizationFailedError,
  SynchronizationLockedError,
} from "../errors/evm-event-lake-errors.js";
import {
  emitLogSafely,
  emitProgressSafely,
  type SdkLogger,
  type UpdateProgressCallback,
} from "../observability/sdk-logger.js";
import type {
  RpcBlockHeader,
  RpcLog,
  RpcPoolMetrics,
  RpcRequestOptions,
} from "../rpc/rpc-pool.js";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import {
  createStoredEventId,
  type StoredEventLog,
} from "../storage/storage-models.js";
import {
  AdaptiveLogFetcher,
  type AdaptiveLogRpcClient,
} from "./adaptive-log-fetcher.js";
import { ensureChainConsistency } from "./chain-consistency-checker.js";
import { iterateSynchronizationRanges } from "./synchronization-range-planner.js";
import type {
  UpdateOptions,
  UpdateResult,
  UpdateRewindResult,
} from "./synchronization-result.js";

export interface UpdateRpcClient extends AdaptiveLogRpcClient {
  getBlockHeader(
    blockNumber: bigint,
    options?: RpcRequestOptions,
  ): Promise<RpcBlockHeader>;
  getBlockNumber(signal?: AbortSignal): Promise<bigint>;
  getMetrics(): RpcPoolMetrics;
}

export interface UpdateServiceDependencies {
  readonly createOwnerToken?: () => string;
  readonly now?: () => number;
}

export class UpdateService {
  readonly #catalog: EventCatalog;
  readonly #createOwnerToken: () => string;
  readonly #logger: SdkLogger | undefined;
  readonly #now: () => number;
  readonly #onProgress: UpdateProgressCallback | undefined;
  readonly #rpc: UpdateRpcClient;
  readonly #rpcPolicy: NormalizedRpcPolicy;
  readonly #storage: StorageAdapter;
  readonly #synchronizationPolicy: NormalizedSynchronizationPolicy;
  readonly #target: ContractTarget;

  public constructor(input: {
    readonly catalog: EventCatalog;
    readonly dependencies?: UpdateServiceDependencies;
    readonly logger?: SdkLogger;
    readonly onProgress?: UpdateProgressCallback;
    readonly rpc: UpdateRpcClient;
    readonly rpcPolicy: NormalizedRpcPolicy;
    readonly storage: StorageAdapter;
    readonly synchronizationPolicy: NormalizedSynchronizationPolicy;
    readonly target: ContractTarget;
  }) {
    this.#catalog = input.catalog;
    this.#createOwnerToken = input.dependencies?.createOwnerToken ?? randomUUID;
    this.#logger = input.logger;
    this.#now = input.dependencies?.now ?? Date.now;
    this.#onProgress = input.onProgress;
    this.#rpc = input.rpc;
    this.#rpcPolicy = input.rpcPolicy;
    this.#storage = input.storage;
    this.#synchronizationPolicy = input.synchronizationPolicy;
    this.#target = input.target;
  }

  public async update(options: UpdateOptions = {}): Promise<UpdateResult> {
    if (options.signal?.aborted === true) {
      throw new OperationCancelledError(
        "Synchronization update was cancelled before start",
      );
    }
    const startedAt = this.#now();
    const blockRange = normalizeBlockRange(
      options.blockRange,
      this.#synchronizationPolicy.defaultBlockRange,
    );
    const ownerToken = this.#createOwnerToken();
    const leaseDurationMs = this.#synchronizationPolicy.leaseDurationMs;
    let leaseExpiresAt = startedAt + leaseDurationMs;
    const acquired = await this.#storage.acquireLease({
      expiresAt: new Date(leaseExpiresAt).toISOString(),
      ownerToken,
      targetKey: this.#target.targetKey,
    });
    if (!acquired) {
      throw new SynchronizationLockedError(
        "Another update owns the target synchronization lease",
        { context: { targetKey: this.#target.targetKey } },
      );
    }

    emitProgressSafely(this.#onProgress, { stage: "update_started" });
    emitLogSafely(this.#logger, {
      event: "update_started",
      level: "info",
      message: "Event synchronization update started",
      context: { targetKey: this.#target.targetKey },
    });

    let lastCommittedBlock: bigint | null = null;
    try {
      const renewLease = async (): Promise<void> => {
        leaseExpiresAt = await this.#renewLeaseIfNeeded(
          ownerToken,
          leaseExpiresAt,
        );
      };
      const initialState = await this.#storage.getTargetState(
        this.#target.targetKey,
      );
      if (initialState === null) {
        throw new StorageConsistencyError(
          "Update target is not registered in storage",
        );
      }

      const metricsBefore = this.#rpc.getMetrics();
      const consistency = await ensureChainConsistency({
        beforeRequest: renewLease,
        reorgCheckDepth: this.#synchronizationPolicy.reorgCheckDepth,
        rpc: this.#rpc,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        storage: this.#storage,
        targetKey: this.#target.targetKey,
      });
      const state =
        consistency.rewind === null
          ? initialState
          : await this.#requireTargetState();
      const rewind: UpdateRewindResult | null =
        consistency.rewind === null || consistency.rewindFromBlock === null
          ? null
          : Object.freeze({
              ...consistency.rewind,
              rewindFromBlock: consistency.rewindFromBlock,
            });
      if (rewind !== null) {
        emitProgressSafely(this.#onProgress, {
          context: {
            nextBlock: rewind.nextBlock.toString(),
            rewindFromBlock: rewind.rewindFromBlock.toString(),
          },
          stage: "reorg_rewind",
        });
      }

      await renewLease();
      const resolvedToBlock = await this.#resolveToBlock(options);
      const fromBlock = state.nextBlock;
      if (
        fromBlock > resolvedToBlock ||
        resolvedToBlock < this.#target.startBlock
      ) {
        return this.#createResult({
          committedRanges: 0,
          decodeFailedLogs: 0,
          decodedLogs: 0,
          duplicateLogs: 0,
          fetchedLogs: 0,
          fromBlock,
          metricsBefore,
          outcome: "no_op",
          preferredRanges: 0,
          previousNextBlock: initialState.nextBlock,
          rangeSplits: 0,
          resultingNextBlock: state.nextBlock,
          rewind,
          startedAt,
          storedLogs: 0,
          toBlock: resolvedToBlock,
          unknownLogs: 0,
        });
      }

      const adaptiveFetcher = new AdaptiveLogFetcher({
        beforeRequest: renewLease,
        contractAddress: this.#target.contractAddress,
        maximumTimeoutSplitsPerRange:
          this.#rpcPolicy.maximumTimeoutSplitsPerRange,
        minimumBlockRange: this.#synchronizationPolicy.minimumBlockRange,
        rpc: this.#rpc,
      });
      let committedRanges = 0;
      let decodeFailedLogs = 0;
      let decodedLogs = 0;
      let duplicateLogs = 0;
      let fetchedLogs = 0;
      let preferredRanges = 0;
      let storedLogs = 0;
      let unknownLogs = 0;

      for (const preferredRange of iterateSynchronizationRanges(
        fromBlock,
        resolvedToBlock,
        blockRange,
      )) {
        preferredRanges += 1;
        for await (const fetchedRange of adaptiveFetcher.fetch(
          preferredRange,
          options.signal,
        )) {
          await renewLease();
          const logs = normalizeLogs(
            fetchedRange.logs,
            this.#target.contractAddress,
            fetchedRange.range.fromBlock,
            fetchedRange.range.toBlock,
          );
          fetchedLogs += logs.length;

          const storedEventLogs = logs.map((log) => {
            const storedLog = createStoredEventLog(
              log,
              this.#target.targetKey,
              this.#catalog,
            );
            if (storedLog.decodeStatus === "decoded") decodedLogs += 1;
            if (storedLog.decodeStatus === "unknown") unknownLogs += 1;
            if (storedLog.decodeStatus === "decode_failed")
              decodeFailedLogs += 1;
            return storedLog;
          });
          const endBlockHeader = await this.#rpc.getBlockHeader(
            fetchedRange.range.toBlock,
            {
              preferredEndpointIdentity: fetchedRange.endpointIdentity,
              ...(options.signal === undefined
                ? {}
                : { signal: options.signal }),
            },
          );
          validateEndBlockLogs(
            logs,
            endBlockHeader,
            fetchedRange.range.toBlock,
          );

          const commit = await this.#storage.commitRange({
            abiFingerprint: this.#catalog.abiFingerprint,
            endBlockHash: endBlockHeader.hash,
            fromBlock: fetchedRange.range.fromBlock,
            logs: storedEventLogs,
            targetKey: this.#target.targetKey,
            toBlock: fetchedRange.range.toBlock,
          });
          committedRanges += 1;
          duplicateLogs += commit.duplicateLogs;
          storedLogs += commit.insertedLogs;
          lastCommittedBlock = fetchedRange.range.toBlock;
          emitProgressSafely(this.#onProgress, {
            context: {
              fromBlock: fetchedRange.range.fromBlock.toString(),
              toBlock: fetchedRange.range.toBlock.toString(),
            },
            stage: "range_committed",
          });
        }
      }

      const finalState = await this.#requireTargetState();
      const result = this.#createResult({
        committedRanges,
        decodeFailedLogs,
        decodedLogs,
        duplicateLogs,
        fetchedLogs,
        fromBlock,
        metricsBefore,
        outcome: "synchronized",
        preferredRanges,
        previousNextBlock: initialState.nextBlock,
        rangeSplits: adaptiveFetcher.getMetrics().rangeSplits,
        resultingNextBlock: finalState.nextBlock,
        rewind,
        startedAt,
        storedLogs,
        toBlock: resolvedToBlock,
        unknownLogs,
      });
      emitProgressSafely(this.#onProgress, {
        context: { resultingNextBlock: result.resultingNextBlock.toString() },
        stage: "update_completed",
      });
      return result;
    } catch (error) {
      if (error instanceof OperationCancelledError) {
        throw new OperationCancelledError(
          "Synchronization update was cancelled",
          {
            cause: error,
            context: {
              lastCommittedBlock: lastCommittedBlock?.toString() ?? null,
              targetKey: this.#target.targetKey,
            },
          },
        );
      }
      if (lastCommittedBlock !== null) {
        throw new SynchronizationFailedError(
          "Synchronization stopped after committing partial progress",
          {
            cause: error,
            context: {
              lastCommittedBlock: lastCommittedBlock.toString(),
              targetKey: this.#target.targetKey,
            },
          },
        );
      }
      throw error;
    } finally {
      await this.#storage.releaseLease({
        ownerToken,
        targetKey: this.#target.targetKey,
      });
    }
  }

  async #resolveToBlock(options: UpdateOptions): Promise<bigint> {
    if (options.toBlock !== undefined) {
      return normalizeBlockNumber(options.toBlock, "update.toBlock");
    }
    const latestBlock = await this.#rpc.getBlockNumber(options.signal);
    const confirmations = BigInt(this.#synchronizationPolicy.confirmations);
    return latestBlock > confirmations ? latestBlock - confirmations : 0n;
  }

  async #renewLeaseIfNeeded(
    ownerToken: string,
    currentLeaseExpiresAt: number,
  ): Promise<number> {
    if (
      this.#now() <
      currentLeaseExpiresAt - this.#synchronizationPolicy.leaseDurationMs / 2
    ) {
      return currentLeaseExpiresAt;
    }
    const renewedLeaseExpiresAt =
      this.#now() + this.#synchronizationPolicy.leaseDurationMs;
    const renewed = await this.#storage.renewLease({
      expiresAt: new Date(renewedLeaseExpiresAt).toISOString(),
      ownerToken,
      targetKey: this.#target.targetKey,
    });
    if (!renewed) {
      throw new SynchronizationLockedError(
        "Synchronization lease could not be renewed",
        { context: { targetKey: this.#target.targetKey } },
      );
    }
    return renewedLeaseExpiresAt;
  }

  async #requireTargetState() {
    const state = await this.#storage.getTargetState(this.#target.targetKey);
    if (state === null) {
      throw new StorageConsistencyError(
        "Target state disappeared during update",
      );
    }
    return state;
  }

  #createResult(input: {
    readonly committedRanges: number;
    readonly decodeFailedLogs: number;
    readonly decodedLogs: number;
    readonly duplicateLogs: number;
    readonly fetchedLogs: number;
    readonly fromBlock: bigint;
    readonly metricsBefore: RpcPoolMetrics;
    readonly outcome: "no_op" | "synchronized";
    readonly preferredRanges: number;
    readonly previousNextBlock: bigint;
    readonly rangeSplits: number;
    readonly resultingNextBlock: bigint;
    readonly rewind: UpdateRewindResult | null;
    readonly startedAt: number;
    readonly storedLogs: number;
    readonly toBlock: bigint;
    readonly unknownLogs: number;
  }): UpdateResult {
    const metricsAfter = this.#rpc.getMetrics();
    return Object.freeze({
      committedRanges: input.committedRanges,
      decodeFailedLogs: input.decodeFailedLogs,
      decodedLogs: input.decodedLogs,
      duplicateLogs: input.duplicateLogs,
      durationMs: Math.max(0, this.#now() - input.startedAt),
      endpointFailovers:
        metricsAfter.endpointFailovers - input.metricsBefore.endpointFailovers,
      fetchedLogs: input.fetchedLogs,
      fromBlock: input.fromBlock,
      outcome: input.outcome,
      preferredRanges: input.preferredRanges,
      previousNextBlock: input.previousNextBlock,
      rangeSplits: input.rangeSplits,
      resultingNextBlock: input.resultingNextBlock,
      rewind: input.rewind,
      rpcRequests: metricsAfter.requestCount - input.metricsBefore.requestCount,
      storedLogs: input.storedLogs,
      toBlock: input.toBlock,
      unknownLogs: input.unknownLogs,
    });
  }
}

function normalizeBlockRange(
  value: number | undefined,
  defaultValue: number,
): number {
  const blockRange = value ?? defaultValue;
  if (!Number.isSafeInteger(blockRange) || blockRange <= 0) {
    throw new ConfigurationValidationError(
      "update.blockRange must be positive",
    );
  }
  return blockRange;
}

function normalizeLogs(
  logs: readonly RpcLog[],
  contractAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
): readonly RpcLog[] {
  const uniqueLogs = new Map<string, RpcLog>();
  for (const log of logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
      throw new StorageConsistencyError(
        "RPC returned a log for a different contract address",
      );
    }
    if (log.blockNumber < fromBlock || log.blockNumber > toBlock) {
      throw new StorageConsistencyError(
        "RPC returned a log outside the requested block range",
      );
    }
    const identity = [log.blockHash, log.transactionHash, log.logIndex].join(
      "|",
    );
    uniqueLogs.set(identity, log);
  }
  return Object.freeze(
    [...uniqueLogs.values()].sort(
      (left, right) =>
        compareBigInt(left.blockNumber, right.blockNumber) ||
        left.transactionIndex - right.transactionIndex ||
        left.logIndex - right.logIndex,
    ),
  );
}

function createStoredEventLog(
  rpcLog: RpcLog,
  targetKey: string,
  catalog: EventCatalog,
): StoredEventLog {
  const decoded = decodeRawEventLog(catalog, rpcLog);
  const common = {
    abiFingerprint: catalog.abiFingerprint,
    blockHash: rpcLog.blockHash,
    blockNumber: rpcLog.blockNumber,
    contractAddress: rpcLog.address,
    data: rpcLog.data,
    eventId: createStoredEventId({
      blockHash: rpcLog.blockHash,
      logIndex: rpcLog.logIndex,
      targetKey,
      transactionHash: rpcLog.transactionHash,
    }),
    logIndex: rpcLog.logIndex,
    removed: rpcLog.removed,
    targetKey,
    topics: rpcLog.topics,
    transactionHash: rpcLog.transactionHash,
    transactionIndex: rpcLog.transactionIndex,
  } as const;

  if (decoded.status === "decoded") {
    return Object.freeze({
      ...common,
      decodedArguments: encodeDecodedValue(decoded.arguments),
      decodeStatus: "decoded",
      eventName: decoded.eventName,
      eventSignature: decoded.eventSignature,
      parameters: decoded.parameters,
    });
  }
  return Object.freeze({
    ...common,
    decodedArguments: null,
    decodeStatus: decoded.status,
    eventName: null,
    eventSignature: null,
    parameters: Object.freeze([]),
  });
}

function validateEndBlockLogs(
  logs: readonly RpcLog[],
  endBlockHeader: RpcBlockHeader,
  expectedBlockNumber: bigint,
): void {
  if (endBlockHeader.number !== expectedBlockNumber) {
    throw new StorageConsistencyError(
      "RPC checkpoint returned a different block number",
    );
  }
  if (logs.some((log) => log.blockNumber > endBlockHeader.number)) {
    throw new StorageConsistencyError(
      "RPC checkpoint block is behind fetched event logs",
    );
  }
  for (const log of logs) {
    if (
      log.blockNumber === endBlockHeader.number &&
      log.blockHash.toLowerCase() !== endBlockHeader.hash.toLowerCase()
    ) {
      throw new StorageConsistencyError(
        "RPC log block hash does not match the committed checkpoint",
      );
    }
  }
}

function compareBigInt(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
