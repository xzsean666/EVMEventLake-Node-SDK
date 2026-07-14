import { describe, expect, it } from "vitest";

import * as publicApi from "../../src/index.js";

describe("package root public API", () => {
  it("exports the client and typed errors without implementation modules", () => {
    expect(publicApi.EVMEventLake).toBeTypeOf("function");
    expect(publicApi.EVMEventLakeError).toBeTypeOf("function");
    expect(publicApi).not.toHaveProperty("RpcPool");
    expect(publicApi).not.toHaveProperty("EventCatalog");
    expect(publicApi).not.toHaveProperty("createStorageAdapter");
    expect(publicApi).not.toHaveProperty("UpdateService");
  });
});
