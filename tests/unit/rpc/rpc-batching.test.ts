import { describe, expect, it } from "vitest";
import type { Address } from "viem";

import {
  AdaptiveLogFetcher,
  DEFAULT_RPC_POLICY,
  isRpcBatchRejection,
  RpcPool,
  RpcRequestFailure,
  type RpcBatchTransportRequest,
  type RpcBatchItemResult,
  type RpcTransport,
  type RpcTransportRequest,
} from "../../support/internal-exports.js";

const dummyAddress = "0x0000000000000000000000000000000000000001" as Address;

class BatchMockTransport implements RpcTransport {
  public batchCalls: RpcBatchTransportRequest[] = [];
  public singleCalls: RpcTransportRequest[] = [];
  readonly #batchHandler:
    | ((
        request: RpcBatchTransportRequest,
      ) => Promise<readonly RpcBatchItemResult[]>)
    | undefined;
  readonly #singleHandler:
    ((request: RpcTransportRequest) => unknown) | undefined;

  public constructor(options: {
    readonly onBatch?: (
      request: RpcBatchTransportRequest,
    ) => Promise<readonly RpcBatchItemResult[]>;
    readonly onSingle?: (request: RpcTransportRequest) => unknown;
  }) {
    this.#batchHandler = options.onBatch;
    this.#singleHandler = options.onSingle;
  }

