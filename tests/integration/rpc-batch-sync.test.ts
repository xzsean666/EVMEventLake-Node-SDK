import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import { EVMEventLake } from "../../src/index.js";

const abi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "ValueChanged",
    type: "event",
  },
] as const;

const contractAddress = "0x0000000000000000000000000000000000000010";
const topic0 = encodeEventTopics({ abi, eventName: "ValueChanged" })[0];

function hex32(value: number): Hex {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function toHexQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}`;
}

interface JsonRpcPayloadItem {
  id: number;
  method: string;
  params: unknown[];
}

async function handleBatchServer(
  request: IncomingMessage,
  response: ServerResponse,
  stats: { batchRequestCount: number; singleRequestCount: number },
): Promise<void> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  const parsed = JSON.parse(body) as unknown;

  if (Array.isArray(parsed)) {
    stats.batchRequestCount += 1;
    const responses = (parsed as JsonRpcPayloadItem[]).map((item) => {
      if (item.method === "eth_getLogs") {
        const filter = item.params[0] as {
          fromBlock: string;
          toBlock: string;
        };
        const from = BigInt(filter.fromBlock);
        const to = BigInt(filter.toBlock);
        const logs = [];
        for (let b = from; b <= to; b += 1n) {
          if (b % 50n === 0n) {
            logs.push({
              address: contractAddress,
              blockHash: hex32(Number(b)),
              blockNumber: toHexQuantity(b),
              data: encodeAbiParameters([{ type: "uint256" }], [b * 10n]),
              logIndex: "0x0",
              removed: false,
              topics: [
                topic0,
                "0x0000000000000000000000000000000000000000000000000000000000000001",
              ],
              transactionHash: hex32(Number(b)),
              transactionIndex: "0x0",
            });
          }
        }
        return { id: item.id, jsonrpc: "2.0", result: logs };
      }
      return { id: item.id, jsonrpc: "2.0", result: null };
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(responses));
    return;
  }

  stats.singleRequestCount += 1;
  const single = parsed as JsonRpcPayloadItem;
  if (single.method === "eth_chainId") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ id: single.id, jsonrpc: "2.0", result: "0x1" }),
    );
    return;
  }
  if (single.method === "eth_blockNumber") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ id: single.id, jsonrpc: "2.0", result: "0x1f4" }),
    ); // 500
    return;
  }
  if (single.method === "eth_getBlockByNumber") {
    const blockNum = BigInt(single.params[0] as string);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: single.id,
        jsonrpc: "2.0",
        result: {
          hash: hex32(Number(blockNum)),
          number: toHexQuantity(blockNum),
          parentHash: hex32(Number(blockNum - 1n)),
        },
      }),
    );
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ id: single.id, jsonrpc: "2.0", result: null }));
}

async function handleFallbackServer(
  request: IncomingMessage,
  response: ServerResponse,
  stats: { singleRequestCount: number },
): Promise<void> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  const parsed = JSON.parse(body) as unknown;

  if (Array.isArray(parsed)) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: { code: -32600, message: "JSON-RPC batching is disabled" },
        id: null,
        jsonrpc: "2.0",
      }),
    );
    return;
  }

  stats.singleRequestCount += 1;
  const single = parsed as JsonRpcPayloadItem;
  if (single.method === "eth_chainId") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ id: single.id, jsonrpc: "2.0", result: "0x1" }),
    );
    return;
  }
  if (single.method === "eth_blockNumber") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ id: single.id, jsonrpc: "2.0", result: "0xc8" }),
    ); // 200
    return;
  }
  if (single.method === "eth_getBlockByNumber") {
    const blockNum = BigInt(single.params[0] as string);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: single.id,
        jsonrpc: "2.0",
        result: {
          hash: hex32(Number(blockNum)),
          number: toHexQuantity(blockNum),
          parentHash: hex32(Number(blockNum - 1n)),
        },
      }),
    );
    return;
  }
  if (single.method === "eth_getLogs") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ id: single.id, jsonrpc: "2.0", result: [] }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ id: single.id, jsonrpc: "2.0", result: null }));
}

describe("RPC batch synchronization HTTP end-to-end", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((dir) => rm(dir, { force: true, recursive: true })),
    );
  });

  it("synchronizes contiguous ranges in batches over HTTP and commits sequentially", async () => {
    const stats = { batchRequestCount: 0, singleRequestCount: 0 };
    const server = createServer((request, response) => {
      void handleBatchServer(request, response, stats);
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address !== null && typeof address === "object") {
          resolve(address.port);
        }
      });
    });
    const baseUrl = `http://127.0.0.1:${port}`;

    const directory = await mkdtemp(join(tmpdir(), "lake-batch-http-"));
    directories.push(directory);

    const client = await EVMEventLake.create({
      abi,
      chainId: 1,
      contractAddress,
      database: `sqlite://${join(directory, "events.db")}`,
      rpc: { batchSize: 5 },
      rpcUrls: [baseUrl],
      startBlock: 100n,
      synchronization: {
        confirmations: 0,
        defaultBlockRange: 50,
        reorgCheckDepth: 5,
      },
    });

    try {
      const result = await client.update({ toBlock: 300n });
      expect(result.outcome).toBe("synchronized");
      expect(result.fromBlock).toBe(100n);
      expect(result.toBlock).toBe(300n);

      expect(stats.batchRequestCount).toBeGreaterThan(0);
      expect(stats.singleRequestCount).toBeGreaterThan(0);

      const page = await client.events.findMany();
      expect(page.items.length).toBeGreaterThan(0);

      const status = await client.getSyncStatus();
      expect(status.nextBlock).toBe(301n);
      expect(status.syncedThroughBlock).toBe(300n);
    } finally {
      await client.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it("gracefully falls back to sequential single-requests when server rejects batching", async () => {
    const stats = { singleRequestCount: 0 };
    const server = createServer((request, response) => {
      void handleFallbackServer(request, response, stats);
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address !== null && typeof address === "object") {
          resolve(address.port);
        }
      });
    });
    const baseUrl = `http://127.0.0.1:${port}`;

    const directory = await mkdtemp(join(tmpdir(), "lake-fallback-http-"));
    directories.push(directory);

    const client = await EVMEventLake.create({
      abi,
      chainId: 1,
      contractAddress,
      database: `sqlite://${join(directory, "events.db")}`,
      rpc: { batchSize: 4 },
      rpcUrls: [baseUrl],
      startBlock: 100n,
      synchronization: {
        confirmations: 0,
        defaultBlockRange: 25,
        reorgCheckDepth: 5,
      },
    });

    try {
      const result = await client.update({ toBlock: 200n });
      expect(result.outcome).toBe("synchronized");
      expect(result.toBlock).toBe(200n);

      expect(stats.singleRequestCount).toBeGreaterThan(0);

      const status = await client.getSyncStatus();
      expect(status.nextBlock).toBe(201n);
      expect(status.syncedThroughBlock).toBe(200n);
    } finally {
      await client.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
