import type { Address } from "viem";

import type { NormalizedRpcTopics } from "../configuration/sdk-options.js";
import {
  NoValidRpcEndpointError,
  OperationCancelledError,
  RpcRequestExhaustedError,
  UnfetchableBlockError,
} from "../errors/evm-event-lake-errors.js";
import type {
  FetchLogsOptions,
  LogRangeQuery,
  RpcLog,
  RpcLogsBatchResult,
  RpcLogsResult,
} from "../rpc/rpc-pool.js";
import { RpcRequestFailure } from "../rpc/rpc-error-classifier.js";
import {
  splitSynchronizationRange,
  type SynchronizationRange,
} from "./synchronization-range-planner.js";

export interface AdaptiveLogRpcClient {
  cooldownEndpoint(endpointReference: string): void;
  fetchLogs(
    contractAddress: Address,
    fromBlock: bigint,
    toBlock: bigint,
    options?: FetchLogsOptions,
  ): Promise<RpcLogsResult>;
  fetchLogsBatch?(
    contractAddress: Address,
    ranges: readonly LogRangeQuery[],
    options?: FetchLogsOptions,
  ): Promise<RpcLogsBatchResult>;
}

export interface FetchedLogRange {
  readonly endpointIdentity: string;
  readonly endpointUrl: string;
  readonly logs: readonly RpcLog[];
  readonly range: SynchronizationRange;
}

export interface AdaptiveLogFetcherMetrics {
  readonly rangeSplits: number;
}

export interface AdaptiveLogRangeSplitEvent {
  readonly children: readonly [SynchronizationRange, SynchronizationRange];
  readonly range: SynchronizationRange;
  readonly reason: "range_limit" | "timeout";
}

interface PendingRange {
  readonly preferredEndpointIdentity?: string;
  readonly range: SynchronizationRange;
  readonly timeoutSplits: number;
}

export class AdaptiveLogFetcher {
  readonly #beforeRequest: (() => Promise<void>) | undefined;
  readonly #contractAddress: Address;
  readonly #maximumTimeoutSplitsPerRange: number;
  readonly #minimumBlockRange: number;
  readonly #onRangeFetchStarted:
    ((range: SynchronizationRange) => void) | undefined;
  readonly #onRangeSplit:
    ((event: AdaptiveLogRangeSplitEvent) => void) | undefined;
  readonly #rpc: AdaptiveLogRpcClient;
  readonly #topics: NormalizedRpcTopics | undefined;
  #rangeSplits = 0;

  public constructor(input: {
    readonly contractAddress: Address;
    readonly beforeRequest?: () => Promise<void>;
    readonly maximumTimeoutSplitsPerRange: number;
    readonly minimumBlockRange: number;
    readonly onRangeFetchStarted?: (range: SynchronizationRange) => void;
    readonly onRangeSplit?: (event: AdaptiveLogRangeSplitEvent) => void;
    readonly rpc: AdaptiveLogRpcClient;
    readonly topics?: NormalizedRpcTopics | undefined;
  }) {
    this.#beforeRequest = input.beforeRequest;
    this.#contractAddress = input.contractAddress;
    this.#maximumTimeoutSplitsPerRange = input.maximumTimeoutSplitsPerRange;
    this.#minimumBlockRange = input.minimumBlockRange;
    this.#onRangeFetchStarted = input.onRangeFetchStarted;
    this.#onRangeSplit = input.onRangeSplit;
    this.#rpc = input.rpc;
    this.#topics = input.topics;
  }

