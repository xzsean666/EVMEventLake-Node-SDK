import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { encodeEventTopics, type Hex } from "viem";

import { EVMEventLake, QueryValidationError } from "../../src/index.js";
import { createSqliteStorageAdapter } from "../../src/storage/sqlite/sqlite-storage-adapter.js";
import {
  decodeQueryCursor,
  encodeQueryCursor,
} from "../../src/query/query-cursor.js";
import {
  createRpcEndpointIdentity,
  isRpcBatchRejection,
  RpcRequestFailure,
} from "../../src/rpc/rpc-error-classifier.js";
import { EventQueryService } from "../../src/query/event-query-service.js";
import { EventCatalog } from "../../src/abi/event-catalog.js";
import { encodeDecodedValue } from "../../src/abi/decoded-value-codec.js";
import type { StoredEventLog } from "../../src/storage/storage-models.js";
import type { StorageAdapter } from "../../src/storage/storage-adapter.js";
import type { RpcTransport } from "../../src/rpc/evm-rpc-client.js";

interface MockJsonRpcRequest {
  readonly id: number;
  readonly jsonrpc: string;
  readonly method: string;
  readonly params?: readonly unknown[];
}

const testAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, name: "owner", type: "address" }],
    name: "OwnershipTransferred",
    type: "event",
  },
] as const;

