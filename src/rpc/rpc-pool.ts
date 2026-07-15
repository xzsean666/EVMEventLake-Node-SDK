import { isAddress, type Address, type Hex } from "viem";

import type { NormalizedRpcPolicy } from "../configuration/sdk-options.js";
import { redactUrl } from "../configuration/validate-sdk-options.js";
import {
  NoValidRpcEndpointError,
  OperationCancelledError,
  RpcChainMismatchError,
  RpcRequestExhaustedError,
} from "../errors/evm-event-lake-errors.js";
import { HttpEvmRpcClient, type RpcTransport } from "./evm-rpc-client.js";
import { RpcEndpoint } from "./rpc-endpoint.js";
import {
  RpcRequestFailure,
  type RpcFailureCategory,
} from "./rpc-error-classifier.js";

export interface RpcBlockHeader {
  readonly hash: Hex;
  readonly number: bigint;
  readonly parentHash: Hex;
}

export interface RpcLog {
  readonly address: Address;
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly data: Hex;
  readonly logIndex: number;
  readonly removed: boolean;
  readonly topics: readonly Hex[];
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
}

export interface RpcLogsResult {
  readonly endpointIdentity: string;
  readonly endpointUrl: string;
  readonly logs: readonly RpcLog[];
}

export interface RpcPoolMetrics {
  readonly endpointFailovers: number;
  readonly requestCount: number;
}

export interface FetchLogsOptions {
  readonly preferredEndpointIdentity?: string;
  readonly signal?: AbortSignal;
}

export interface RpcRequestOptions {
  readonly preferredEndpointIdentity?: string;
  readonly signal?: AbortSignal;
}

export interface RpcPoolDependencies {
  readonly now?: () => number;
  readonly sleep?: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly transport?: RpcTransport;
}

interface EndpointRequestOptions {
  readonly immediateFailureCategories?: ReadonlySet<RpcFailureCategory>;
  readonly preferredEndpointIdentity?: string;
  readonly signal?: AbortSignal;
}

interface EndpointRequestResult<Value> {
  readonly endpoint: RpcEndpoint;
  readonly value: Value;
}

// Upper bound on how long we'll honor a server-provided Retry-After / cooldown
// hint, so a broken or hostile endpoint can't stall retries indefinitely.
const MAX_RETRY_DELAY_MS = 60_000;

// Defensive limits on eth_getLogs responses: the EVM caps LOG opcodes at 4
// topics (LOG0..LOG4), so more than that is malformed data, not just large
// data. The count/size limits guard against a misbehaving endpoint returning
// an unbounded response that would otherwise be fully buffered into memory.
const MAX_LOG_ENTRIES = 50_000;
const MAX_LOG_TOPICS = 4;
const MAX_LOG_DATA_BYTES = 1_048_576;

export class RpcPool {
  readonly #chainId: number;
  readonly #endpoints: readonly RpcEndpoint[];
  readonly #now: () => number;
  readonly #policy: NormalizedRpcPolicy;
  readonly #sleep: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly #transport: RpcTransport;
  #endpointFailovers = 0;
  #requestCount = 0;

