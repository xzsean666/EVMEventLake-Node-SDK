import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ClientClosedError, EVMEventLake } from "@evm-event-lake/node-sdk";
import * as packageRoot from "@evm-event-lake/node-sdk";

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
];
const contractAddress = "0x0000000000000000000000000000000000000010";
const fromAddress = "0x0000000000000000000000000000000000000001";
const toAddress = "0x0000000000000000000000000000000000000002";
const transferSignature = "Transfer(address,address,uint256)";
const transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

test("Git-installed package supports the public lifecycle and query surface", async () => {
  assert.equal(typeof packageRoot.EVMEventLake, "function");
  assert.equal("RpcPool" in packageRoot, false);
  assert.equal("createStorageAdapter" in packageRoot, false);

  const directory = await mkdtemp(join(tmpdir(), "eventlake-example-"));
  const server = createServer((request, response) => {
    void handleJsonRpcRequest(request, response);
  });
  const baseUrl = await listen(server);
  const logEvents = [];
  const progressStages = [];
  let client;

  try {
    client = await EVMEventLake.create({
      abi: transferAbi,
      chainId: 1,
      contractAddress,
      database: `sqlite://${join(directory, "events.db")}`,
      observability: {
        logger: {
          log(event) {
            logEvents.push(event.event);
          },
        },
        onProgress(event) {
          progressStages.push(event.stage);
        },
      },
      rpc: { maxRetriesPerEndpoint: 0, requestTimeoutMs: 2_000 },
      rpcUrls: [`${baseUrl}/unavailable`, `${baseUrl}/rpc`],
      startBlock: 100n,
      synchronization: { confirmations: 0, defaultBlockRange: 2 },
    });

    const initialStatus = await client.getSyncStatus();
    assert.equal(initialStatus.nextBlock, 100n);
    assert.equal(initialStatus.syncedThroughBlock, null);
    assert.deepEqual((await client.events.findMany()).items, []);
    assert.equal(await client.events.findFirst(), null);

    const update = await client.update({ toBlock: 101n });
    assert.equal(update.outcome, "synchronized");
    assert.equal(update.resultingNextBlock, 102n);
    assert.equal(update.storedLogs, 3);
    assert.equal(update.decodedLogs, 2);
    assert.equal(update.unknownLogs, 1);
    assert.equal(update.rangeSplits, 1);
    assert.ok(update.endpointFailovers >= 1);

    const noOp = await client.update({ toBlock: 101n });
    assert.equal(noOp.outcome, "no_op");
    assert.equal(noOp.resultingNextBlock, 102n);

    await closeServer(server);

    const status = await client.getSyncStatus();
    assert.equal(status.syncedThroughBlock, 101n);
    assert.equal(status.latestCheckpoint?.blockNumber, 101n);

    const bySignatureAndIndexedValue = await client.events.findMany({
      where: {
        eventSignature: transferSignature,
        indexedParameters: { to: toAddress },
      },
    });
    assert.equal(bySignatureAndIndexedValue.items.length, 2);
    assert.deepEqual(bySignatureAndIndexedValue.items[0]?.arguments, {
      from: fromAddress,
      to: toAddress,
      value: 123n,
    });

    const byTransaction = await client.events.findFirst({
      where: { transactionHash: transactionHashForBlock(101n) },
    });
    assert.equal(byTransaction?.blockNumber, 101n);
    assert.equal(byTransaction?.eventName, "Transfer");

    const byBlockRange = await client.events.findMany({
      where: {
        blockNumber: {
          greaterThanOrEqual: 101n,
          lessThanOrEqual: 101n,
        },
      },
    });
    assert.equal(byBlockRange.items.length, 2);
    assert.equal(
      byBlockRange.items.some((event) => event.decodeStatus === "unknown"),
      true,
    );

    const firstPage = await client.events.findMany({ limit: 1 });
    assert.equal(firstPage.items.length, 1);
    assert.notEqual(firstPage.nextCursor, null);
    const secondPage = await client.events.findMany({
      after: firstPage.nextCursor ?? undefined,
      limit: 1,
    });
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(
      secondPage.items[0]?.transactionHash,
      firstPage.items[0]?.transactionHash,
    );

    assert.ok(logEvents.includes("sdk_initialized"));
    assert.ok(logEvents.includes("update_started"));
    assert.ok(logEvents.includes("range_committed"));
    assert.ok(logEvents.includes("update_completed"));
    assert.ok(progressStages.includes("endpoint_validated"));
    assert.ok(progressStages.includes("range_fetch_started"));
    assert.ok(progressStages.includes("range_split"));
    assert.ok(progressStages.includes("range_committed"));
    assert.ok(progressStages.includes("update_completed"));

    await client.close();
    await client.close();
    assert.throws(() => client.events.findMany(), ClientClosedError);
  } finally {
    await client?.close();
    await closeServer(server);
    await rm(directory, { force: true, recursive: true });
  }
});

async function handleJsonRpcRequest(request, response) {
  if (request.url === "/unavailable") {
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
    const blockNumber = BigInt(rpcRequest.params[0]);
    respondResult(response, rpcRequest.id, {
      hash: blockHash(blockNumber),
      number: toHexQuantity(blockNumber),
      parentHash: blockHash(blockNumber - 1n),
    });
    return;
  }
  if (rpcRequest.method === "eth_getLogs") {
    const filter = rpcRequest.params[0];
    const fromBlock = BigInt(filter.fromBlock);
    const toBlock = BigInt(filter.toBlock);
    if (toBlock - fromBlock + 1n > 1n) {
      respondError(response, rpcRequest.id, -32_005, "block range too large");
      return;
    }
    const logs = [createTransferRpcLog(fromBlock)];
    if (fromBlock === 101n) logs.push(createUnknownRpcLog(fromBlock));
    respondResult(response, rpcRequest.id, logs);
    return;
  }
  respondError(response, rpcRequest.id, -32_601, "method not found");
}

async function readJsonRpcRequest(request) {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return JSON.parse(body);
}

function respondResult(response, id, result) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ id, jsonrpc: "2.0", result }));
}

function respondError(response, id, code, message) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({ error: { code, message }, id, jsonrpc: "2.0" }),
  );
}

function createTransferRpcLog(blockNumber) {
  return {
    address: contractAddress,
    blockHash: blockHash(blockNumber),
    blockNumber: toHexQuantity(blockNumber),
    data: uint256(blockNumber === 100n ? 123n : 456n),
    logIndex: "0x0",
    removed: false,
    topics: [transferTopic, addressTopic(fromAddress), addressTopic(toAddress)],
    transactionHash: transactionHashForBlock(blockNumber),
    transactionIndex: "0x0",
  };
}

function createUnknownRpcLog(blockNumber) {
  return {
    address: contractAddress,
    blockHash: blockHash(blockNumber),
    blockNumber: toHexQuantity(blockNumber),
    data: "0x",
    logIndex: "0x1",
    removed: false,
    topics: [hex32(42n)],
    transactionHash: hex32(202n),
    transactionIndex: "0x1",
  };
}

function addressTopic(address) {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function blockHash(blockNumber) {
  return hex32(blockNumber);
}

function transactionHashForBlock(blockNumber) {
  return hex32(blockNumber + 100n);
}

function uint256(value) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function toHexQuantity(value) {
  return `0x${value.toString(16)}`;
}

function hex32(value) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP fixture did not bind a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}
