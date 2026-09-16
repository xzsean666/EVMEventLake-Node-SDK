import "fake-indexeddb/auto";

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ClientClosedError, EVMEventLake } from "../../src/index.js";

const abi = [
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

describe("EVMEventLake browser / IndexedDB isomorphic lifecycle", () => {
  it("initializes via idb:// connection string, queries sync state offline, and handles close", async () => {
    const dbName = `browser-lake-${randomUUID()}`;
    const progressStages: string[] = [];

    const client = await EVMEventLake.create({
      abi,
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000010",
      database: `idb://${dbName}`,
      observability: {
        onProgress: (event) => progressStages.push(event.stage),
      },
      rpcUrls: ["https://unreachable.invalid"],
      startBlock: 200n,
    });

    const status = await client.getSyncStatus();
    expect(status.nextBlock).toBe(200n);
    expect(status.startBlock).toBe(200n);
    expect(status.syncedThroughBlock).toBeNull();
    expect(status.hasActiveLease).toBe(false);

    const queryResult = await client.events.findMany();
    expect(queryResult.items).toEqual([]);

    const noOpUpdate = await client.update({ toBlock: 199n });
    expect(noOpUpdate.outcome).toBe("no_op");
    expect(noOpUpdate.storedLogs).toBe(0);
    expect(progressStages).toContain("update_completed");

    await client.close();
    await client.close();

    expect(() => client.events.findMany()).toThrow(ClientClosedError);
  });
});
