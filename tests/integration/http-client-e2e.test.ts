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

import { EVMEventLake, OperationCancelledError } from "../../src/index.js";

const transferAbi = [
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
const contractAddress = "0x0000000000000000000000000000000000000010";

describe("public client HTTP end-to-end", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map(async (directory) =>
          rm(directory, { force: true, recursive: true }),
        ),
    );
  });

  it("fails over, splits log ranges, decodes, stores, and queries", async () => {
    const server = createServer((request, response) => {
      void handleJsonRpcRequest(request, response);
    });
    const baseUrl = await listen(server);
    const directory = await mkdtemp(join(tmpdir(), "eventlake-http-e2e-"));
    directories.push(directory);
    const logEvents: string[] = [];
    const progressStages: string[] = [];
    const client = await EVMEventLake.create({
      abi: transferAbi,
      chainId: 1,
      contractAddress,
      database: `sqlite://${join(directory, "events.db")}`,
      observability: {
        logger: { log: (event) => logEvents.push(event.event) },
        onProgress: (event) => progressStages.push(event.stage),
      },
      rpc: { maxRetriesPerEndpoint: 0, requestTimeoutMs: 2_000 },
      rpcUrls: [`${baseUrl}/bad`, `${baseUrl}/rpc`],
      startBlock: 100n,
      synchronization: { confirmations: 0, defaultBlockRange: 2 },
    });

    try {
      const result = await client.update({ toBlock: 101n });
      expect(result.outcome).toBe("synchronized");
      expect(result.rangeSplits).toBe(1);
      expect(result.endpointFailovers).toBeGreaterThanOrEqual(1);
      expect(result.storedLogs).toBe(1);
      expect(logEvents).toEqual(
        expect.arrayContaining([
          "endpoint_validated",
          "range_committed",
          "range_split",
          "update_completed",
        ]),
      );
      expect(progressStages).toEqual(
        expect.arrayContaining([
          "endpoint_validated",
          "range_fetch_started",
          "range_split",
          "range_committed",
          "update_completed",
        ]),
      );

      const page = await client.events.findMany({
        where: {
          eventSignature: "Transfer(address,address,uint256)",
          indexedParameters: {
            to: "0x0000000000000000000000000000000000000002",
          },
        },
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.arguments).toEqual({
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: 123n,
      });
    } finally {
      await client.close();
      await closeServer(server);
    }
  });

  it("close aborts and waits for an active HTTP update", async () => {
    let notifyLogRequest: (() => void) | undefined;
    const logRequestStarted = new Promise<void>((resolve) => {
      notifyLogRequest = resolve;
    });
    const server = createServer((request, response) => {
      void handleSlowJsonRpcRequest(request, response, () =>
        notifyLogRequest?.(),
      );
    });
    const baseUrl = await listen(server);
    const directory = await mkdtemp(join(tmpdir(), "eventlake-close-e2e-"));
    directories.push(directory);
    const client = await EVMEventLake.create({
      abi: transferAbi,
      chainId: 1,
      contractAddress,
      database: `sqlite://${join(directory, "events.db")}`,
      rpc: { maxRetriesPerEndpoint: 0, requestTimeoutMs: 10_000 },
      rpcUrls: [`${baseUrl}/rpc`],
      startBlock: 100n,
    });

    const updatePromise = client.update({ toBlock: 100n });
    await logRequestStarted;
    const closePromise = client.close();
    await expect(updatePromise).rejects.toBeInstanceOf(OperationCancelledError);
    await closePromise;
    await closeServer(server);
  });
});

async function handleJsonRpcRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.url === "/bad") {
    response.writeHead(503, { "content-type": "text/plain" });
    response.end("temporarily unavailable");
    return;
  }
  const rpcRequest = await readJsonRpcRequest(request);
  if (rpcRequest.method === "eth_chainId") {
    respondResult(response, rpcRequest.id, "0x1");
    return;
  }
  if (rpcRequest.method === "eth_blockNumber") {
    respondResult(response, rpcRequest.id, "0x65");
    return;
  }
  if (rpcRequest.method === "eth_getBlockByNumber") {
    const blockNumber = BigInt(rpcRequest.params[0] as string);
    respondResult(response, rpcRequest.id, {
      hash: hex32(Number(blockNumber)),
      number: toHexQuantity(blockNumber),
      parentHash: hex32(Number(blockNumber - 1n)),
    });
    return;
  }
  if (rpcRequest.method === "eth_getLogs") {
    const filter = rpcRequest.params[0] as {
      readonly fromBlock: string;
      readonly toBlock: string;
    };
    const fromBlock = BigInt(filter.fromBlock);
    const toBlock = BigInt(filter.toBlock);
    if (toBlock - fromBlock + 1n > 1n) {
      respondError(response, rpcRequest.id, -32_005, "block range too large");
      return;
    }
    respondResult(
      response,
      rpcRequest.id,
      fromBlock === 100n ? [createTransferRpcLog()] : [],
    );
    return;
  }
  respondError(response, rpcRequest.id, -32_601, "method not found");
}

async function handleSlowJsonRpcRequest(
  request: IncomingMessage,
  response: ServerResponse,
  onLogRequest: () => void,
): Promise<void> {
  const rpcRequest = await readJsonRpcRequest(request);
  if (rpcRequest.method === "eth_chainId") {
    respondResult(response, rpcRequest.id, "0x1");
    return;
  }
  if (rpcRequest.method === "eth_getLogs") {
    onLogRequest();
    request.on("close", () => response.destroy());
    return;
  }
  respondResult(response, rpcRequest.id, "0x64");
}

interface JsonRpcRequest {
  readonly id: number;
  readonly method: string;
  readonly params: readonly unknown[];
}

async function readJsonRpcRequest(
  request: IncomingMessage,
): Promise<JsonRpcRequest> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return JSON.parse(body) as JsonRpcRequest;
}

function respondResult(
  response: ServerResponse,
  id: number,
  result: unknown,
): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ id, jsonrpc: "2.0", result }));
}

function respondError(
  response: ServerResponse,
  id: number,
  code: number,
  message: string,
): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({ error: { code, message }, id, jsonrpc: "2.0" }),
  );
}

function createTransferRpcLog(): Record<string, unknown> {
  const from = "0x0000000000000000000000000000000000000001";
  const to = "0x0000000000000000000000000000000000000002";
  const topics = encodeEventTopics({
    abi: transferAbi,
    eventName: "Transfer",
    args: { from, to },
  });
  return {
    address: contractAddress,
    blockHash: hex32(100),
    blockNumber: "0x64",
    data: encodeAbiParameters([{ type: "uint256" }], [123n]),
    logIndex: "0x0",
    removed: false,
    topics,
    transactionHash: hex32(101),
    transactionIndex: "0x0",
  };
}

function toHexQuantity(value: bigint): Hex {
  return `0x${value.toString(16)}`;
}

function hex32(byte: number): Hex {
  return `0x${(byte % 255).toString(16).padStart(2, "0").repeat(32)}`;
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
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}
