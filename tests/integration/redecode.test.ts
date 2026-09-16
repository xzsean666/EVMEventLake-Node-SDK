import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import "fake-indexeddb/auto";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { afterEach, describe, expect, it } from "vitest";

import {
  ConfigurationValidationError,
  EVMEventLake,
  QueryValidationError,
  SynchronizationLockedError,
  type RedecodeProgress,
} from "../../src/index.js";

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
    inputs: [{ indexed: true, name: "implementation", type: "address" }],
    name: "Upgraded",
    type: "event",
  },
] as const;

const contractAddress = "0x0000000000000000000000000000000000000010";
const newImplementation = "0x0000000000000000000000000000000000000099";

describe("Proxy Contract Historical Re-decoding (TASK-008)", () => {
  const directories: string[] = [];
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await closeServer(server);
    }
    await Promise.all(
      directories
        .splice(0)
        .map(async (directory) =>
          rm(directory, { force: true, recursive: true }),
        ),
    );
  });

  function setupRpcServer(): Promise<string> {
    const server = createServer((request, response) => {
      void handleJsonRpcRequest(request, response);
    });
    servers.push(server);
    return listen(server);
  }

  it("re-decodes historical logs upon ABI upgrade (SQLite)", async () => {
    const baseUrl = await setupRpcServer();
    const directory = await mkdtemp(
      join(tmpdir(), "eventlake-redecode-sqlite-"),
    );
    directories.push(directory);

    const client = await EVMEventLake.create({
      abi: v1Abi,
      chainId: 1,
      contractAddress,
      database: `sqlite://${join(directory, "events.db")}`,
      rpc: { maxRetriesPerEndpoint: 0, requestTimeoutMs: 2_000 },
      rpcUrls: [`${baseUrl}/rpc`],
      startBlock: 100n,
      synchronization: { confirmations: 0, defaultBlockRange: 10 },
    });

    try {
      // 1. Synchronize block 100 with V1 ABI
      const updateResult = await client.update({ toBlock: 100n });
      expect(updateResult.outcome).toBe("synchronized");
      expect(updateResult.storedLogs).toBe(2);

      // Verify V1 state: Transfer is decoded, Upgraded is unknown
      const transfers = await client.events.findMany({
        where: { eventName: "Transfer" },
      });
      expect(transfers.items).toHaveLength(1);
      expect(transfers.items[0]?.decodeStatus).toBe("decoded");

      const unknowns = await client.events.findMany({
        where: { decodeStatus: "unknown" },
      });
      expect(unknowns.items).toHaveLength(1);
      expect(unknowns.items[0]?.eventName).toBeNull();

      // Querying for Upgraded before redecode fails validation because V1 ABI lacks it
      await expect(
        client.events.findMany({ where: { eventName: "Upgraded" } }),
      ).rejects.toThrow(QueryValidationError);

      // 2. Perform redecode with V2 ABI
      const progressUpdates: RedecodeProgress[] = [];
      const redecodeResult = await client.redecode({
        abi: v2Abi,
        onProgress: (progress) => progressUpdates.push(progress),
      });

      expect(redecodeResult.totalLogs).toBe(1);
      expect(redecodeResult.newlyDecodedLogs).toBe(1);
      expect(redecodeResult.failedLogs).toBe(0);
      expect(redecodeResult.unchangedLogs).toBe(0);
      expect(progressUpdates.length).toBeGreaterThan(0);

      // 3. Verify V2 state: Upgraded is now decoded and queryable
      const upgradedEvents = await client.events.findMany({
        where: { eventName: "Upgraded" },
      });
      expect(upgradedEvents.items).toHaveLength(1);
      expect(upgradedEvents.items[0]?.decodeStatus).toBe("decoded");
      expect(upgradedEvents.items[0]?.eventName).toBe("Upgraded");
      expect(upgradedEvents.items[0]?.arguments).toEqual(
        expect.objectContaining({
          implementation: newImplementation,
        }),
      );

      // Parameter index filtering works for the newly decoded event
      const indexedSearch = await client.events.findMany({
        where: {
          eventName: "Upgraded",
          indexedParameters: { implementation: newImplementation },
        },
      });
      expect(indexedSearch.items).toHaveLength(1);

      // Original Transfer event remains decoded and queryable
      const transfersAfter = await client.events.findMany({
        where: { eventName: "Transfer" },
      });
      expect(transfersAfter.items).toHaveLength(1);

      // No unknown logs remain
      const remainingUnknowns = await client.events.findMany({
        where: { decodeStatus: "unknown" },
      });
      expect(remainingUnknowns.items).toHaveLength(0);

      // 4. Test redecodeAll: true
      const redecodeAllResult = await client.redecode({
        abi: v2Abi,
        redecodeAll: true,
      });
      expect(redecodeAllResult.totalLogs).toBe(2);
      expect(redecodeAllResult.unchangedLogs).toBe(2);
      expect(redecodeAllResult.newlyDecodedLogs).toBe(0);
    } finally {
      await client.close();
    }
  });

  it("re-decodes historical logs upon ABI upgrade (IndexedDB)", async () => {
    const baseUrl = await setupRpcServer();
    const idbUrl = `idb://redecode-test-db-${Date.now()}`;

    const client = await EVMEventLake.create({
      abi: v1Abi,
      chainId: 1,
      contractAddress,
      database: idbUrl,
      rpc: { maxRetriesPerEndpoint: 0, requestTimeoutMs: 2_000 },
      rpcUrls: [`${baseUrl}/rpc`],
      startBlock: 100n,
      synchronization: { confirmations: 0, defaultBlockRange: 10 },
    });

    try {
      await client.update({ toBlock: 100n });

      const redecodeResult = await client.redecode({
        abi: v2Abi,
      });

      expect(redecodeResult.totalLogs).toBe(1);
      expect(redecodeResult.newlyDecodedLogs).toBe(1);

      const upgradedEvents = await client.events.findMany({
        where: {
          eventName: "Upgraded",
          indexedParameters: { implementation: newImplementation },
        },
      });
      expect(upgradedEvents.items).toHaveLength(1);
      expect(upgradedEvents.items[0]?.decodeStatus).toBe("decoded");
    } finally {
      await client.close();
    }
  });

  it("enforces validation and locks during redecode", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "eventlake-redecode-validation-"),
    );
    directories.push(directory);

    const client = await EVMEventLake.create({
      abi: v1Abi,
      chainId: 1,
      contractAddress,
      database: `sqlite://${join(directory, "events.db")}`,
      rpcUrls: ["https://127.0.0.1:8545"],
      startBlock: 100n,
    });

    try {
      await expect(
        client.redecode({
          abi: v2Abi,
          fromBlock: 200n,
          toBlock: 100n,
        }),
      ).rejects.toThrow(ConfigurationValidationError);

      await expect(
        client.redecode({
          abi: v2Abi,
          batchSize: 0,
        }),
      ).rejects.toThrow(ConfigurationValidationError);

      // Test concurrent operation lock
      const slowAbort = new AbortController();
      const first = client.redecode({ abi: v2Abi, signal: slowAbort.signal });
      await expect(client.redecode({ abi: v2Abi })).rejects.toThrow(
        SynchronizationLockedError,
      );
      slowAbort.abort();
      await first.catch(() => undefined);
    } finally {
      await client.close();
    }
  });
});

