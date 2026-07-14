import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EVMEventLake } from "../../src/index.js";

const RUN_LIVE_TESTS = process.env.EVM_EVENT_LAKE_RUN_LIVE_RPC_TESTS === "true";
const BASE_RPC_URL =
  process.env.EVM_EVENT_LAKE_LIVE_RPC_URL ?? "https://mainnet.base.org";
const BASE_CHAIN_ID = 8_453;
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SAMPLE_BLOCK = 48_625_053n;
const directories: string[] = [];

const erc20EventAbi = [
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
    inputs: [
      { indexed: true, name: "owner", type: "address" },
      { indexed: true, name: "spender", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Approval",
    type: "event",
  },
] as const;

describe.runIf(RUN_LIVE_TESTS)("Base USDC live RPC", () => {
  it("collects, decodes, stores, and queries a stable real block", async () => {
    const directory = await mkdtemp(join(tmpdir(), "eventlake-live-base-"));
    directories.push(directory);
    const client = await EVMEventLake.create({
      abi: erc20EventAbi,
      chainId: BASE_CHAIN_ID,
      contractAddress: BASE_USDC,
      database: `sqlite://${join(directory, "events.db")}`,
      rpc: { maxRetriesPerEndpoint: 1, requestTimeoutMs: 20_000 },
      rpcUrls: [BASE_RPC_URL],
      startBlock: SAMPLE_BLOCK,
      synchronization: { confirmations: 0, defaultBlockRange: 1 },
    });

    try {
      const update = await client.update({ toBlock: SAMPLE_BLOCK });
      const transfers = await client.events.findMany({
        limit: 100,
        where: { eventSignature: "Transfer(address,address,uint256)" },
      });

      expect(update.fetchedLogs).toBe(76);
      expect(update.storedLogs).toBe(76);
      expect(transfers.items).toHaveLength(57);
      expect(transfers.items[0]?.decodeStatus).toBe("decoded");
    } finally {
      await client.close();
    }
  }, 60_000);
});

afterAll(async () => {
  await Promise.all(
    directories.map(async (directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});
