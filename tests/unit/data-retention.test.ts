import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { describe, expect, it } from "vitest";
import { encodeEventTopics, parseAbi } from "viem";

import {
  ConfigurationValidationError,
  EVMEventLake,
  normalizeDataRetention,
} from "../support/internal-exports.js";

const TEST_ABI = parseAbi([
  "event ValueChanged(address indexed owner, uint256 value)",
]);

describe("Data Retention & Pruning", () => {
  describe("normalizeDataRetention", () => {
    it("defaults to enabled: false when omitted or null", () => {
      expect(normalizeDataRetention(undefined)).toEqual({ enabled: false });
      expect(normalizeDataRetention(null as unknown as undefined)).toEqual({
        enabled: false,
      });
      expect(normalizeDataRetention({})).toEqual({ enabled: false });
      expect(normalizeDataRetention({ enabled: false })).toEqual({
        enabled: false,
      });
    });

    it("normalizes valid retention configuration when enabled: true", () => {
      const normalized = normalizeDataRetention({
        enabled: true,
        maxBlocks: 100n,
        maxEvents: 500,
        pruneOnUpdate: true,
      });
      expect(normalized).toEqual({
        enabled: true,
        maxBlocks: 100n,
        maxEvents: 500,
        pruneOnUpdate: true,
      });
    });

    it("throws on non-object retention", () => {
      expect(() =>
        normalizeDataRetention("true" as unknown as undefined),
      ).toThrow(ConfigurationValidationError);
    });

    it("throws on non-positive maxBlocks", () => {
      expect(() =>
        normalizeDataRetention({ enabled: true, maxBlocks: 0n }),
      ).toThrow(ConfigurationValidationError);
    });
  });

  describe("EVMEventLake integration with retention", () => {
    it("retention is disabled by default and lake.prune() works on-demand", async () => {
      const server = createServer(
        (req: IncomingMessage, res: ServerResponse) => {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString("utf8");
          });
          req.on("end", () => {
            const json = JSON.parse(body) as {
              id: number;
              method: string;
              params?: unknown[];
            };
            if (json.method === "eth_chainId") {
              res.end(
                JSON.stringify({ id: json.id, jsonrpc: "2.0", result: "0x1" }),
              );
              return;
            }
            if (json.method === "eth_blockNumber") {
              res.end(
                JSON.stringify({ id: json.id, jsonrpc: "2.0", result: "0x64" }),
              ); // 100
              return;
            }
            if (json.method === "eth_getBlockByNumber") {
              res.end(
                JSON.stringify({
                  id: json.id,
                  jsonrpc: "2.0",
                  result: {
                    hash: "0x00000000000000000000000000000000000000000000000000000000000000aa",
                    number: "0x64",
                    parentHash:
                      "0x0000000000000000000000000000000000000000000000000000000000000099",
                  },
                }),
              );
              return;
            }
            if (json.method === "eth_getLogs") {
              res.end(
                JSON.stringify({ id: json.id, jsonrpc: "2.0", result: [] }),
              );
              return;
            }
            res.end(
              JSON.stringify({ id: json.id, jsonrpc: "2.0", result: null }),
            );
          });
        },
      );

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address() as { port: number };
      const rpcUrl = `http://127.0.0.1:${address.port}`;

      const lake = await EVMEventLake.create({
        abi: TEST_ABI,
        chainId: 1,
        contractAddress: "0x1111111111111111111111111111111111111111",
        database: "sqlite://:memory:",
        rpcUrls: [rpcUrl],
        startBlock: 100n,
      });

      try {
        // Without retention enabled, lake.update() does not prune
        const updateResult = await lake.update({ toBlock: 100n });
        expect(updateResult.prunedLogs).toBeUndefined();

        // Calling lake.prune() without options when retention is disabled returns 0
        const pruneResult1 = await lake.prune();
        expect(pruneResult1.prunedLogs).toBe(0);

        // Calling lake.prune() with explicit options executes on-demand
        const pruneResult2 = await lake.prune({
          maxBlocks: 10n,
          maxEvents: 100,
        });
        expect(pruneResult2.prunedLogs).toBe(0);
      } finally {
        await lake.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("automatically prunes on update when retention.enabled is true", async () => {
      const contractAddress = "0x1111111111111111111111111111111111111111";
      const eventTopics = encodeEventTopics({
        abi: TEST_ABI,
        eventName: "ValueChanged",
        args: {
          owner: "0x0000000000000000000000000000000000000001",
        },
      });

      const server = createServer(
        (req: IncomingMessage, res: ServerResponse) => {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString("utf8");
          });
          req.on("end", () => {
            const json = JSON.parse(body) as {
              id: number;
              method: string;
              params?: unknown[];
            };
            if (json.method === "eth_chainId") {
              res.end(
                JSON.stringify({ id: json.id, jsonrpc: "2.0", result: "0x1" }),
              );
              return;
            }
            if (json.method === "eth_blockNumber") {
              res.end(
                JSON.stringify({ id: json.id, jsonrpc: "2.0", result: "0x6e" }),
              ); // 110
              return;
            }
            if (json.method === "eth_getBlockByNumber") {
              const blockHex = (json.params?.[0] as string) || "0x6e";
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
              res.end(
                JSON.stringify({
                  id: json.id,
                  jsonrpc: "2.0",
                  result: [
                    {
                      address: contractAddress,
                      blockHash:
                        "0x00000000000000000000000000000000000000000000000000000000000000aa",
                      blockNumber: "0x64", // block 100
                      data: "0x000000000000000000000000000000000000000000000000000000000000000a",
                      logIndex: "0x0",
                      removed: false,
                      topics: eventTopics,
                      transactionHash:
                        "0x00000000000000000000000000000000000000000000000000000000000000bb",
                      transactionIndex: "0x0",
                    },
                  ],
                }),
              );
              return;
            }
            res.end(
              JSON.stringify({ id: json.id, jsonrpc: "2.0", result: null }),
            );
          });
        },
      );

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address() as { port: number };
      const rpcUrl = `http://127.0.0.1:${address.port}`;

      // Configured with retention: { enabled: true, maxBlocks: 5n }
      const lake = await EVMEventLake.create({
        abi: TEST_ABI,
        chainId: 1,
        contractAddress,
        database: "sqlite://:memory:",
        retention: {
          enabled: true,
          maxBlocks: 5n,
        },
        rpcUrls: [rpcUrl],
        startBlock: 100n,
      });

      try {
        // We sync through block 110. The event was at block 100.
        // nextBlock will be 111.
        // nextBlock (111) - maxBlocks (5) = 106.
        // Events before block 106 (i.e. block 100) will be pruned!
        const updateResult = await lake.update({ toBlock: 110n });
        expect(updateResult.storedLogs).toBe(1);
        expect(updateResult.prunedLogs).toBe(1);

        // Verify that block 100 event was pruned
        const remaining = await lake.events.findMany();
        expect(remaining.items).toHaveLength(0);
      } finally {
        await lake.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });
});
