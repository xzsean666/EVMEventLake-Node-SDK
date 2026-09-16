import { createHash } from "node:crypto";

import {
  EVMEventLakeError,
  type EVMEventLakeErrorOptions,
} from "../errors/evm-event-lake-errors.js";
import { redactUrl } from "../configuration/validate-sdk-options.js";

export type RpcFailureCategory =
  | "cancelled"
  | "invalid_response"
  | "range_limit"
  | "rate_limit"
  | "rpc"
  | "server"
  | "timeout"
  | "transport";

export interface RpcRequestFailureOptions extends EVMEventLakeErrorOptions {
  readonly category: RpcFailureCategory;
  readonly endpointUrl: string;
  readonly method: string;
  readonly retryAfterMs?: number;
  readonly rpcCode?: number;
  readonly statusCode?: number;
}

export class RpcRequestFailure extends EVMEventLakeError {
  public readonly category: RpcFailureCategory;
  public readonly endpointIdentity: string;
  public readonly endpointUrl: string;
  public readonly method: string;
  public readonly retryAfterMs: number | undefined;
  public readonly rpcCode: number | undefined;
  public readonly statusCode: number | undefined;

  public constructor(message: string, options: RpcRequestFailureOptions) {
    const safeEndpointUrl = redactUrl(options.endpointUrl);
    super("RPC_REQUEST_FAILED", message, {
      cause: options.cause,
      context: {
        category: options.category,
        endpointUrl: safeEndpointUrl,
        method: options.method,
        ...(options.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: options.retryAfterMs }),
        ...(options.rpcCode === undefined ? {} : { rpcCode: options.rpcCode }),
        ...(options.statusCode === undefined
          ? {}
          : { statusCode: options.statusCode }),
      },
    });
    this.category = options.category;
    this.endpointIdentity = createRpcEndpointIdentity(options.endpointUrl);
    this.endpointUrl = safeEndpointUrl;
    this.method = options.method;
    this.retryAfterMs = options.retryAfterMs;
    this.rpcCode = options.rpcCode;
    this.statusCode = options.statusCode;
  }
}

export function createRpcEndpointIdentity(endpointUrl: string): string {
  return createHash("sha256").update(endpointUrl).digest("hex");
}

export interface RpcFailureClassificationInput {
  readonly message: string;
  readonly method: string;
  readonly rpcCode?: number;
  readonly statusCode?: number;
}

export function classifyRpcFailure(
  input: RpcFailureClassificationInput,
): RpcFailureCategory {
  const normalizedMessage = input.message.toLowerCase();

  if (
    input.statusCode === 429 ||
    containsAny(normalizedMessage, RATE_LIMIT_TEXT)
  ) {
    return "rate_limit";
  }
  if (
    input.method === "eth_getLogs" &&
    containsAny(normalizedMessage, RANGE_LIMIT_TEXT)
  ) {
    return "range_limit";
  }
  if (containsAny(normalizedMessage, TIMEOUT_TEXT)) {
    return "timeout";
  }
  if (input.rpcCode !== undefined && FATAL_JSON_RPC_CODES.has(input.rpcCode)) {
    return "invalid_response";
  }
  if (input.statusCode !== undefined && input.statusCode >= 500) {
    return "server";
  }
  if (input.statusCode !== undefined && input.statusCode >= 400) {
    return "invalid_response";
  }
  return "rpc";
}

function containsAny(message: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => message.includes(candidate));
}

// Standard JSON-RPC 2.0 error codes for malformed requests: parse error,
// invalid request, method not found, invalid params. These are permanently
// fatal for the given request and never resolved by retrying.
const FATAL_JSON_RPC_CODES = new Set([-32700, -32600, -32601, -32602]);

const RANGE_LIMIT_TEXT = [
  "block range",
  "exceed maximum block range",
  "limit the query",
  "log response size exceeded",
  "more than",
  "query returned",
  "response size",
  "too many results",
] as const;

const RATE_LIMIT_TEXT = [
  "rate limit",
  "rate-limit",
  "request limit",
  "too many requests",
] as const;

const TIMEOUT_TEXT = [
  "context deadline exceeded",
  "deadline exceeded",
  "request timeout",
  "timed out",
  "timeout",
] as const;

export function isRpcBatchRejection(error: unknown): boolean {
  if (!(error instanceof RpcRequestFailure)) {
    return false;
  }
  if (
    error.statusCode === 405 ||
    error.statusCode === 413 ||
    error.statusCode === 422 ||
    error.statusCode === 501
  ) {
    return true;
  }
  const normalized = error.message.toLowerCase();
  if (
    normalized.includes("payload too large") ||
    normalized.includes("request entity too large") ||
    normalized.includes("entity too large")
  ) {
    return true;
  }
  if (
    normalized.includes("batch") &&
    (normalized.includes("not support") ||
      normalized.includes("not allowed") ||
      normalized.includes("disabled") ||
      normalized.includes("disallowed") ||
      normalized.includes("unsupported") ||
      normalized.includes("exceed") ||
      normalized.includes("limit") ||
      normalized.includes("invalid") ||
      normalized.includes("forbidden") ||
      normalized.includes("rejected") ||
      normalized.includes("too large"))
  ) {
    return true;
  }
  if (error.method === "batch") {
    if (
      error.statusCode === 400 ||
      error.rpcCode === -32600 ||
      error.rpcCode === -32601
    ) {
      return true;
    }
  }
  return false;
}
