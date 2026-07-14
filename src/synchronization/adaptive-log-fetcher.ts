import type { Address } from "viem";

import {
  NoValidRpcEndpointError,
  RpcRequestExhaustedError,
  UnfetchableBlockError,
} from "../errors/evm-event-lake-errors.js";
import type {
  FetchLogsOptions,
  RpcLog,
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
  readonly #rpc: AdaptiveLogRpcClient;
  #rangeSplits = 0;

  public constructor(input: {
    readonly contractAddress: Address;
    readonly beforeRequest?: () => Promise<void>;
    readonly maximumTimeoutSplitsPerRange: number;
    readonly minimumBlockRange: number;
    readonly rpc: AdaptiveLogRpcClient;
  }) {
    this.#beforeRequest = input.beforeRequest;
    this.#contractAddress = input.contractAddress;
    this.#maximumTimeoutSplitsPerRange = input.maximumTimeoutSplitsPerRange;
    this.#minimumBlockRange = input.minimumBlockRange;
    this.#rpc = input.rpc;
  }

  public getMetrics(): AdaptiveLogFetcherMetrics {
    return Object.freeze({ rangeSplits: this.#rangeSplits });
  }

  public async *fetch(
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
        await this.#beforeRequest?.();
        const result = await this.#rpc.fetchLogs(
          this.#contractAddress,
          pendingRange.range.fromBlock,
          pendingRange.range.toBlock,
          {
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
