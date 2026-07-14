import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HttpEvmRpcClient,
  OperationCancelledError,
  RpcRequestFailure,
} from "../../src/index.js";

describe("HttpEvmRpcClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns JSON-RPC results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ id: 1, jsonrpc: "2.0", result: "0x1" }),
            {
              status: 200,
            },
          ),
        ),
      ),
    );

    await expect(
      new HttpEvmRpcClient().request({
        endpointUrl: "https://rpc.example",
        method: "eth_chainId",
        params: [],
        requestTimeoutMs: 1_000,
      }),
    ).resolves.toBe("0x1");
  });

  it("classifies HTTP and JSON-RPC failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("rate limit", { status: 429 }))),
    );
    await expect(
      new HttpEvmRpcClient().request({
        endpointUrl: "https://rpc.example",
        method: "eth_getLogs",
        params: [],
        requestTimeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ category: "rate_limit" });

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: -32_005,
                message: "query returned too many results",
              },
              id: 1,
              jsonrpc: "2.0",
            }),
            { status: 200 },
          ),
        ),
      ),
    );
    await expect(
      new HttpEvmRpcClient().request({
        endpointUrl: "https://rpc.example",
        method: "eth_getLogs",
        params: [],
        requestTimeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ category: "range_limit" });
  });

  it("distinguishes caller cancellation", async () => {
    const abortController = new AbortController();
    abortController.abort();
    await expect(
      new HttpEvmRpcClient().request({
        endpointUrl: "https://rpc.example",
        method: "eth_blockNumber",
        params: [],
        requestTimeoutMs: 1_000,
        signal: abortController.signal,
      }),
    ).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("rejects invalid JSON payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("not-json", { status: 200 }))),
    );
    await expect(
      new HttpEvmRpcClient().request({
        endpointUrl: "https://rpc.example",
        method: "eth_blockNumber",
        params: [],
        requestTimeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(RpcRequestFailure);
  });
});
