import { getAddress, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EventCatalog,
  StorageConsistencyError,
  TargetMetadataConflictError,
  createContractTarget,
  createStoredEventId,
  encodeDecodedValue,
  type StorageAdapter,
  type StoredEventLog,
} from "../support/internal-exports.js";

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

const contractAddress = getAddress(
  "0x0000000000000000000000000000000000000010",
);
const target = createContractTarget({
  chainId: 1,
  contractAddress,
  startBlock: 100n,
});
const catalog = new EventCatalog(abi);

export function runStorageAdapterContract(
  adapterName: string,
  createAdapter: () => Promise<StorageAdapter>,
): void {
  describe(`${adapterName} storage adapter contract`, () => {
    let adapter: StorageAdapter;

    beforeEach(async () => {
      adapter = await createAdapter();
      await adapter.initialize();
      await adapter.registerTarget({
        abiFingerprint: catalog.abiFingerprint,
        canonicalAbiJson: catalog.canonicalAbiJson,
        target,
      });
    });

    afterEach(async () => {
      if (adapter !== undefined) await adapter.close();
    });

    it("registers and reopens target metadata while versioning ABI", async () => {
      const state = await adapter.getTargetState(target.targetKey);
      expect(state?.nextBlock).toBe(100n);
      expect(state?.syncedThroughBlock).toBeNull();
      expect(state?.activeAbiFingerprint).toBe(catalog.abiFingerprint);

      const changedCatalog = new EventCatalog([
        ...abi,
        {
          anonymous: false,
          inputs: [],
          name: "AnotherEvent",
          type: "event",
        },
      ]);
      const changed = await adapter.registerTarget({
        abiFingerprint: changedCatalog.abiFingerprint,
        canonicalAbiJson: changedCatalog.canonicalAbiJson,
        target,
      });
      expect(changed.activeAbiFingerprint).toBe(changedCatalog.abiFingerprint);

      await expect(
        adapter.registerTarget({
          abiFingerprint: catalog.abiFingerprint,
          canonicalAbiJson: catalog.canonicalAbiJson,
          target: createContractTarget({
            chainId: 1,
            contractAddress,
            startBlock: 99n,
          }),
        }),
      ).rejects.toBeInstanceOf(TargetMetadataConflictError);
    });

    it("acquires, renews, expires, and releases target-scoped leases", async () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(
        await adapter.acquireLease({
          expiresAt: future,
          ownerToken: "owner-one",
          targetKey: target.targetKey,
        }),
      ).toBe(true);
      expect(
        await adapter.acquireLease({
          expiresAt: future,
          ownerToken: "owner-two",
          targetKey: target.targetKey,
        }),
      ).toBe(false);
      expect(
        await adapter.renewLease({
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
          ownerToken: "owner-one",
          targetKey: target.targetKey,
        }),
      ).toBe(true);
      expect(
        await adapter.releaseLease({
          ownerToken: "owner-two",
          targetKey: target.targetKey,
        }),
      ).toBe(false);
      expect(
        await adapter.releaseLease({
          ownerToken: "owner-one",
          targetKey: target.targetKey,
        }),
      ).toBe(true);

      expect(
        await adapter.acquireLease({
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
          ownerToken: "expired-owner",
          targetKey: target.targetKey,
        }),
      ).toBe(true);
      expect(
        await adapter.acquireLease({
          expiresAt: future,
          ownerToken: "replacement-owner",
          targetKey: target.targetKey,
        }),
      ).toBe(true);
    });

    it("atomically commits logs, parameters, checkpoint, and cursor", async () => {
      const log = createStoredLog({ blockNumber: 100n, logIndex: 0 });
      const result = await adapter.commitRange({
        abiFingerprint: catalog.abiFingerprint,
        endBlockHash: log.blockHash,
        fromBlock: 100n,
        logs: [log, log],
        targetKey: target.targetKey,
        toBlock: 100n,
      });

      expect(result).toEqual({ duplicateLogs: 1, insertedLogs: 1 });
      const state = await adapter.getTargetState(target.targetKey);
      expect(state?.nextBlock).toBe(101n);
      expect(state?.syncedThroughBlock).toBe(100n);
      expect(state?.latestCheckpoint?.blockHash).toBe(log.blockHash);

      const events = await adapter.queryEvents({
        eventName: "ValueChanged",
        indexedParameters: [
          {
            comparableValue: encodeDecodedValue(
              "0x0000000000000000000000000000000000000001",
            ),
            name: "owner",
          },
        ],
        limit: 10,
        order: "ascending",
        targetKey: target.targetKey,
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.eventId).toBe(log.eventId);
      expect(events[0]?.parameters).toEqual(log.parameters);
    });

    it("rejects a commit that does not start at the durable cursor", async () => {
      await expect(
        adapter.commitRange({
          abiFingerprint: catalog.abiFingerprint,
          endBlockHash: hex32("04"),
          fromBlock: 101n,
          logs: [],
          targetKey: target.targetKey,
          toBlock: 101n,
        }),
      ).rejects.toBeInstanceOf(StorageConsistencyError);
    });

    it("rejects invalid rows without advancing logs or cursor", async () => {
      const invalidLog = createStoredLog({ blockNumber: 100n, logIndex: 0 });
      const duplicatePositionLog = {
        ...invalidLog,
        parameters: [invalidLog.parameters[0], invalidLog.parameters[0]],
      } as StoredEventLog;

      await expect(
        adapter.commitRange({
          abiFingerprint: catalog.abiFingerprint,
          endBlockHash: invalidLog.blockHash,
          fromBlock: 100n,
          logs: [duplicatePositionLog],
          targetKey: target.targetKey,
          toBlock: 100n,
        }),
      ).rejects.toBeDefined();

      expect((await adapter.getTargetState(target.targetKey))?.nextBlock).toBe(
        100n,
      );
      expect(
        await adapter.queryEvents({
          limit: 10,
          order: "ascending",
          targetKey: target.targetKey,
        }),
      ).toHaveLength(0);
    });

    it("queries deterministic order and rewinds rows after a checkpoint", async () => {
      const first = createStoredLog({ blockNumber: 100n, logIndex: 0 });
      await adapter.commitRange({
        abiFingerprint: catalog.abiFingerprint,
        endBlockHash: first.blockHash,
        fromBlock: 100n,
        logs: [first],
        targetKey: target.targetKey,
        toBlock: 100n,
      });
      const second = createStoredLog({ blockNumber: 101n, logIndex: 1 });
      await adapter.commitRange({
        abiFingerprint: catalog.abiFingerprint,
        endBlockHash: second.blockHash,
        fromBlock: 101n,
        logs: [second],
        targetKey: target.targetKey,
        toBlock: 101n,
      });

      const descending = await adapter.queryEvents({
        fromBlock: 100n,
        limit: 10,
        order: "descending",
        targetKey: target.targetKey,
        toBlock: 101n,
      });
      expect(descending.map((event) => event.blockNumber)).toEqual([
        101n,
        100n,
      ]);

      const rewind = await adapter.rewind(target.targetKey, 100n);
      expect(rewind).toEqual({ deletedLogs: 1, nextBlock: 101n });
      expect(
        await adapter.queryEvents({
          limit: 10,
          order: "ascending",
          targetKey: target.targetKey,
        }),
      ).toHaveLength(1);
      expect(
        await adapter.getRecentCheckpoints(target.targetKey, 10),
      ).toHaveLength(1);
    });
  });
}