  public request(request: RpcTransportRequest): Promise<unknown> {
    this.singleCalls.push(request);
    if (this.#singleHandler !== undefined) {
      return Promise.resolve(this.#singleHandler(request));
    }
    if (request.method === "eth_chainId") return Promise.resolve("0x1");
    if (request.method === "eth_getLogs") return Promise.resolve([]);
    return Promise.resolve(null);
  }

  public requestBatch(
    request: RpcBatchTransportRequest,
  ): Promise<readonly RpcBatchItemResult[]> {
    this.batchCalls.push(request);
    if (this.#batchHandler !== undefined) {
      return this.#batchHandler(request);
    }
    return Promise.resolve(
      request.requests.map(() => ({
        ok: true,
        result: [],
      })),
    );
  }
}

describe("RPC Batch Requesting & Classification", () => {
  describe("isRpcBatchRejection", () => {
    it("identifies HTTP 405 and 501 as batch rejection", () => {
      const err405 = new RpcRequestFailure("Method not allowed", {
        category: "invalid_response",
        endpointUrl: "https://rpc.example",
        method: "batch",
        statusCode: 405,
      });
      expect(isRpcBatchRejection(err405)).toBe(true);

      const err501 = new RpcRequestFailure("Not implemented", {
        category: "server",
        endpointUrl: "https://rpc.example",
        method: "batch",
        statusCode: 501,
      });
      expect(isRpcBatchRejection(err501)).toBe(true);
    });

    it("identifies batch rejection error messages", () => {
      const messages = [
        "Batch requests are not supported by this endpoint",
        "JSON-RPC batching is disabled",
        "Batch size exceeds maximum limit of 10",
        "Batch request disallowed",
        "Endpoint does not support batch calls",
      ];
      for (const message of messages) {
        const err = new RpcRequestFailure(message, {
          category: "rpc",
          endpointUrl: "https://rpc.example",
          method: "eth_getLogs",
          rpcCode: -32600,
        });
        expect(isRpcBatchRejection(err)).toBe(true);
      }
    });

    it("does not treat normal range_limit or timeout as batch rejection", () => {
      const rangeErr = new RpcRequestFailure(
        "query returned more than 10000 results",
        {
          category: "range_limit",
          endpointUrl: "https://rpc.example",
          method: "eth_getLogs",
        },
      );
      expect(isRpcBatchRejection(rangeErr)).toBe(false);

      const timeoutErr = new RpcRequestFailure("request timed out", {
        category: "timeout",
        endpointUrl: "https://rpc.example",
        method: "eth_getLogs",
      });
      expect(isRpcBatchRejection(timeoutErr)).toBe(false);
    });
  });

  describe("RpcPool.fetchLogsBatch", () => {
    it("groups multiple log requests into a single batch when batchSize > 1", async () => {
      const transport = new BatchMockTransport({});
      const pool = new RpcPool(
        1,
        ["https://rpc.example"],
        { ...DEFAULT_RPC_POLICY, batchSize: 5 },
        { transport },
      );

      const ranges = [
        { fromBlock: 100n, toBlock: 199n },
        { fromBlock: 200n, toBlock: 299n },
        { fromBlock: 300n, toBlock: 399n },
      ];

      const result = await pool.fetchLogsBatch(dummyAddress, ranges);

      expect(transport.batchCalls).toHaveLength(1);
      expect(transport.batchCalls[0]?.requests).toHaveLength(3);
      expect(result.items).toHaveLength(3);
      expect(result.items[0]?.fromBlock).toBe(100n);
      expect(result.items[1]?.fromBlock).toBe(200n);
      expect(result.items[2]?.fromBlock).toBe(300n);
      // 1 request for eth_chainId validation + 1 batch request
      expect(pool.getMetrics().requestCount).toBe(2);
    });

    it("falls back to sequential single-requests when endpoint rejects batching", async () => {
      let batchAttempted = false;
      const transport = new BatchMockTransport({
        onBatch: (request) => {
          batchAttempted = true;
          throw new RpcRequestFailure("Batch requests not allowed", {
            category: "invalid_response",
            endpointUrl: request.endpointUrl,
            method: "batch",
            statusCode: 400,
          });
        },
        onSingle: (request) => {
          if (request.method === "eth_chainId") return "0x1";
          if (request.method === "eth_getLogs") return [];
          return null;
        },
      });

      const pool = new RpcPool(
        1,
        ["https://rpc.example"],
        { ...DEFAULT_RPC_POLICY, batchSize: 3 },
        { transport },
      );

      const ranges = [
        { fromBlock: 10n, toBlock: 19n },
        { fromBlock: 20n, toBlock: 29n },
      ];

      const result = await pool.fetchLogsBatch(dummyAddress, ranges);

      expect(batchAttempted).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(
        transport.singleCalls.filter((c) => c.method === "eth_getLogs"),
      ).toHaveLength(2);

      // Subsequent batch requests should skip batching directly because endpoint.batchSupported is now false
      transport.batchCalls.length = 0;
      await pool.fetchLogsBatch(dummyAddress, ranges);
      expect(transport.batchCalls).toHaveLength(0);
    });

    it("unpacks item-level range_limit error from batch response", async () => {
      const transport = new BatchMockTransport({
        onBatch: () =>
          Promise.resolve([
            { ok: true, result: [] },
            {
              error: new RpcRequestFailure(
                "query returned more than 10000 results",
                {
                  category: "range_limit",
                  endpointUrl: "https://rpc.example",
                  method: "eth_getLogs",
                },
              ),
              ok: false,
            },
          ]),
      });

      const pool = new RpcPool(
        1,
        ["https://rpc.example"],
        { ...DEFAULT_RPC_POLICY, batchSize: 2 },
        { transport },
      );

      const ranges = [
        { fromBlock: 1n, toBlock: 100n },
        { fromBlock: 101n, toBlock: 200n },
      ];

      await expect(
        pool.fetchLogsBatch(dummyAddress, ranges),
      ).rejects.toMatchObject({
        category: "range_limit",
      });
    });
  });

  describe("AdaptiveLogFetcher with batching", () => {
    it("decomposes batch into single fetches upon batch error and splits on range_limit", async () => {
      let batchCalled = false;
      const singleCalls: { fromBlock: bigint; toBlock: bigint }[] = [];

      const rpc = {
        cooldownEndpoint: () => {},
        fetchLogs: (_address: Address, fromBlock: bigint, toBlock: bigint) => {
          singleCalls.push({ fromBlock, toBlock });
          if (fromBlock === 200n && toBlock === 299n) {
            // Simulate range_limit on range 200..299
            throw new RpcRequestFailure("too many results", {
              category: "range_limit",
              endpointUrl: "https://rpc.example",
              method: "eth_getLogs",
            });
          }
          return Promise.resolve({
            endpointIdentity: "endpoint-1",
            endpointUrl: "https://rpc.example",
            logs: [],
          });
        },
        fetchLogsBatch: () => {
          batchCalled = true;
          // Batch fails partially or completely
          throw new RpcRequestFailure("batch failed", {
            category: "range_limit",
            endpointUrl: "https://rpc.example",
            method: "eth_getLogs",
          });
        },
      };

      const fetcher = new AdaptiveLogFetcher({
        contractAddress: dummyAddress,
        maximumTimeoutSplitsPerRange: 2,
        minimumBlockRange: 1,
        rpc,
      });

      const ranges = [
        { fromBlock: 100n, toBlock: 199n },
        { fromBlock: 200n, toBlock: 299n },
      ];

      const yieldedRanges: { fromBlock: bigint; toBlock: bigint }[] = [];
      for await (const fetched of fetcher.fetchRanges(ranges)) {
        yieldedRanges.push(fetched.range);
      }

      expect(batchCalled).toBe(true);
      // Range 100..199 succeeded as single
      // Range 200..299 failed and was split into 200..249 and 250..299
      expect(yieldedRanges).toEqual([
        { fromBlock: 100n, toBlock: 199n },
        { fromBlock: 200n, toBlock: 249n },
        { fromBlock: 250n, toBlock: 299n },
      ]);
      expect(fetcher.getMetrics().rangeSplits).toBe(1);
    });
  });
});
