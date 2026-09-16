import { describe, expect, it } from "vitest";

import * as evmCallSubpath from "../../src/evm-call.js";
import * as publicApi from "../../src/index.js";

describe("evm-call foundation export contract", () => {
  it("exports all evm-call utilities and classes via subpath export", () => {
    expect(evmCallSubpath.EvmCallClient).toBeTypeOf("function");
    expect(evmCallSubpath.createEvmCallClient).toBeTypeOf("function");
    expect(evmCallSubpath.CooldownTracker).toBeTypeOf("function");
    expect(evmCallSubpath.JsonRpcBatchExecutor).toBeTypeOf("function");
    expect(evmCallSubpath.normalizeEvmLog).toBeTypeOf("function");
    expect(evmCallSubpath.sortEvmLogs).toBeTypeOf("function");
    expect(evmCallSubpath.MULTICALL3_ADDRESS).toBeTypeOf("string");
    expect(evmCallSubpath.VERSION).toBeTypeOf("string");
  });

  it("exports EvmCall namespace on root package without polluting root symbols", () => {
    expect(publicApi.EvmCall).toBeDefined();
    expect(publicApi.EvmCall.EvmCallClient).toBeTypeOf("function");
    expect(publicApi.EvmCall.createEvmCallClient).toBeTypeOf("function");
    expect(publicApi.EvmCall.CooldownTracker).toBeTypeOf("function");
    expect(publicApi.EvmCall.MULTICALL3_ADDRESS).toBeTypeOf("string");

    // Root package should not expose evm-call symbols directly at top-level
    expect(publicApi).not.toHaveProperty("RpcPool");
    expect(publicApi).not.toHaveProperty("EvmCallClient");
    expect(publicApi).not.toHaveProperty("CooldownTracker");
    expect(publicApi).not.toHaveProperty("MULTICALL3_ADDRESS");
  });

  it("allows instantiation of foundation clients through both export forms", () => {
    const tracker1 = new evmCallSubpath.CooldownTracker();
    const tracker2 = new publicApi.EvmCall.CooldownTracker();

    expect(tracker1.getState().consecutiveFailures).toBe(0);
    expect(tracker2.getState().consecutiveFailures).toBe(0);
  });
});
