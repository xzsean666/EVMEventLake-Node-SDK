import { describe, expect, it } from "vitest";

import {
  DEFAULT_RPC_POLICY,
  NoValidRpcEndpointError,
  RpcPool,
  RpcRequestFailure,
  type RpcTransport,
  type RpcTransportRequest,
} from "../../src/index.js";

class FakeRpcTransport implements RpcTransport {
  public readonly requests: RpcTransportRequest[] = [];
  readonly #handler: (request: RpcTransportRequest) => unknown;

  public constructor(handler: (request: RpcTransportRequest) => unknown) {
    this.#handler = handler;
  }

  public request(request: RpcTransportRequest): Promise<unknown> {
    this.requests.push(request);
    return Promise.resolve(this.#handler(request));
  }
}

describe("RpcPool", () => {
  it("rejects a mismatched chain endpoint and fails over deterministically", async () => {
    const transport = new FakeRpcTransport((request) => {
      if (request.method === "eth_chainId") {
        return request.endpointUrl.includes("wrong") ? "0x2" : "0x1";
      }
      return "0x64";
    });
    const pool = createPool(
      ["https://wrong.example", "https://good.example"],
      transport,
    );

    await expect(pool.getBlockNumber()).resolves.toBe(100n);
    expect(
      transport.requests.some(
        (request) =>
          request.endpointUrl.includes("wrong") &&
          request.method === "eth_blockNumber",
      ),
    ).toBe(false);
    expect(pool.getMetrics().endpointFailovers).toBe(1);
  });

  it("retries endpoint failures and then fails over", async () => {
    const transport = new FakeRpcTransport((request) => {
      if (request.method === "eth_chainId") return "0x1";
      if (request.endpointUrl.includes("first")) {
        throw new RpcRequestFailure("server failed", {
          category: "server",
          endpointUrl: request.endpointUrl,
          method: request.method,
        });
      }
      return "0x10";
    });
    const pool = createPool(
      ["https://first.example", "https://second.example"],
      transport,
    );

    await expect(pool.getBlockNumber()).resolves.toBe(16n);
    expect(
      transport.requests.filter(
        (request) =>
          request.endpointUrl.includes("first") &&
          request.method === "eth_blockNumber",
      ),
    ).toHaveLength(DEFAULT_RPC_POLICY.maxRetriesPerEndpoint + 1);
  });

  it("returns range and timeout failures immediately to the adaptive fetcher", async () => {
    const failureCategory = {
      current: "range_limit" as "range_limit" | "timeout",
    };
    const transport = new FakeRpcTransport((request) => {
      if (request.method === "eth_chainId") return "0x1";
      throw new RpcRequestFailure("logs failed", {
        category: failureCategory.current,
        endpointUrl: request.endpointUrl,
        method: request.method,
      });
    });
    const pool = createPool(["https://rpc.example"], transport);

    await expect(
      pool.fetchLogs("0x0000000000000000000000000000000000000001", 1n, 100n),
    ).rejects.toMatchObject({ category: "range_limit" });
    failureCategory.current = "timeout";
    await expect(
      pool.fetchLogs("0x0000000000000000000000000000000000000001", 1n, 50n),
    ).rejects.toMatchObject({ category: "timeout" });
  });

  it("reports no valid endpoint when every endpoint is cooling down", async () => {
    const transport = new FakeRpcTransport(() => "0x1");
    const pool = createPool(["https://rpc.example"], transport);
    pool.cooldownEndpoint("https://rpc.example");
    await expect(pool.getBlockNumber()).rejects.toBeInstanceOf(
      NoValidRpcEndpointError,
    );
  });

  it("returns a safe endpoint identity without exposing URL credentials", async () => {
    const transport = new FakeRpcTransport((request) => {
      if (request.method === "eth_chainId") return "0x1";
      return [];
    });
    const pool = createPool(
      ["https://user:secret@rpc.example/path?apiKey=secret"],
      transport,
    );

    const result = await pool.fetchLogs(
      "0x0000000000000000000000000000000000000001",
      1n,
      1n,
    );
    expect(result.endpointUrl).toBe("https://rpc.example/path");
    expect(result.endpointIdentity).toMatch(/^[0-9a-f]{64}$/);
    pool.cooldownEndpoint(result.endpointIdentity);
    await expect(pool.getBlockNumber()).rejects.toBeInstanceOf(
      NoValidRpcEndpointError,
    );
  });
});

function createPool(
  rpcUrls: readonly string[],
  transport: RpcTransport,
): RpcPool {
  return new RpcPool(1, rpcUrls, DEFAULT_RPC_POLICY, {
    sleep: () => Promise.resolve(),
    transport,
  });
}
