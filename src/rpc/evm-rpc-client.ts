import { OperationCancelledError } from "../errors/evm-event-lake-errors.js";
import {
  classifyRpcFailure,
  RpcRequestFailure,
} from "./rpc-error-classifier.js";

export interface RpcTransportRequest {
  readonly endpointUrl: string;
  readonly method: string;
  readonly params: readonly unknown[];
  readonly requestTimeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface RpcBatchSubRequest {
  readonly method: string;
  readonly params: readonly unknown[];
}

export interface RpcBatchTransportRequest {
  readonly endpointUrl: string;
  readonly requests: readonly RpcBatchSubRequest[];
  readonly requestTimeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface RpcBatchItemSuccess {
  readonly ok: true;
  readonly result: unknown;
}

export interface RpcBatchItemFailure {
  readonly error: RpcRequestFailure;
  readonly ok: false;
}

export type RpcBatchItemResult = RpcBatchItemSuccess | RpcBatchItemFailure;

export interface RpcTransport {
  request(request: RpcTransportRequest): Promise<unknown>;
  requestBatch?(
    request: RpcBatchTransportRequest,
  ): Promise<readonly RpcBatchItemResult[]>;
}

interface JsonRpcResponse {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
  };
  readonly id?: unknown;
  readonly jsonrpc?: unknown;
  readonly result?: unknown;
}

// Defensive cap on how much of an RPC response body we'll buffer into memory.
// A misbehaving or malicious endpoint could otherwise return an unbounded
// response and exhaust process memory before JSON parsing even starts.
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return response.text();
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const chunk = (await reader.read()) as {
        readonly done: boolean;
        readonly value?: Uint8Array;
      };
      if (chunk.done || chunk.value === undefined) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RpcResponseTooLargeError();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

class RpcResponseTooLargeError extends Error {}

export class HttpEvmRpcClient implements RpcTransport {
  #requestId = 0;

  public async request(request: RpcTransportRequest): Promise<unknown> {
    if (request.signal?.aborted === true) {
      throw new OperationCancelledError(
        "RPC request was cancelled before start",
      );
    }

    const abortController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, request.requestTimeoutMs);
    const cancelFromCaller = (): void => abortController.abort();
    request.signal?.addEventListener("abort", cancelFromCaller, { once: true });