  public getMetrics(): AdaptiveLogFetcherMetrics {
    return Object.freeze({ rangeSplits: this.#rangeSplits });
  }

  public async *fetch(
    range: SynchronizationRange,
    signal?: AbortSignal,
  ): AsyncGenerator<FetchedLogRange> {
    yield* this.fetchRanges([range], signal);
  }

  public async *fetchRanges(
    ranges: readonly SynchronizationRange[],
    signal?: AbortSignal,
  ): AsyncGenerator<FetchedLogRange> {
    if (ranges.length === 0) return;
    if (ranges.length === 1 || this.#rpc.fetchLogsBatch === undefined) {
      for (const range of ranges) {
        yield* this.#fetchSingleRange(range, signal);
      }
      return;
    }

    try {
      await this.#beforeRequest?.();
      for (const range of ranges) {
        this.#onRangeFetchStarted?.(range);
      }
      const batchResult = await this.#rpc.fetchLogsBatch(
        this.#contractAddress,
        ranges,
        {
          ...(this.#topics === undefined ? {} : { topics: this.#topics }),
          ...(signal === undefined ? {} : { signal }),
        },
      );
      for (const item of batchResult.items) {
        const matchingRange = ranges.find(
          (candidate) =>
            candidate.fromBlock === item.fromBlock &&
            candidate.toBlock === item.toBlock,
        );
        yield Object.freeze({
          endpointIdentity: batchResult.endpointIdentity,
          endpointUrl: batchResult.endpointUrl,
          logs: item.logs,
          range: matchingRange ?? {
            fromBlock: item.fromBlock,
            toBlock: item.toBlock,
          },
        });
      }
      return;
    } catch (error) {
      if (error instanceof OperationCancelledError) throw error;
      for (const range of ranges) {
        yield* this.#fetchSingleRange(range, signal);
      }
    }
  }

  async *#fetchSingleRange(
    range: SynchronizationRange,
    signal?: AbortSignal,
  ): AsyncGenerator<FetchedLogRange> {
    const pendingRanges: PendingRange[] = [
      Object.freeze({ range, timeoutSplits: 0 }),
    ];

    while (pendingRanges.length > 0) {
      const pendingRange = pendingRanges.shift();
      if (pendingRange === undefined) break;
      try {
        this.#onRangeFetchStarted?.(pendingRange.range);
        await this.#beforeRequest?.();
        const result = await this.#rpc.fetchLogs(
          this.#contractAddress,
          pendingRange.range.fromBlock,
          pendingRange.range.toBlock,
          {
            ...(this.#topics === undefined ? {} : { topics: this.#topics }),
            ...(pendingRange.preferredEndpointIdentity === undefined
              ? {}
              : {
                  preferredEndpointIdentity:
                    pendingRange.preferredEndpointIdentity,
                }),
            ...(signal === undefined ? {} : { signal }),
          },
        );
        yield Object.freeze({
          endpointIdentity: result.endpointIdentity,
          endpointUrl: result.endpointUrl,
          logs: result.logs,
          range: pendingRange.range,
        });
      } catch (error) {
        if (error instanceof RpcRequestFailure) {
          if (error.category === "range_limit") {
            const split = splitSynchronizationRange(
              pendingRange.range,
              this.#minimumBlockRange,
            );
            if (split !== null) {
              this.#rangeSplits += 1;
              this.#onRangeSplit?.(
                Object.freeze({
                  children: split,
                  range: pendingRange.range,
                  reason: "range_limit",
                }),
              );
              pendingRanges.unshift(
                createPendingRange(
                  split[0],
                  error.endpointIdentity,
                  pendingRange.timeoutSplits,
                ),
                createPendingRange(
                  split[1],
                  error.endpointIdentity,
                  pendingRange.timeoutSplits,
                ),
              );
              continue;
            }
            this.#rpc.cooldownEndpoint(error.endpointIdentity);
            pendingRanges.unshift(
              createPendingRange(pendingRange.range, undefined, 0),
            );
            continue;
          }

          if (error.category === "timeout") {
            const split = splitSynchronizationRange(
              pendingRange.range,
              this.#minimumBlockRange,
            );
            if (
              split !== null &&
              pendingRange.timeoutSplits < this.#maximumTimeoutSplitsPerRange
            ) {
              this.#rangeSplits += 1;
              this.#onRangeSplit?.(
                Object.freeze({
                  children: split,
                  range: pendingRange.range,
                  reason: "timeout",
                }),
              );
              const timeoutSplits = pendingRange.timeoutSplits + 1;
              pendingRanges.unshift(
                createPendingRange(
                  split[0],
                  error.endpointIdentity,
                  timeoutSplits,
                ),
                createPendingRange(
                  split[1],
                  error.endpointIdentity,
                  timeoutSplits,
                ),
              );
              continue;
            }
            this.#rpc.cooldownEndpoint(error.endpointIdentity);
            pendingRanges.unshift(
              createPendingRange(pendingRange.range, undefined, 0),
            );
            continue;
          }
        }

        if (
          error instanceof NoValidRpcEndpointError ||
          error instanceof RpcRequestExhaustedError
        ) {
          throw new UnfetchableBlockError(
            "No RPC endpoint can fetch the required log range",
            {
              cause: error,
              context: {
                fromBlock: pendingRange.range.fromBlock.toString(),
                toBlock: pendingRange.range.toBlock.toString(),
              },
            },
          );
        }
        throw error;
      }
    }
  }
}

function createPendingRange(
  range: SynchronizationRange,
  preferredEndpointIdentity: string | undefined,
  timeoutSplits: number,
): PendingRange {
  return Object.freeze({
    ...(preferredEndpointIdentity === undefined
      ? {}
      : { preferredEndpointIdentity }),
    range,
    timeoutSplits,
  });
}
