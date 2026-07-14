import { describe, expect, it } from "vitest";

import {
  EventCatalog,
  EventQueryService,
  QueryValidationError,
  createContractTarget,
  type StorageAdapter,
} from "../support/internal-exports.js";

const catalog = new EventCatalog([
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "value", type: "uint8" },
      { indexed: true, name: "tag", type: "bytes4" },
      { indexed: true, name: "label", type: "string" },
    ],
    name: "IndexedValues",
    type: "event",
  },
]);
const target = createContractTarget({
  chainId: 1,
  contractAddress: "0x0000000000000000000000000000000000000010",
  startBlock: 0n,
});
const storage = {
  queryEvents: () => Promise.resolve([]),
} as unknown as StorageAdapter;
const queryService = new EventQueryService({ catalog, storage, target });

describe("indexed query value validation", () => {
  it("enforces integer width, fixed bytes length, and dynamic topic hashes", async () => {
    await expect(
      queryService.findMany({
        where: {
          eventName: "IndexedValues",
          indexedParameters: { value: 256 },
        },
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);
    await expect(
      queryService.findMany({
        where: {
          eventName: "IndexedValues",
          indexedParameters: { tag: "0x01" },
        },
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);
    await expect(
      queryService.findMany({
        where: {
          eventName: "IndexedValues",
          indexedParameters: { label: "plain text" },
        },
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);
  });

  it("accepts ABI-valid indexed values", async () => {
    await expect(
      queryService.findMany({
        where: {
          eventName: "IndexedValues",
          indexedParameters: {
            label: `0x${"11".repeat(32)}`,
            tag: "0x01020304",
            value: 255,
          },
        },
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });
});