    try {
      this.#requestId += 1;
      const requestId = this.#requestId;
      const response = await fetch(request.endpointUrl, {
        body: JSON.stringify({
          id: requestId,
          jsonrpc: "2.0",
          method: request.method,
          params: request.params,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: abortController.signal,
      });
      const responseText = await readBoundedResponseText(
        response,
        MAX_RESPONSE_BYTES,
      );
      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get("retry-after"),
        );
        throw new RpcRequestFailure(
          `RPC HTTP request failed with status ${response.status}`,
          {
            category: classifyRpcFailure({
              message: responseText || response.statusText,
              method: request.method,
              statusCode: response.status,
            }),
            endpointUrl: request.endpointUrl,
            method: request.method,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            statusCode: response.status,
          },
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(responseText) as unknown;
      } catch (cause) {
        throw new RpcRequestFailure("RPC response is not valid JSON", {
          category: "invalid_response",
          cause,
          endpointUrl: request.endpointUrl,
          method: request.method,
        });
      }
      if (
        payload === null ||
        typeof payload !== "object" ||
        Array.isArray(payload)
      ) {
        throw new RpcRequestFailure("RPC response has an invalid shape", {
          category: "invalid_response",
          endpointUrl: request.endpointUrl,
          method: request.method,
        });
      }

      const rpcResponse = payload as JsonRpcResponse;
      if (rpcResponse.jsonrpc !== "2.0" || rpcResponse.id !== requestId) {
        throw new RpcRequestFailure(
          "RPC response version or request ID does not match",
          {
            category: "invalid_response",
            endpointUrl: request.endpointUrl,
            method: request.method,
          },
        );
      }
      if (rpcResponse.error !== undefined) {
        const message =
          typeof rpcResponse.error.message === "string"
            ? rpcResponse.error.message
            : "RPC returned an error";
        const rpcCode =
          typeof rpcResponse.error.code === "number"
            ? rpcResponse.error.code
            : undefined;
        throw new RpcRequestFailure(message, {
          category: classifyRpcFailure({
            message,
            method: request.method,
            ...(rpcCode === undefined ? {} : { rpcCode }),
          }),
          endpointUrl: request.endpointUrl,
          method: request.method,
          ...(rpcCode === undefined ? {} : { rpcCode }),
        });
      }
      if (!("result" in rpcResponse)) {
        throw new RpcRequestFailure("RPC response is missing result", {
          category: "invalid_response",
          endpointUrl: request.endpointUrl,
          method: request.method,
        });
      }
      return rpcResponse.result;
    } catch (error) {
      if (error instanceof RpcRequestFailure) throw error;
      if (error instanceof RpcResponseTooLargeError) {
        throw new RpcRequestFailure(
          "RPC response exceeded the maximum allowed size",
          {
            category: "invalid_response",
            cause: error,
            endpointUrl: request.endpointUrl,
            method: request.method,
          },
        );
      }
      if (!timedOut && abortController.signal.aborted) {
        throw new OperationCancelledError("RPC request was cancelled", {
          cause: error,
        });
      }
      if (timedOut) {
        throw new RpcRequestFailure("RPC request timed out", {
          category: "timeout",
          cause: error,
          endpointUrl: request.endpointUrl,
          method: request.method,
        });
      }
      throw new RpcRequestFailure("RPC transport request failed", {
        category: "transport",
        cause: error,
        endpointUrl: request.endpointUrl,
        method: request.method,
      });
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", cancelFromCaller);
    }
  }

  public async requestBatch(
    request: RpcBatchTransportRequest,
  ): Promise<readonly RpcBatchItemResult[]> {
    if (request.signal?.aborted === true) {
      throw new OperationCancelledError(
        "RPC batch request was cancelled before start",
      );
    }
    if (request.requests.length === 0) {
      return Object.freeze([]);
    }

    const abortController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, request.requestTimeoutMs);
    const cancelFromCaller = (): void => abortController.abort();
    request.signal?.addEventListener("abort", cancelFromCaller, { once: true });

    try {
      const idToIndex = new Map<number, number>();
      const batchPayload = request.requests.map((subRequest, index) => {
        this.#requestId += 1;
        const id = this.#requestId;
        idToIndex.set(id, index);
        return {
          id,
          jsonrpc: "2.0",
          method: subRequest.method,
          params: subRequest.params,
        };
      });

      const response = await fetch(request.endpointUrl, {
        body: JSON.stringify(batchPayload),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: abortController.signal,
      });

      const responseText = await readBoundedResponseText(
        response,
        MAX_RESPONSE_BYTES,
      );

      if (!response.ok) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get("retry-after"),
        );
        throw new RpcRequestFailure(
          `RPC HTTP batch request failed with status ${response.status}`,
          {
            category: classifyRpcFailure({
              message: responseText || response.statusText,
              method: "batch",
              statusCode: response.status,
            }),
            endpointUrl: request.endpointUrl,
            method: "batch",
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            statusCode: response.status,
          },
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(responseText) as unknown;
      } catch (cause) {
        throw new RpcRequestFailure("RPC response is not valid JSON", {
          category: "invalid_response",
          cause,
          endpointUrl: request.endpointUrl,
          method: "batch",
        });
      }

