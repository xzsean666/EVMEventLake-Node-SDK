import { describe, expect, it } from "vitest";

import { RpcRequestFailure, classifyRpcFailure } from "../../src/index.js";

describe("classifyRpcFailure", () => {
  it("distinguishes range, timeout, rate, server, and ordinary RPC failures", () => {
    expect(
      classifyRpcFailure({
        message: "query returned more than 10000 results",
        method: "eth_getLogs",
      }),
    ).toBe("range_limit");
    expect(
      classifyRpcFailure({
        message: "deadline exceeded",
        method: "eth_getLogs",
      }),
    ).toBe("timeout");
    expect(
      classifyRpcFailure({
        message: "Too Many Requests",
        method: "eth_getLogs",
      }),
    ).toBe("rate_limit");
    expect(
      classifyRpcFailure({
        message: "failed",
        method: "eth_call",
        statusCode: 503,
      }),
    ).toBe("server");
    expect(
      classifyRpcFailure({ message: "execution reverted", method: "eth_call" }),
    ).toBe("rpc");
  });

  it("redacts credentials and query secrets in failure context", () => {
    const error = new RpcRequestFailure("failed", {
      category: "transport",
      endpointUrl: "https://user:secret@rpc.example/path?apiKey=secret",
      method: "eth_blockNumber",
    });

    expect(error.endpointUrl).toBe("https://rpc.example/path");
    expect(JSON.stringify(error.context)).not.toContain("secret");
  });
});
