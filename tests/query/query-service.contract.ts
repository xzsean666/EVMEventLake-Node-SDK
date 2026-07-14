import type { Address, Hex } from "viem";
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