  public constructor(
    chainId: number,
    rpcUrls: readonly string[],
    policy: NormalizedRpcPolicy,
    dependencies: RpcPoolDependencies = {},
  ) {
    this.#chainId = chainId;
    this.#endpoints = Object.freeze(
      rpcUrls.map((rpcUrl) => new RpcEndpoint(rpcUrl)),
    );
    this.#policy = policy;
    this.#transport = dependencies.transport ?? new HttpEvmRpcClient();
    this.#now = dependencies.now ?? Date.now;
    this.#sleep = dependencies.sleep ?? sleepWithCancellation;
  }

  public getMetrics(): RpcPoolMetrics {
    return Object.freeze({
      endpointFailovers: this.#endpointFailovers,
      requestCount: this.#requestCount,
    });
  }

  public cooldownEndpoint(endpointReference: string): void {
    const endpoint = this.#endpoints.find(
      (candidate) =>
        candidate.identity === endpointReference ||
        candidate.url === endpointReference ||
        redactUrl(candidate.url) === endpointReference,
    );
    endpoint?.markCoolingDown(this.#now(), this.#policy.endpointCooldownMs);
  }

  public async getBlockNumber(signal?: AbortSignal): Promise<bigint> {
    const result = await this.#requestWithFailover(
      "eth_blockNumber",
      [],
      parseHexQuantity,
      signal === undefined ? {} : { signal },
    );
    return result.value;
  }

  public async getBlockHeader(
    blockNumber: bigint,
    options: RpcRequestOptions = {},
  ): Promise<RpcBlockHeader> {
    const result = await this.#requestWithFailover(
      "eth_getBlockByNumber",
      [toHexQuantity(blockNumber), false],
      (value) => parseBlockHeader(value, blockNumber),
      {
        ...(options.preferredEndpointIdentity === undefined
          ? {}
          : { preferredEndpointIdentity: options.preferredEndpointIdentity }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    return result.value;
  }

  public async fetchLogs(
    contractAddress: Address,
    fromBlock: bigint,
    toBlock: bigint,
    options: FetchLogsOptions = {},
  ): Promise<RpcLogsResult> {
    const result = await this.#requestWithFailover(
      "eth_getLogs",
      [
        {
          address: contractAddress,
          fromBlock: toHexQuantity(fromBlock),
          toBlock: toHexQuantity(toBlock),
        },
      ],
      parseRpcLogs,
      {
        immediateFailureCategories: new Set(["range_limit"]),
        ...(options.preferredEndpointIdentity === undefined
          ? {}
          : { preferredEndpointIdentity: options.preferredEndpointIdentity }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    return Object.freeze({
      endpointIdentity: result.endpoint.identity,
      endpointUrl: redactUrl(result.endpoint.url),
      logs: result.value,
    });
  }

  async #requestWithFailover<Value>(
    method: string,
    params: readonly unknown[],
    parseResult: (value: unknown) => Value,
    options: EndpointRequestOptions,
  ): Promise<EndpointRequestResult<Value>> {
    if (options.signal?.aborted === true) {
      throw new OperationCancelledError("RPC operation was cancelled");
    }
    const endpoints = this.#orderedAvailableEndpoints(
      options.preferredEndpointIdentity,
    );
    if (endpoints.length === 0) {
      throw new NoValidRpcEndpointError(
        "No RPC endpoint is currently available",
        {
          context: {
            endpoints: this.#endpoints.map((endpoint) =>
              redactUrl(endpoint.url),
            ),
          },
        },
      );
    }

    let lastFailure: unknown;
    for (const [endpointIndex, endpoint] of endpoints.entries()) {
      if (endpointIndex > 0) this.#endpointFailovers += 1;
      try {
        await this.#validateEndpoint(endpoint, options.signal);
        const rawValue = await this.#requestEndpointWithRetries(
          endpoint,
          method,
          params,
          options,
        );
        try {
          return Object.freeze({ endpoint, value: parseResult(rawValue) });
        } catch (cause) {
          throw new RpcRequestFailure("RPC result failed validation", {
            category: "invalid_response",
            cause,
            endpointUrl: endpoint.url,
            method,
          });
        }
      } catch (error) {
        if (error instanceof OperationCancelledError) throw error;
        if (
          error instanceof RpcRequestFailure &&
          options.immediateFailureCategories?.has(error.category) === true
        ) {
          throw error;
        }
        lastFailure = error;
        const serverRetryAfterMs =
          error instanceof RpcRequestFailure ? error.retryAfterMs : undefined;
        const cooldownMs =
          serverRetryAfterMs === undefined
            ? this.#policy.endpointCooldownMs
            : Math.max(
                this.#policy.endpointCooldownMs,
                Math.min(serverRetryAfterMs, MAX_RETRY_DELAY_MS),
              );
        endpoint.markCoolingDown(this.#now(), cooldownMs);
      }
    }

    throw new RpcRequestExhaustedError(`RPC request failed for ${method}`, {
      cause: lastFailure,
      context: {
        endpoints: endpoints.map((endpoint) => redactUrl(endpoint.url)),
        method,
      },
    });
  }

  async #validateEndpoint(
    endpoint: RpcEndpoint,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (endpoint.validationState === "valid") return;
    if (endpoint.validationState === "invalid") {
      throw new RpcChainMismatchError("RPC endpoint chain ID was rejected", {
        context: { endpointUrl: redactUrl(endpoint.url) },
      });
    }

    const chainIdValue = await this.#requestEndpointWithRetries(
      endpoint,
      "eth_chainId",
      [],
      signal === undefined ? {} : { signal },
    );
    const endpointChainId = Number(parseHexQuantity(chainIdValue));
    if (endpointChainId !== this.#chainId) {
      endpoint.validationState = "invalid";
      throw new RpcChainMismatchError(
        "RPC endpoint returned a different chain ID",
        {
          context: {
            actualChainId: endpointChainId,
            endpointUrl: redactUrl(endpoint.url),
            expectedChainId: this.#chainId,
          },
        },
      );
    }
    endpoint.validationState = "valid";
  }

  async #requestEndpointWithRetries(
    endpoint: RpcEndpoint,
    method: string,
    params: readonly unknown[],
    options: EndpointRequestOptions,
  ): Promise<unknown> {
    let lastFailure: RpcRequestFailure | undefined;
    for (
      let attempt = 0;
      attempt <= this.#policy.maxRetriesPerEndpoint;
      attempt += 1
    ) {
      try {
        this.#requestCount += 1;
        return await this.#transport.request({
          endpointUrl: endpoint.url,
          method,
          params,
          requestTimeoutMs: this.#policy.requestTimeoutMs,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } catch (error) {
        if (error instanceof OperationCancelledError) throw error;
        const failure =
          error instanceof RpcRequestFailure
            ? error
            : new RpcRequestFailure("RPC transport failed", {
                category: "transport",
                cause: error,
                endpointUrl: endpoint.url,
                method,
              });
        if (
          options.immediateFailureCategories?.has(failure.category) === true
        ) {
          throw failure;
        }
        lastFailure = failure;
        if (attempt === this.#policy.maxRetriesPerEndpoint) break;
        const delayMs =
          failure.retryAfterMs === undefined
            ? Math.min(100 * (attempt + 1), 1_000)
            : Math.min(failure.retryAfterMs, MAX_RETRY_DELAY_MS);
        await this.#sleep(delayMs, options.signal);
      }
    }
    if (lastFailure === undefined) {
      throw new RpcRequestFailure("RPC request failed without an error", {
        category: "rpc",
        endpointUrl: endpoint.url,
        method,
      });
    }
    throw lastFailure;
  }

  #orderedAvailableEndpoints(
    preferredEndpointIdentity: string | undefined,
  ): readonly RpcEndpoint[] {
    const available = this.#endpoints.filter((endpoint) =>
      endpoint.isAvailable(this.#now()),
    );
    if (preferredEndpointIdentity === undefined) return available;
    return [...available].sort((left, right) => {
      if (left.identity === preferredEndpointIdentity) return -1;
      if (right.identity === preferredEndpointIdentity) return 1;
      return 0;
    });
  }
}