function createStoredLog(input: {
  readonly blockNumber: bigint;
  readonly logIndex: number;
}): StoredEventLog {
  const blockHash = hex32(
    (input.blockNumber % 255n).toString(16).padStart(2, "0"),
  );
  const transactionHash = hex32(
    ((input.blockNumber + 1n) % 255n).toString(16).padStart(2, "0"),
  );
  return Object.freeze({
    abiFingerprint: catalog.abiFingerprint,
    blockHash,
    blockNumber: input.blockNumber,
    contractAddress,
    data: "0x",
    decodedArguments: encodeDecodedValue({
      owner: "0x0000000000000000000000000000000000000001",
      value: 10n,
    }),
    decodeStatus: "decoded",
    eventId: createStoredEventId({
      blockHash,
      logIndex: input.logIndex,
      targetKey: target.targetKey,
      transactionHash,
    }),
    eventName: "ValueChanged",
    eventSignature: "ValueChanged(address,uint256)",
    logIndex: input.logIndex,
    parameters: [
      {
        comparableValue: encodeDecodedValue(
          "0x0000000000000000000000000000000000000001",
        ),
        indexed: true,
        name: "owner",
        position: 0,
        rawTopicValue: hex32("01"),
        solidityType: "address",
        value: "0x0000000000000000000000000000000000000001",
      },
      {
        comparableValue: encodeDecodedValue(10n),
        indexed: false,
        name: "value",
        position: 1,
        rawTopicValue: null,
        solidityType: "uint256",
        value: 10n,
      },
    ],
    removed: false,
    targetKey: target.targetKey,
    topics: [hex32("02"), hex32("01")],
    transactionHash,
    transactionIndex: 0,
  });
}

function hex32(byte: string): Hex {
  return `0x${byte.repeat(32)}`;
}
