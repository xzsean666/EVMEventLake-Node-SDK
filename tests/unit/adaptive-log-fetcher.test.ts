import type { Address } from "viem";
import { describe, expect, it } from "vitest";

import {
  AdaptiveLogFetcher,
  NoValidRpcEndpointError,
  RpcRequestFailure,
  UnfetchableBlockError,
  createRpcEndpointIdentity,
  type AdaptiveLogRpcClient,
  type RpcLogsResult,
} from "../../src/index.js";

const contractAddress = "0x0000000000000000000000000000000000000001" as Address;

class FakeAdaptiveRpc implements AdaptiveLogRpcClient {
  public readonly calls: { fromBlock: bigint; toBlock: bigint }[] = [];
  public readonly cooledEndpoints: string[] = [];
  readonly #handler: (
    fromBlock: bigint,
    toBlock: bigint,
  ) => RpcLogsResult | Promise<RpcLogsResult>;

  public constructor(
    handler: (
      fromBlock: bigint,
      toBlock: bigint,
    ) => RpcLogsResult | Promise<RpcLogsResult>,
  ) {
    this.#handler = handler;
  }

  public cooldownEndpoint(endpointReference: string): void {
    this.cooledEndpoints.push(endpointReference);
  }

  public async fetchLogs(
    _contractAddress: Address,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RpcLogsResult> {
    this.calls.push({ fromBlock, toBlock });
    return this.#handler(fromBlock, toBlock);
  }
}

describe("AdaptiveLogFetcher", () => {
  it("splits range-limit failures and yields successful leaves in order", async () => {
    const endpointUrl = "https://rpc.example";
    const endpointIdentity = createRpcEndpointIdentity(endpointUrl);
    const rpc = new FakeAdaptiveRpc((fromBlock, toBlock) => {
      if (toBlock - fromBlock + 1n > 2n) {
        throw new RpcRequestFailure("too many results", {
          category: "range_limit",
          endpointUrl,
          method: "eth_getLogs",
        });
      }
      return { endpointIdentity, endpointUrl, logs: [] };
    });
    const fetcher = new AdaptiveLogFetcher({
      contractAddress,
      maximumTimeoutSplitsPerRange: 2,
      minimumBlockRange: 1,
      rpc,
    });

    const leaves = [];
    for await (const leaf of fetcher.fetch({ fromBlock: 1n, toBlock: 4n })) {
      leaves.push(leaf.range);
    }
    expect(leaves).toEqual([
      { fromBlock: 1n, toBlock: 2n },
      { fromBlock: 3n, toBlock: 4n },
    ]);
    expect(fetcher.getMetrics().rangeSplits).toBe(1);
  });

  it("bounds timeout splitting and cools down the exhausted endpoint", async () => {
    const endpointUrl = "https://rpc.example";
    const endpointIdentity = createRpcEndpointIdentity(endpointUrl);
    let attempts = 0;
    const rpc = new FakeAdaptiveRpc(() => {
      attempts += 1;
      if (attempts <= 2) {
        throw new RpcRequestFailure("timeout", {
          category: "timeout",
          endpointUrl,
          method: "eth_getLogs",
        });
      }
      throw new NoValidRpcEndpointError("none");
    });
    const fetcher = new AdaptiveLogFetcher({
      contractAddress,
      maximumTimeoutSplitsPerRange: 1,
      minimumBlockRange: 1,
      rpc,
    });

    await expect(async () => {
      for await (const leaf of fetcher.fetch({ fromBlock: 1n, toBlock: 4n })) {
        throw new Error(`Unexpected leaf ${leaf.range.fromBlock.toString()}`);
      }
    }).rejects.toBeInstanceOf(UnfetchableBlockError);
    expect(rpc.cooledEndpoints).toContain(endpointIdentity);
    expect(fetcher.getMetrics().rangeSplits).toBe(1);
  });
});
