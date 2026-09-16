import { keccak256, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";

import {
  EventCatalog,
  EventQueryService,
  QueryValidationError,
  createContractTarget,
  encodeDecodedValue,
  type StorageAdapter,
  type StoredEventQuery,
} from "../../support/internal-exports.js";

const abi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "string" },
      { indexed: true, name: "code", type: "bytes" },
      { indexed: true, name: "arrayTag", type: "uint256[]" },
      { indexed: false, name: "counter", type: "uint256" },
      { indexed: false, name: "sender", type: "address" },
      { indexed: false, name: "active", type: "bool" },
      { indexed: false, name: "description", type: "string" },
      { indexed: false, name: "rawData", type: "bytes" },
    ],
    name: "ComplexEvent",
    type: "event",
  },
] as const;

const catalog = new EventCatalog(abi);
const target = createContractTarget({
  chainId: 1,
  contractAddress: "0x0000000000000000000000000000000000000010",
  startBlock: 0n,
});

describe("Dynamic Indexed and Unindexed Parameter Query Validation", () => {
  it("automatically hashes plaintext string for dynamic indexed parameter", async () => {
    const captured: StoredEventQuery[] = [];
    const storage = {
      queryEvents: (q: StoredEventQuery) => {
        captured.push(q);
        return Promise.resolve([]);
      },
    } as unknown as StorageAdapter;

    const queryService = new EventQueryService({ catalog, storage, target });
    await queryService.findMany({
      where: {
        eventName: "ComplexEvent",
        indexedParameters: {
          user: "Alice",
        },
      },
    });

    const expectedHash = keccak256(stringToBytes("Alice")).toLowerCase();
    expect(captured[0]?.indexedParameters).toEqual([
      {
        comparableValue: encodeDecodedValue(expectedHash),
        name: "user",
      },
    ]);
  });

  it("preserves direct 32-byte topic hash for dynamic indexed parameter", async () => {
    const captured: StoredEventQuery[] = [];
    const storage = {
      queryEvents: (q: StoredEventQuery) => {
        captured.push(q);
        return Promise.resolve([]);
      },
    } as unknown as StorageAdapter;

    const queryService = new EventQueryService({ catalog, storage, target });
    const directHash = `0x${"ab".repeat(32)}`.toLowerCase();

    await queryService.findMany({
      where: {
        eventName: "ComplexEvent",
        indexedParameters: {
          user: directHash,
        },
      },
    });

    expect(captured[0]?.indexedParameters).toEqual([
      {
        comparableValue: encodeDecodedValue(directHash),
        name: "user",
      },
    ]);
  });

  it("automatically hashes hex and Uint8Array for dynamic indexed bytes parameter", async () => {
    const captured: StoredEventQuery[] = [];
    const storage = {
      queryEvents: (q: StoredEventQuery) => {
        captured.push(q);
        return Promise.resolve([]);
      },
    } as unknown as StorageAdapter;

    const queryService = new EventQueryService({ catalog, storage, target });

    // Hex string
    await queryService.findMany({
      where: {
        eventName: "ComplexEvent",
        indexedParameters: {
          code: "0x123456",
        },
      },
    });
    const expectedHexHash = keccak256("0x123456").toLowerCase();
    expect(captured[0]?.indexedParameters).toEqual([
      {
        comparableValue: encodeDecodedValue(expectedHexHash),
        name: "code",
      },
    ]);

    // Uint8Array
    const bytesArray = new Uint8Array([1, 2, 3]);
    await queryService.findMany({
      where: {
        eventName: "ComplexEvent",
        indexedParameters: {
          code: bytesArray,
        },
      },
    });
    const expectedArrayHash = keccak256(bytesArray).toLowerCase();
    expect(captured[1]?.indexedParameters).toEqual([
      {
        comparableValue: encodeDecodedValue(expectedArrayHash),
        name: "code",
      },
    ]);
  });

  it("requires 32-byte topic hash for complex indexed types like arrays/tuples", async () => {
    const storage = {
      queryEvents: () => Promise.resolve([]),
    } as unknown as StorageAdapter;
    const queryService = new EventQueryService({ catalog, storage, target });

    await expect(
      queryService.findMany({
        where: {
          eventName: "ComplexEvent",
          indexedParameters: {
            arrayTag: "not-a-32-byte-hash",
          },
        },
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);

    const validHash = `0x${"22".repeat(32)}`;
    await expect(
      queryService.findMany({
        where: {
          eventName: "ComplexEvent",
          indexedParameters: {
            arrayTag: validHash,
          },
        },
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
  });

  it("normalizes unindexed parameters (address, integer, bool, string, bytes)", async () => {
    const captured: StoredEventQuery[] = [];
    const storage = {
      queryEvents: (q: StoredEventQuery) => {
        captured.push(q);
        return Promise.resolve([]);
      },
    } as unknown as StorageAdapter;

    const queryService = new EventQueryService({ catalog, storage, target });

    await queryService.findMany({
      where: {
        eventName: "ComplexEvent",
        unindexedParameters: {
          active: true,
          counter: 42n,
          description: "A non-indexed note",
          rawData: "0xabcdef",
          sender: "0x0000000000000000000000000000000000000002",
        },
      },
    });

    expect(captured[0]?.unindexedParameters).toEqual([
      {
        comparableValue: encodeDecodedValue(true),
        name: "active",
      },
      {
        comparableValue: encodeDecodedValue(42n),
        name: "counter",
      },
      {
        comparableValue: encodeDecodedValue("A non-indexed note"),
        name: "description",
      },
      {
        comparableValue: encodeDecodedValue("0xabcdef"),
        name: "rawData",
      },
      {
        comparableValue: encodeDecodedValue(
          "0x0000000000000000000000000000000000000002",
        ),
        name: "sender",
      },
    ]);
  });

  it("rejects invalid unindexed parameter values and missing names", async () => {
    const storage = {
      queryEvents: () => Promise.resolve([]),
    } as unknown as StorageAdapter;
    const queryService = new EventQueryService({ catalog, storage, target });

    // Missing parameter name in ABI
    await expect(
      queryService.findMany({
        where: {
          eventName: "ComplexEvent",
          unindexedParameters: {
            nonExistent: 123,
          },
        },
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);

    // Empty parameter name
    await expect(
      queryService.findMany({
        where: {
          eventName: "ComplexEvent",
          unindexedParameters: {
            "": 123,
          },
        },
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);

    // Invalid unindexed address
    await expect(
      queryService.findMany({
        where: {
          eventName: "ComplexEvent",
          unindexedParameters: {
            sender: "not-an-address",
          },
        },
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);

    // Invalid unindexed bool
    await expect(
      queryService.findMany({
        where: {
          eventName: "ComplexEvent",
          unindexedParameters: {
            active: "yes",
          },
        },
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);

    // Invalid unindexed string
    await expect(
      queryService.findMany({
        where: {
          eventName: "ComplexEvent",
          unindexedParameters: {
            description: 12345,
          },
        },
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);

    // Invalid unindexed bytes (non-hex)
    await expect(
      queryService.findMany({
        where: {
          eventName: "ComplexEvent",
          unindexedParameters: {
            rawData: "invalid-hex",
          },
        },
      }),
    ).rejects.toBeInstanceOf(QueryValidationError);
  });
});
