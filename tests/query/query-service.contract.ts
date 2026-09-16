import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  EventCatalog,
  EventQueryService,
  QueryValidationError,
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
      { indexed: true, name: "username", type: "string" },
      { indexed: false, name: "bio", type: "string" },
    ],
    name: "UserRegistered",
    type: "event",
  },
] as const;
const contractAddress = "0x0000000000000000000000000000000000000010" as Address;
const target = createContractTarget({
  chainId: 1,
  contractAddress,
  startBlock: 10n,
});
const catalog = new EventCatalog(abi);

export function runQueryServiceContract(
  adapterName: string,
  createAdapter: () => Promise<StorageAdapter>,
): void {
  describe(`${adapterName} query service contract`, () => {
    let adapter: StorageAdapter;
    let queryService: EventQueryService;

    beforeEach(async () => {
      adapter = await createAdapter();
      await adapter.initialize();
      await adapter.registerTarget({
        abiFingerprint: catalog.abiFingerprint,
        canonicalAbiJson: catalog.canonicalAbiJson,
        target,
      });
      await adapter.commitRange({
        abiFingerprint: catalog.abiFingerprint,
        endBlockHash: hex32(10),
        fromBlock: 10n,
        logs: [createTransferLog(10n, 0, 10n)],
        targetKey: target.targetKey,
        toBlock: 10n,
      });
      await adapter.commitRange({
        abiFingerprint: catalog.abiFingerprint,
        endBlockHash: hex32(11),
        fromBlock: 11n,
        logs: [createTransferLog(11n, 1, 20n)],
        targetKey: target.targetKey,
        toBlock: 11n,
      });
      queryService = new EventQueryService({
        catalog,
        storage: adapter,
        target,
      });
    });

    afterEach(async () => {
      await adapter.close();
    });

    it("combines block, transaction, event, and indexed parameter filters", async () => {
      const transactionHash = hex32(12);
      const page = await queryService.findMany({
        where: {
          blockNumber: { greaterThanOrEqual: 10n, lessThanOrEqual: 11n },
          eventSignature: "Transfer(address,address,uint256)",
          indexedParameters: {
            to: "0x0000000000000000000000000000000000000002",
          },
          transactionHash,
        },
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.blockNumber).toBe(11n);
      expect(page.items[0]?.arguments).toEqual({
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: 20n,
      });
    });

    it("paginates deterministically in ascending and descending order", async () => {
      const firstPage = await queryService.findMany({ limit: 1 });
      expect(firstPage.items[0]?.blockNumber).toBe(10n);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPage = await queryService.findMany({
        after: firstPage.nextCursor as string,
        limit: 1,
      });
      expect(secondPage.items[0]?.blockNumber).toBe(11n);
      expect(secondPage.nextCursor).toBeNull();

      const descending = await queryService.findMany({
        limit: 2,
        order: "descending",
      });
      expect(descending.items.map((item) => item.blockNumber)).toEqual([
        11n,
        10n,
      ]);
    });

    it("rejects invalid limits, cursors, ranges, and ambiguous parameter inputs", async () => {
      await expect(queryService.findMany({ limit: 0 })).rejects.toBeInstanceOf(
        QueryValidationError,
      );
      await expect(
        queryService.findMany({ after: "invalid" }),
      ).rejects.toBeInstanceOf(QueryValidationError);
      await expect(
        queryService.findMany({
          where: {
            blockNumber: { greaterThanOrEqual: 12n, lessThanOrEqual: 11n },
          },
        }),
      ).rejects.toBeInstanceOf(QueryValidationError);
      await expect(
        queryService.findMany({
          where: { indexedParameters: { missing: "value" } },
        }),
      ).rejects.toBeInstanceOf(QueryValidationError);
    });

    it("queries dynamic indexed string by plaintext and by topic hash", async () => {
      await adapter.commitRange({
        abiFingerprint: catalog.abiFingerprint,
        endBlockHash: hex32(12),
        fromBlock: 12n,
        logs: [createUserRegisteredLog(12n, 0, "Alice", "Developer")],
        targetKey: target.targetKey,
        toBlock: 12n,
      });

      const byPlaintext = await queryService.findMany({
        where: {
          eventName: "UserRegistered",
          indexedParameters: { username: "Alice" },
        },
      });
      expect(byPlaintext.items).toHaveLength(1);
      expect(byPlaintext.items[0]?.eventName).toBe("UserRegistered");
      expect(byPlaintext.items[0]?.arguments).toEqual({
        bio: "Developer",
        username: "Alice",
      });

      const aliceHash = keccak256(stringToBytes("Alice")).toLowerCase();
      const byHash = await queryService.findMany({
        where: {
          eventName: "UserRegistered",
          indexedParameters: { username: aliceHash },
        },
      });
      expect(byHash.items[0]?.transactionHash).toBe(
        byPlaintext.items[0]?.transactionHash,
      );
      expect(byHash.items[0]?.logIndex).toBe(byPlaintext.items[0]?.logIndex);

      const noMatch = await queryService.findMany({
        where: {
          eventName: "UserRegistered",
          indexedParameters: { username: "Bob" },
        },
      });
      expect(noMatch.items).toHaveLength(0);
    });

    it("queries unindexed parameters with index acceleration", async () => {
      await adapter.commitRange({
        abiFingerprint: catalog.abiFingerprint,
        endBlockHash: hex32(12),
        fromBlock: 12n,
        logs: [createUserRegisteredLog(12n, 0, "Alice", "Developer")],
        targetKey: target.targetKey,
        toBlock: 12n,
      });

      const byBio = await queryService.findMany({
        where: {
          eventName: "UserRegistered",
          unindexedParameters: { bio: "Developer" },
        },
      });
      expect(byBio.items).toHaveLength(1);
      expect(byBio.items[0]?.blockNumber).toBe(12n);

      const byTransferValue = await queryService.findMany({
        where: {
          eventName: "Transfer",
          unindexedParameters: { value: 20n },
        },
      });
      expect(byTransferValue.items).toHaveLength(1);
      expect(byTransferValue.items[0]?.blockNumber).toBe(11n);

      const combined = await queryService.findMany({
        where: {
          eventName: "Transfer",
          indexedParameters: {
            to: "0x0000000000000000000000000000000000000002",
          },
          unindexedParameters: { value: 20n },
        },
      });
      expect(combined.items).toHaveLength(1);
      expect(combined.items[0]?.blockNumber).toBe(11n);

      const mismatch = await queryService.findMany({
        where: {
          eventName: "Transfer",
          indexedParameters: {
            to: "0x0000000000000000000000000000000000000002",
          },
          unindexedParameters: { value: 999n },
        },
      });
      expect(mismatch.items).toHaveLength(0);
    });
  });
}

function createTransferLog(
  blockNumber: bigint,
  logIndex: number,
  value: bigint,
): StoredEventLog {
  const blockHash = hex32(Number(blockNumber));
  const transactionHash = hex32(Number(blockNumber + 1n));
  const from = "0x0000000000000000000000000000000000000001";
  const to = "0x0000000000000000000000000000000000000002";
  return {
    abiFingerprint: catalog.abiFingerprint,
    blockHash,
    blockNumber,
    contractAddress,
    data: "0x",
    decodedArguments: encodeDecodedValue({ from, to, value }),
    decodeStatus: "decoded",
    eventId: createStoredEventId({
      blockHash,
      logIndex,
      targetKey: target.targetKey,
      transactionHash,
    }),
    eventName: "Transfer",
    eventSignature: "Transfer(address,address,uint256)",
    logIndex,
    parameters: [
      {
        comparableValue: encodeDecodedValue(from),
        indexed: true,
        name: "from",
        position: 0,
        rawTopicValue: hex32(1),
        solidityType: "address",
        value: from,
      },
      {
        comparableValue: encodeDecodedValue(to),
        indexed: true,
        name: "to",
        position: 1,
        rawTopicValue: hex32(2),
        solidityType: "address",
        value: to,
      },
      {
        comparableValue: encodeDecodedValue(value),
        indexed: false,
        name: "value",
        position: 2,
        rawTopicValue: null,
        solidityType: "uint256",
        value,
      },
    ],
    removed: false,
    targetKey: target.targetKey,
    topics: [hex32(3), hex32(1), hex32(2)],
    transactionHash,
    transactionIndex: 0,
  };
}

function hex32(byte: number): Hex {
  return `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;
}

function createUserRegisteredLog(
  blockNumber: bigint,
  logIndex: number,
  username: string,
  bio: string,
): StoredEventLog {
  const blockHash = hex32(Number(blockNumber));
  const transactionHash = hex32(Number(blockNumber + 1n));
  const usernameHash = keccak256(stringToBytes(username)).toLowerCase() as Hex;
  return {
    abiFingerprint: catalog.abiFingerprint,
    blockHash,
    blockNumber,
    contractAddress,
    data: "0x",
    decodedArguments: encodeDecodedValue({ bio, username }),
    decodeStatus: "decoded",
    eventId: createStoredEventId({
      blockHash,
      logIndex,
      targetKey: target.targetKey,
      transactionHash,
    }),
    eventName: "UserRegistered",
    eventSignature: "UserRegistered(string,string)",
    logIndex,
    parameters: [
      {
        comparableValue: encodeDecodedValue(usernameHash),
        indexed: true,
        name: "username",
        position: 0,
        rawTopicValue: usernameHash,
        solidityType: "string",
        value: username,
      },
      {
        comparableValue: encodeDecodedValue(bio),
        indexed: false,
        name: "bio",
        position: 1,
        rawTopicValue: null,
        solidityType: "string",
        value: bio,
      },
    ],
    removed: false,
    targetKey: target.targetKey,
    topics: [hex32(4), usernameHash],
    transactionHash,
    transactionIndex: 0,
  };
}