export function toHexQuantity(value: bigint): Hex {
  if (value < 0n) throw new RangeError("RPC quantity must be non-negative");
  return `0x${value.toString(16)}`;
}

export function parseHexQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new TypeError("RPC quantity must be a hexadecimal string");
  }
  return BigInt(value);
}

function parseBlockHeader(
  value: unknown,
  expectedBlockNumber: bigint,
): RpcBlockHeader {
  const record = assertRecord(value, "block header");
  const number = parseHexQuantity(record.number);
  if (number !== expectedBlockNumber) {
    throw new TypeError("RPC block header number does not match the request");
  }
  return Object.freeze({
    hash: assertHexBytes(record.hash, "block hash", 32),
    number,
    parentHash: assertHexBytes(record.parentHash, "parent block hash", 32),
  });
}

function parseRpcLogs(value: unknown): readonly RpcLog[] {
  if (!Array.isArray(value))
    throw new TypeError("RPC logs result must be an array");
  if (value.length > MAX_LOG_ENTRIES) {
    throw new TypeError(
      `RPC logs result exceeds the maximum allowed entries of ${MAX_LOG_ENTRIES}`,
    );
  }
  return Object.freeze(
    value.map((logValue) => {
      const log = assertRecord(logValue, "event log");
      if (!Array.isArray(log.topics)) {
        throw new TypeError("RPC log topics must be an array");
      }
      if (log.topics.length > MAX_LOG_TOPICS) {
        throw new TypeError(
          `RPC log must not contain more than ${MAX_LOG_TOPICS} topics`,
        );
      }
      const address = assertHexBytes(log.address, "log address", 20);
      if (!isAddress(address, { strict: false })) {
        throw new TypeError("RPC log address must be a 20-byte EVM address");
      }
      if (typeof log.removed !== "boolean") {
        throw new TypeError("RPC log removed flag must be boolean");
      }
      return Object.freeze({
        address,
        blockHash: assertHexBytes(log.blockHash, "log block hash", 32),
        blockNumber: parseHexQuantity(log.blockNumber),
        data: assertHexData(log.data, "log data", MAX_LOG_DATA_BYTES),
        logIndex: parseRpcIndex(log.logIndex, "log index"),
        removed: log.removed,
        topics: Object.freeze(
          log.topics.map((topic) => assertHexBytes(topic, "log topic", 32)),
        ),
        transactionHash: assertHexBytes(
          log.transactionHash,
          "transaction hash",
          32,
        ),
        transactionIndex: parseRpcIndex(
          log.transactionIndex,
          "transaction index",
        ),
      });
    }),
  );
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`RPC ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertHexBytes(
  value: unknown,
  label: string,
  byteLength: number,
): Hex {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-f]+$/i.test(value) ||
    value.length !== 2 + byteLength * 2
  ) {
    throw new TypeError(`RPC ${label} must be ${byteLength} hexadecimal bytes`);
  }
  return value.toLowerCase() as Hex;
}

function assertHexData(
  value: unknown,
  label: string,
  maxByteLength?: number,
): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(value)) {
    throw new TypeError(`RPC ${label} must contain complete hexadecimal bytes`);
  }
  if (maxByteLength !== undefined && (value.length - 2) / 2 > maxByteLength) {
    throw new TypeError(
      `RPC ${label} exceeds the maximum allowed length of ${maxByteLength} bytes`,
    );
  }
  return value.toLowerCase() as Hex;
}

function parseRpcIndex(value: unknown, label: string): number {
  const parsed = parseHexQuantity(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`RPC ${label} exceeds the safe integer range`);
  }
  return Number(parsed);
}

async function sleepWithCancellation(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted === true) {
    throw new OperationCancelledError("RPC retry wait was cancelled");
  }
  await new Promise<void>((resolve, reject) => {
    const cancel = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      reject(new OperationCancelledError("RPC retry wait was cancelled"));
    };
    const complete = (): void => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const timeout = setTimeout(complete, milliseconds);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