async function handleJsonRpcRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  const rpcRequest = JSON.parse(body) as {
    readonly id: number;
    readonly method: string;
    readonly params: readonly unknown[];
  };

  if (rpcRequest.method === "eth_chainId") {
    respondResult(response, rpcRequest.id, "0x1");
    return;
  }
  if (rpcRequest.method === "eth_getBlockByNumber") {
    const blockNumber = BigInt(rpcRequest.params[0] as string);
    respondResult(response, rpcRequest.id, {
      hash: hex32(Number(blockNumber)),
      number: `0x${blockNumber.toString(16)}`,
      parentHash: hex32(Number(blockNumber - 1n)),
    });
    return;
  }
  if (rpcRequest.method === "eth_getLogs") {
    respondResult(response, rpcRequest.id, [
      createTransferRpcLog(),
      createUpgradedRpcLog(),
    ]);
    return;
  }
  respondError(response, rpcRequest.id, -32_601, "method not found");
}

function createTransferRpcLog(): Record<string, unknown> {
  const from = "0x0000000000000000000000000000000000000001";
  const to = "0x0000000000000000000000000000000000000002";
  const topics = encodeEventTopics({
    abi: v1Abi,
    eventName: "Transfer",
    args: { from, to },
  });
  return {
    address: contractAddress,
    blockHash: hex32(100),
    blockNumber: "0x64",
    data: encodeAbiParameters([{ type: "uint256" }], [1000n]),
    logIndex: "0x0",
    removed: false,
    topics,
    transactionHash: hex32(101),
    transactionIndex: "0x0",
  };
}

function createUpgradedRpcLog(): Record<string, unknown> {
  const topics = encodeEventTopics({
    abi: v2Abi,
    eventName: "Upgraded",
    args: { implementation: newImplementation },
  });
  return {
    address: contractAddress,
    blockHash: hex32(100),
    blockNumber: "0x64",
    data: "0x",
    logIndex: "0x1",
    removed: false,
    topics,
    transactionHash: hex32(101),
    transactionIndex: "0x0",
  };
}

function hex32(byte: number): Hex {
  return `0x${(byte % 255).toString(16).padStart(2, "0").repeat(32)}`;
}

function respondResult(
  response: ServerResponse,
  id: number,
  result: unknown,
): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function respondError(
  response: ServerResponse,
  id: number,
  code: number,
  message: string,
): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
  );
}

async function listen(
  server: ReturnType<typeof createServer>,
): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP test server did not bind a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
