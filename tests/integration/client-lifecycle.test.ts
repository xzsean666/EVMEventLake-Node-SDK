import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClientClosedError, EVMEventLake } from "../../src/index.js";

const abi = [
  {
    anonymous: false,
    inputs: [],
    name: "Ping",
    type: "event",
  },
] as const;

describe("EVMEventLake client lifecycle", () => {
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

  it("creates and queries local state without requiring RPC connectivity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "eventlake-client-"));
    directories.push(directory);
    const client = await EVMEventLake.create({
      abi,
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000010",
      database: `sqlite://${join(directory, "events.db")}`,
      rpcUrls: ["https://unreachable.invalid"],
      startBlock: 100n,
    });

    expect((await client.getSyncStatus()).nextBlock).toBe(100n);
    expect((await client.events.findMany()).items).toEqual([]);
    expect((await client.update({ toBlock: 99n })).outcome).toBe("no_op");
    await client.close();
    await client.close();
    expect(() => client.events.findMany()).toThrow(ClientClosedError);
  });
});