describe("Audit Hardening & Remediations (TASK-011)", () => {
  it("SqlStorageAdapter handles 2500+ logs without SQLite variable overflow", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "lake-audit-sql-"));
    const dbPath = join(tempDir, "test.db");
    const storage = createSqliteStorageAdapter(dbPath);

    try {
      await storage.initialize();
      const targetKey = "1:0x0000000000000000000000000000000000000001";
      await storage.registerTarget({
        abiFingerprint: "test-fp",
        canonicalAbiJson: "[]",
        target: {
          chainId: 1,
          contractAddress: "0x0000000000000000000000000000000000000001",
          startBlock: 100n,
          targetKey,
        },
      });

      // Generate 2,500 logs with parameters (2,500 * 17 = 42,500 variables)
      const logs: StoredEventLog[] = [];
      for (let i = 0; i < 2500; i++) {
        const hexIndex = i.toString(16).padStart(4, "0");
        const blockHash: Hex = `0x${"aa".repeat(30)}${hexIndex}`;
        const transactionHash: Hex = `0x${"bb".repeat(30)}${hexIndex}`;
        logs.push({
          abiFingerprint: "test-fp",
          blockHash,
          blockNumber: 100n + BigInt(Math.floor(i / 10)),
          contractAddress: "0x0000000000000000000000000000000000000001",
          data: "0x",
          decodeStatus: "decoded",
          decodedArguments: encodeDecodedValue({
            from: "0x1111",
            to: "0x2222",
            value: BigInt(i),
          }),
          eventId: `event-${i}`,
          eventName: "Transfer",
          eventSignature: "Transfer(address,address,uint256)",
          logIndex: i % 10,
          parameters: [
            {
              comparableValue: "0x1111",
              indexed: true,
              name: "from",
              position: 0,
              rawTopicValue: null,
              solidityType: "address",
              value: "0x1111",
            },
            {
              comparableValue: "0x2222",
              indexed: true,
              name: "to",
              position: 1,
              rawTopicValue: null,
              solidityType: "address",
              value: "0x2222",
            },
            {
              comparableValue: i.toString().padStart(78, "0"),
              indexed: false,
              name: "value",
              position: 2,
              rawTopicValue: null,
              solidityType: "uint256",
              value: BigInt(i),
            },
          ],
          removed: false,
          targetKey,
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          ],
          transactionHash,
          transactionIndex: i % 5,
        });
      }

      // Should commit smoothly in chunks without throwing SQLite too many variables error
      const endBlockHash: Hex = `0x${"ee".repeat(32)}`;
      const commitResult = await storage.commitRange({
        abiFingerprint: "test-fp",
        endBlockHash,
        fromBlock: 100n,
        logs,
        targetKey,
        toBlock: 350n,
      });

      expect(commitResult.insertedLogs).toBe(2500);

      // Verify queryEvents works across chunked parameter retrieval
      const queried = await storage.queryEvents({
        limit: 10,
        order: "ascending",
        targetKey,
      });
      expect(queried.length).toBe(10);
      expect(queried[0]?.parameters.length).toBe(3);
    } finally {
      await storage.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("query cursor encodes and decodes deterministically without Buffer", () => {
    const original = {
      cursor: {
        blockNumber: 12345678901234567890n,
        eventId: "test-event-uuid-001",
        logIndex: 42,
        transactionIndex: 17,
      },
      order: "descending" as const,
      targetKey: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    };

    const encoded = encodeQueryCursor(original);
    expect(typeof encoded).toBe("string");
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");

    const decoded = decodeQueryCursor({
      cursor: encoded,
      order: "descending",
      targetKey: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    });

    expect(decoded.blockNumber).toBe(12345678901234567890n);
    expect(decoded.eventId).toBe("test-event-uuid-001");
    expect(decoded.logIndex).toBe(42);
    expect(decoded.transactionIndex).toBe(17);
  });

  it("isRpcBatchRejection identifies HTTP 413, 422, and payload limit responses", () => {
    const error413 = new RpcRequestFailure("Request Entity Too Large", {
      category: "server",
      endpointUrl: "https://rpc.example.com",
      method: "batch",
      statusCode: 413,
    });
    expect(isRpcBatchRejection(error413)).toBe(true);

    const error422 = new RpcRequestFailure("Unprocessable Entity", {
      category: "invalid_response",
      endpointUrl: "https://rpc.example.com",
      method: "batch",
      statusCode: 422,
    });
    expect(isRpcBatchRejection(error422)).toBe(true);

    const payloadTooLargeError = new RpcRequestFailure(
      "Query returned error: payload too large",
      {
        category: "rpc",
        endpointUrl: "https://rpc.example.com",
        method: "eth_getLogs",
      },
    );
    expect(isRpcBatchRejection(payloadTooLargeError)).toBe(true);

    const normalError = new RpcRequestFailure("Internal server error", {
      category: "server",
      endpointUrl: "https://rpc.example.com",
      method: "eth_getLogs",
      statusCode: 500,
    });
    expect(isRpcBatchRejection(normalError)).toBe(false);
  });

  it("EventQueryService rejects empty strings for integer types and invalid hex for bytes", async () => {
    const catalog = new EventCatalog(testAbi);
    const mockStorage = {
      queryEvents: () => Promise.resolve([]),
    } as unknown as StorageAdapter;

    const queryService = new EventQueryService({
      catalog,
      storage: mockStorage,
      target: {
        chainId: 1,
        contractAddress: "0x0000000000000000000000000000000000000001",
        startBlock: 1n,
        targetKey: "1:0x0000000000000000000000000000000000000001",
      },
    });

    // Empty string for unindexed integer
    await expect(
      queryService.findMany({
        where: {
          eventName: "Transfer",
          unindexedParameters: {
            value: "",
          },
        },
      }),
    ).rejects.toThrow(QueryValidationError);

    // Whitespace string for unindexed integer
    await expect(
      queryService.findMany({
        where: {
          eventName: "Transfer",
          unindexedParameters: {
            value: "   ",
          },
        },
      }),
    ).rejects.toThrow(QueryValidationError);

    // Invalid hex string starting with 0x for dynamic bytes
    const bytesAbi = [
      {
        anonymous: false,
        inputs: [{ indexed: true, name: "data", type: "bytes" }],
        name: "DataLogged",
        type: "event",
      },
    ] as const;

    const bytesQueryService = new EventQueryService({
      catalog: new EventCatalog(bytesAbi),
      storage: mockStorage,
      target: {
        chainId: 1,
        contractAddress: "0x0000000000000000000000000000000000000001",
        startBlock: 1n,
        targetKey: "1:0x0000000000000000000000000000000000000001",
      },
    });

    await expect(
      bytesQueryService.findMany({
        where: {
          eventName: "DataLogged",
          indexedParameters: {
            data: "0xnotvalidhex!",
          },
        },
      }),
    ).rejects.toThrow(QueryValidationError);
  });

  it("redecode updates updateService catalog so subsequent update decodes newly added events", async () => {
    const v1Abi = [
      {
        anonymous: false,
        inputs: [
          { indexed: true, name: "from", type: "address" },
          { indexed: true, name: "to", type: "address" },
          { indexed: false, name: "value", type: "uint256" },
        ],
        name: "Transfer",
        type: "event",
      },
    ] as const;

    const v2Abi = [
      ...v1Abi,
      {
        anonymous: false,
        inputs: [{ indexed: true, name: "implementation", type: "address" }],
        name: "Upgraded",
        type: "event",
      },
    ] as const;

    const contractAddress = "0x0000000000000000000000000000000000000010";
    const tempDir = await mkdtemp(join(tmpdir(), "lake-redecode-sync-"));
    const dbPath = join(tempDir, "test.db");

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        const json = JSON.parse(body) as MockJsonRpcRequest;
        if (json.method === "eth_chainId") {
          res.end(
            JSON.stringify({ id: json.id, jsonrpc: "2.0", result: "0x1" }),
          );
          return;
        }
        if (json.method === "eth_blockNumber") {
          res.end(
            JSON.stringify({ id: json.id, jsonrpc: "2.0", result: "0x14" }),
          ); // block 20
          return;
        }
        if (json.method === "eth_getBlockByNumber") {
          const blockHex = json.params?.[0] as string;
          res.end(
            JSON.stringify({
              id: json.id,
              jsonrpc: "2.0",
              result: {
                hash: "0x00000000000000000000000000000000000000000000000000000000000000aa",
                number: blockHex,
                parentHash:
                  "0x0000000000000000000000000000000000000000000000000000000000000099",
              },
            }),
          );
          return;
        }
        if (json.method === "eth_getLogs") {
          const upgradedTopics = encodeEventTopics({
            abi: v2Abi,
            eventName: "Upgraded",
            args: {
              implementation: "0x0000000000000000000000000000000000000099",
            },
          });
          res.end(
            JSON.stringify({
              id: json.id,
              jsonrpc: "2.0",
              result: [
                {
                  address: contractAddress,
                  blockHash:
                    "0x00000000000000000000000000000000000000000000000000000000000000aa",
                  blockNumber: "0x14",
                  data: "0x",
                  logIndex: "0x0",
                  removed: false,
                  topics: upgradedTopics,
                  transactionHash:
                    "0x00000000000000000000000000000000000000000000000000000000000000bb",
                  transactionIndex: "0x0",
                },
              ],
            }),
          );
          return;
        }
        res.end(JSON.stringify({ id: json.id, jsonrpc: "2.0", result: null }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    const rpcUrl = `http://127.0.0.1:${address.port}`;

    try {
      const lake = await EVMEventLake.create({
        abi: v1Abi,
        chainId: 1,
        contractAddress,
        database: `sqlite://${dbPath}`,
        rpcUrls: [rpcUrl],
        startBlock: 20n,
      });

      // Initially, redecode with v2Abi so catalog is upgraded
      await lake.redecode({ abi: v2Abi });

      // Now run lake.update(). It should use the updated catalog to decode the Upgraded event!
      const updateResult = await lake.update({ toBlock: 20n });
      expect(updateResult.outcome).toBe("synchronized");
      expect(updateResult.decodedLogs).toBe(1);
      expect(updateResult.unknownLogs).toBe(0);

      const queried = await lake.events.findMany({
        where: { eventName: "Upgraded" },
      });
      expect(queried.items.length).toBe(1);
      expect(queried.items[0]?.eventName).toBe("Upgraded");
      expect(queried.items[0]?.decodeStatus).toBe("decoded");

      await lake.close();
    } finally {
      server.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("RpcPool routes around excludeEndpointIdentity when alternatives exist", async () => {
    const requestedUrls: string[] = [];
    const mockTransport: RpcTransport = {
      request: (input) => {
        requestedUrls.push(input.endpointUrl);
        if (input.method === "eth_chainId") return Promise.resolve("0x1");
        if (input.method === "eth_getBlockByNumber") {
          return Promise.resolve({
            hash: "0x00000000000000000000000000000000000000000000000000000000000000aa",
            number: "0x1",
            parentHash:
              "0x0000000000000000000000000000000000000000000000000000000000000009",
          });
        }
        return Promise.resolve(null);
      },
      requestBatch: () => Promise.resolve([]),
    };

    const { RpcPool } = await import("../../src/rpc/rpc-pool.js");
    const pool = new RpcPool(
      1,
      ["https://rpc1.example.com", "https://rpc2.example.com"],
      {
        batchSize: 10,
        endpointCooldownMs: 1000,
        maximumTimeoutSplitsPerRange: 2,
        maxRetriesPerEndpoint: 1,
        requestTimeoutMs: 1000,
      },
      { transport: mockTransport },
    );

    // Get block header excluding rpc1
    const rpc1Identity = createRpcEndpointIdentity("https://rpc1.example.com");
    await pool.getBlockHeader(1n, { excludeEndpointIdentity: rpc1Identity });

    // Must have routed to rpc2
    expect(requestedUrls).toContain("https://rpc2.example.com");
  });

  it("sync filters out removed: true logs returned by RPC nodes during reorgs", async () => {
    const contractAddress = "0x0000000000000000000000000000000000000020";
    const tempDir = await mkdtemp(join(tmpdir(), "lake-reorg-removed-"));
    const dbPath = join(tempDir, "test.db");

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        const json = JSON.parse(body) as MockJsonRpcRequest;
        if (json.method === "eth_chainId") {
          res.end(
            JSON.stringify({ id: json.id, jsonrpc: "2.0", result: "0x1" }),
          );
          return;
        }
        if (json.method === "eth_blockNumber") {
          res.end(
            JSON.stringify({ id: json.id, jsonrpc: "2.0", result: "0x1e" }),
          ); // block 30
          return;
        }
        if (json.method === "eth_getBlockByNumber") {
          const blockHex = json.params?.[0] as string;
          res.end(
            JSON.stringify({
              id: json.id,
              jsonrpc: "2.0",
              result: {
                hash: "0x00000000000000000000000000000000000000000000000000000000000000aa",
                number: blockHex,
                parentHash:
                  "0x0000000000000000000000000000000000000000000000000000000000000099",
              },
            }),
          );
          return;
        }
        if (json.method === "eth_getLogs") {
          const topics = encodeEventTopics({
            abi: testAbi,
            eventName: "Transfer",
            args: {
              from: "0x0000000000000000000000000000000000000001",
              to: "0x0000000000000000000000000000000000000002",
            },
          });
          res.end(
            JSON.stringify({
              id: json.id,
              jsonrpc: "2.0",
              result: [
                // Valid log
                {
                  address: contractAddress,
                  blockHash:
                    "0x00000000000000000000000000000000000000000000000000000000000000aa",
                  blockNumber: "0x1e",
                  data: "0x0000000000000000000000000000000000000000000000000000000000000064",
                  logIndex: "0x0",
                  removed: false,
                  topics,
                  transactionHash:
                    "0x00000000000000000000000000000000000000000000000000000000000000bb",
                  transactionIndex: "0x0",
                },
                // Orphaned/reorged log with removed: true
                {
                  address: contractAddress,
                  blockHash:
                    "0x00000000000000000000000000000000000000000000000000000000000000aa",
                  blockNumber: "0x1e",
                  data: "0x0000000000000000000000000000000000000000000000000000000000000064",
                  logIndex: "0x1",
                  removed: true,
                  topics,
                  transactionHash:
                    "0x00000000000000000000000000000000000000000000000000000000000000cc",
                  transactionIndex: "0x1",
                },
              ],
            }),
          );
          return;
        }
        res.end(JSON.stringify({ id: json.id, jsonrpc: "2.0", result: null }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    const rpcUrl = `http://127.0.0.1:${address.port}`;

    try {
      const lake = await EVMEventLake.create({
        abi: testAbi,
        chainId: 1,
        contractAddress,
        database: `sqlite://${dbPath}`,
        rpcUrls: [rpcUrl],
        startBlock: 30n,
      });

      const updateResult = await lake.update({ toBlock: 30n });
      expect(updateResult.outcome).toBe("synchronized");
      expect(updateResult.storedLogs).toBe(1); // Only 1 stored, removed: true ignored

      const queried = await lake.events.findMany();
      expect(queried.items.length).toBe(1);
      expect(queried.items[0]?.logIndex).toBe(0);

      await lake.close();
    } finally {
      server.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("IndexeddbStorageAdapter filters removed logs and performs keyset pagination", async () => {
    const { createIndexeddbStorageAdapter } =
      await import("../../src/storage/indexeddb/indexeddb-storage-adapter.js");
    const dbName = `test-idb-audit-${Date.now()}`;
    const storage = createIndexeddbStorageAdapter(dbName);

    try {
      await storage.initialize();
      const targetKey = "1:0x0000000000000000000000000000000000000001";
      await storage.registerTarget({
        abiFingerprint: "test-fp",
        canonicalAbiJson: "[]",
        target: {
          chainId: 1,
          contractAddress: "0x0000000000000000000000000000000000000001",
          startBlock: 1n,
          targetKey,
        },
      });

      const hash1: Hex =
        "0x0000000000000000000000000000000000000000000000000000000000000001";
      const hash2: Hex =
        "0x0000000000000000000000000000000000000000000000000000000000000002";
      const hash3: Hex =
        "0x0000000000000000000000000000000000000000000000000000000000000003";
      const txHashA: Hex =
        "0x00000000000000000000000000000000000000000000000000000000000000aa";
      const txHashB: Hex =
        "0x00000000000000000000000000000000000000000000000000000000000000bb";
      const txHashC: Hex =
        "0x00000000000000000000000000000000000000000000000000000000000000cc";

      const logs: StoredEventLog[] = [
        {
          abiFingerprint: "test-fp",
          blockHash: hash1,
          blockNumber: 1n,
          contractAddress: "0x0000000000000000000000000000000000000001",
          data: "0x",
          decodeStatus: "decoded",
          decodedArguments: encodeDecodedValue({ value: 100n }),
          eventId: "event-1",
          eventName: "Transfer",
          eventSignature: "Transfer(address,address,uint256)",
          logIndex: 0,
          parameters: [],
          removed: false,
          targetKey,
          topics: [],
          transactionHash: txHashA,
          transactionIndex: 0,
        },
        {
          abiFingerprint: "test-fp",
          blockHash: hash2,
          blockNumber: 2n,
          contractAddress: "0x0000000000000000000000000000000000000001",
          data: "0x",
          decodeStatus: "decoded",
          decodedArguments: encodeDecodedValue({ value: 200n }),
          eventId: "event-2-removed",
          eventName: "Transfer",
          eventSignature: "Transfer(address,address,uint256)",
          logIndex: 0,
          parameters: [],
          removed: true, // removed!
          targetKey,
          topics: [],
          transactionHash: txHashB,
          transactionIndex: 0,
        },
        {
          abiFingerprint: "test-fp",
          blockHash: hash3,
          blockNumber: 3n,
          contractAddress: "0x0000000000000000000000000000000000000001",
          data: "0x",
          decodeStatus: "decoded",
          decodedArguments: encodeDecodedValue({ value: 300n }),
          eventId: "event-3",
          eventName: "Transfer",
          eventSignature: "Transfer(address,address,uint256)",
          logIndex: 0,
          parameters: [],
          removed: false,
          targetKey,
          topics: [],
          transactionHash: txHashC,
          transactionIndex: 0,
        },
      ];

      await storage.commitRange({
        abiFingerprint: "test-fp",
        endBlockHash: hash3,
        fromBlock: 1n,
        logs,
        targetKey,
        toBlock: 3n,
      });

      // Query all events - removed log must NOT be present
      const allEvents = await storage.queryEvents({
        limit: 10,
        order: "ascending",
        targetKey,
      });
      expect(allEvents.length).toBe(2);
      expect(allEvents.map((e) => e.eventId)).toEqual(["event-1", "event-3"]);

      // Keyset pagination: query with after pointing to event-1
      const paged = await storage.queryEvents({
        after: {
          blockNumber: 1n,
          eventId: "event-1",
          logIndex: 0,
          transactionIndex: 0,
        },
        limit: 10,
        order: "ascending",
        targetKey,
      });
      expect(paged.length).toBe(1);
      expect(paged[0]?.eventId).toBe("event-3");
    } finally {
      await storage.close();
    }
  });
});