      if (
        payload !== null &&
        typeof payload === "object" &&
        !Array.isArray(payload)
      ) {
        const singleObj = payload as JsonRpcResponse;
        if (singleObj.error !== undefined) {
          const message =
            typeof singleObj.error.message === "string"
              ? singleObj.error.message
              : "RPC batch returned an error";
          const rpcCode =
            typeof singleObj.error.code === "number"
              ? singleObj.error.code
              : undefined;
          throw new RpcRequestFailure(message, {
            category: classifyRpcFailure({
              message,
              method: "batch",
              ...(rpcCode === undefined ? {} : { rpcCode }),
            }),
            endpointUrl: request.endpointUrl,
            method: "batch",
            ...(rpcCode === undefined ? {} : { rpcCode }),
          });
        }
        throw new RpcRequestFailure("RPC batch response has an invalid shape", {
          category: "invalid_response",
          endpointUrl: request.endpointUrl,
          method: "batch",
        });
      }

      if (!Array.isArray(payload)) {
        throw new RpcRequestFailure("RPC batch response must be an array", {
          category: "invalid_response",
          endpointUrl: request.endpointUrl,
          method: "batch",
        });
      }

      const results: (RpcBatchItemResult | undefined)[] = new Array<
        RpcBatchItemResult | undefined
      >(request.requests.length);

      for (const rawItem of payload) {
        if (
          rawItem === null ||
          typeof rawItem !== "object" ||
          Array.isArray(rawItem)
        ) {
          continue;
        }
        const item = rawItem as JsonRpcResponse;
        const id = typeof item.id === "number" ? item.id : undefined;
        if (id === undefined) continue;
        const index = idToIndex.get(id);
        if (index === undefined) continue;
        const subReq = request.requests[index];
        if (subReq === undefined) continue;

        if (item.error !== undefined) {
          const message =
            typeof item.error.message === "string"
              ? item.error.message
              : "RPC batch item returned an error";
          const rpcCode =
            typeof item.error.code === "number" ? item.error.code : undefined;
          results[index] = {
            error: new RpcRequestFailure(message, {
              category: classifyRpcFailure({
                message,
                method: subReq.method,
                ...(rpcCode === undefined ? {} : { rpcCode }),
              }),
              endpointUrl: request.endpointUrl,
              method: subReq.method,
              ...(rpcCode === undefined ? {} : { rpcCode }),
            }),
            ok: false,
          };
        } else if ("result" in item) {
          results[index] = {
            ok: true,
            result: item.result,
          };
        } else {
          results[index] = {
            error: new RpcRequestFailure("RPC batch item is missing result", {
              category: "invalid_response",
              endpointUrl: request.endpointUrl,
              method: subReq.method,
            }),
            ok: false,
          };
        }
      }

      const finalResults: RpcBatchItemResult[] = results.map((entry, index) => {
        if (entry !== undefined) return entry;
        const subReq = request.requests[index];
        const method = subReq === undefined ? "batch" : subReq.method;
        return {
          error: new RpcRequestFailure("RPC batch item response was omitted", {
            category: "invalid_response",
            endpointUrl: request.endpointUrl,
            method,
          }),
          ok: false,
        };
      });

      return Object.freeze(finalResults);
    } catch (error) {
      if (error instanceof RpcRequestFailure) throw error;
      if (error instanceof RpcResponseTooLargeError) {
        throw new RpcRequestFailure(
          "RPC response exceeded the maximum allowed size",
          {
            category: "invalid_response",
            cause: error,
            endpointUrl: request.endpointUrl,
            method: "batch",
          },
        );
      }
      if (!timedOut && abortController.signal.aborted) {
        throw new OperationCancelledError("RPC batch request was cancelled", {
          cause: error,
        });
      }
      if (timedOut) {
        throw new RpcRequestFailure("RPC batch request timed out", {
          category: "timeout",
          cause: error,
          endpointUrl: request.endpointUrl,
          method: "batch",
        });
      }
      throw new RpcRequestFailure("RPC transport batch request failed", {
        category: "transport",
        cause: error,
        endpointUrl: request.endpointUrl,
        method: "batch",
      });
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", cancelFromCaller);
    }
  }
}

function parseRetryAfter(retryAfter: string | null): number | undefined {
  if (retryAfter === null) return undefined;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const retryDate = Date.parse(retryAfter);
  if (Number.isNaN(retryDate)) return undefined;
  return Math.max(0, retryDate - Date.now());
}
