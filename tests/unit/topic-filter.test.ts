import { describe, expect, it } from "vitest";
import { keccak256, toHex, type Address, type Hex } from "viem";

import {
  ConfigurationValidationError,
  matchesTopicFilter,
  normalizeTopicsFilter,
  StorageConsistencyError,
} from "../../src/index.js";
import { validateSdkOptions } from "../../src/configuration/validate-sdk-options.js";
import { RpcPool } from "../../src/rpc/rpc-pool.js";
import type { RpcTransport } from "../../src/rpc/evm-rpc-client.js";
import {
  UpdateService,
  type UpdateRpcClient,
} from "../../src/synchronization/update-service.js";
import { EventCatalog } from "../../src/abi/event-catalog.js";
import { createContractTarget } from "../../src/contract-target/contract-target.js";
import { createStorageAdapter } from "../../src/storage/create-storage-adapter.js";
import {
  DEFAULT_RPC_POLICY,
  DEFAULT_SYNCHRONIZATION_POLICY,
} from "../../src/configuration/sdk-options.js";
import type {
  FetchLogsOptions,
  RpcBlockHeader,
  RpcLog,
  RpcLogsResult,
  RpcPoolMetrics,
} from "../../src/rpc/rpc-pool.js";

const TRANSFER_ABI = [
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

const TRANSFER_TOPIC0 = keccak256(
  toHex("Transfer(address,address,uint256)"),
).toLowerCase() as Hex;
const APPROVAL_TOPIC0 = keccak256(
  toHex("Approval(address,address,uint256)"),
).toLowerCase() as Hex;

const ALICE_ADDR = "0x1111111111111111111111111111111111111111";
const ALICE_TOPIC =
  "0x0000000000000000000000001111111111111111111111111111111111111111" as Hex;
const BOB_ADDR = "0x2222222222222222222222222222222222222222";
const BOB_TOPIC =
  "0x0000000000000000000000002222222222222222222222222222222222222222" as Hex;

class FakeUpdateRpc implements UpdateRpcClient {
  public lastFetchLogsOptions: FetchLogsOptions | undefined;
  public logs: RpcLog[] = [];

  public cooldownEndpoint(): void {}

  public fetchLogs(
    _address: Address,
    _fromBlock: bigint,
    _toBlock: bigint,
    options?: FetchLogsOptions,
  ): Promise<RpcLogsResult> {
    this.lastFetchLogsOptions = options;
    return Promise.resolve({
      endpointIdentity: "test-endpoint",
      endpointUrl: "https://rpc.example.com",
      logs: this.logs,
    });
  }

  public getBlockHeader(blockNumber: bigint): Promise<RpcBlockHeader> {
    return Promise.resolve({
      hash: "0xaaaa000000000000000000000000000000000000000000000000000000000001",
      number: blockNumber,
      parentHash:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
    });
  }

  public getBlockNumber(): Promise<bigint> {
    return Promise.resolve(100n);
  }

  public getMetrics(): RpcPoolMetrics {
    return { endpointFailovers: 0, requestCount: 1 };
  }
}

describe("Native getLogs Topic Filters (TASK-014)", () => {
  describe("normalizeTopicsFilter", () => {
    it("returns undefined for empty, null, or all-null inputs", () => {
      expect(normalizeTopicsFilter(undefined)).toBeUndefined();
      expect(normalizeTopicsFilter(null)).toBeUndefined();
      expect(normalizeTopicsFilter([])).toBeUndefined();
      expect(normalizeTopicsFilter([null, null])).toBeUndefined();
      expect(
        normalizeTopicsFilter({ topic0: null, topic1: null }),
      ).toBeUndefined();
    });

    it("normalizes array input and lowercases 32-byte hex topics", () => {
      const result = normalizeTopicsFilter([TRANSFER_TOPIC0]);
      expect(result).toEqual([TRANSFER_TOPIC0]);
    });

    it("automatically pads 20-byte EVM addresses to 32 bytes with leading zeros", () => {
      const result = normalizeTopicsFilter([null, ALICE_ADDR]);
      expect(result).toEqual([null, ALICE_TOPIC]);
    });

    it("normalizes nested arrays for logical OR topic filtering", () => {
      const result = normalizeTopicsFilter([
        [TRANSFER_TOPIC0, APPROVAL_TOPIC0],
        [ALICE_ADDR, BOB_ADDR],
      ]);
      expect(result).toEqual([
        [TRANSFER_TOPIC0, APPROVAL_TOPIC0],
        [ALICE_TOPIC, BOB_TOPIC],
      ]);
    });

    it("normalizes named topic object notation { topic0, topic1, topic2, topic3 }", () => {
      const result = normalizeTopicsFilter({
        topic0: TRANSFER_TOPIC0,
        topic2: BOB_ADDR,
      });
      expect(result).toEqual([TRANSFER_TOPIC0, null, BOB_TOPIC]);
    });

    it("allows omitting topic0 and targeting specific topic1, topic2, or topic3", () => {
      // Omitting topic0 in object notation
      const onlyTopic1 = normalizeTopicsFilter({
        topic1: ALICE_ADDR,
      });
      expect(onlyTopic1).toEqual([null, ALICE_TOPIC]);

      // Omitting topic0 and topic1, specifying only topic2
      const onlyTopic2 = normalizeTopicsFilter({
        topic2: BOB_ADDR,
      });
      expect(onlyTopic2).toEqual([null, null, BOB_TOPIC]);

      // Specifying topic1 and topic3
      const topic1And3 = normalizeTopicsFilter({
        topic1: ALICE_ADDR,
        topic3: BOB_ADDR,
      });
      expect(topic1And3).toEqual([null, ALICE_TOPIC, null, BOB_TOPIC]);

      // Top-level arguments omitting topic0
      const topLevelOnlyTopic2 = normalizeTopicsFilter(undefined, {
        topic2: BOB_ADDR,
      });
      expect(topLevelOnlyTopic2).toEqual([null, null, BOB_TOPIC]);
    });

    it("normalizes bigint, number, and boolean topic values into 32-byte hex", () => {
      // bigint (e.g. ERC721 tokenId: 12345n)
      const bigintResult = normalizeTopicsFilter({
        topic1: 12345n,
      });
      expect(bigintResult).toEqual([
        null,
        "0x0000000000000000000000000000000000000000000000000000000000003039",
      ]);

      // signed negative bigint (two's complement)
      const negBigintResult = normalizeTopicsFilter({
        topic1: -1n,
      });
      expect(negBigintResult).toEqual([
        null,
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      ]);

      // number safe integer
      const numberResult = normalizeTopicsFilter({
        topic1: 42,
      });
      expect(numberResult).toEqual([
        null,
        "0x000000000000000000000000000000000000000000000000000000000000002a",
      ]);

      // boolean (true / false)
      const boolTrueResult = normalizeTopicsFilter({
        topic1: true,
      });
      expect(boolTrueResult).toEqual([
        null,
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ]);

      const boolFalseResult = normalizeTopicsFilter({
        topic1: false,
      });
      expect(boolFalseResult).toEqual([
        null,
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ]);

      // Array form with mixed types
      const mixedResult = normalizeTopicsFilter([
        TRANSFER_TOPIC0,
        ALICE_ADDR,
        100n,
        true,
      ]);
      expect(mixedResult).toEqual([
        TRANSFER_TOPIC0,
        ALICE_TOPIC,
        "0x0000000000000000000000000000000000000000000000000000000000000064",
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ]);
    });

    it("throws ConfigurationValidationError on out-of-range bigint or unsafe number", () => {
      expect(() => normalizeTopicsFilter([1n << 256n])).toThrow(
        ConfigurationValidationError,
      );
      expect(() => normalizeTopicsFilter([-(1n << 256n)])).toThrow(
        ConfigurationValidationError,
      );
      expect(() => normalizeTopicsFilter([1.5])).toThrow(
        ConfigurationValidationError,
      );
    });

    it("supports top-level convenience arguments topic0..topic3", () => {
      const result = normalizeTopicsFilter(undefined, {
        topic0: TRANSFER_TOPIC0,
        topic1: ALICE_ADDR,
      });
      expect(result).toEqual([TRANSFER_TOPIC0, ALICE_TOPIC]);
    });

    it("trims trailing nulls for optimal JSON-RPC compatibility", () => {
      const result = normalizeTopicsFilter([TRANSFER_TOPIC0, null, null, null]);
      expect(result).toEqual([TRANSFER_TOPIC0]);
    });

    it("throws ConfigurationValidationError when topic count exceeds 4", () => {
      expect(() =>
        normalizeTopicsFilter([
          TRANSFER_TOPIC0,
          ALICE_TOPIC,
          BOB_TOPIC,
          TRANSFER_TOPIC0,
          APPROVAL_TOPIC0,
        ]),
      ).toThrow(ConfigurationValidationError);
    });

    it("throws ConfigurationValidationError on invalid hex string", () => {
      expect(() => normalizeTopicsFilter(["0x12345"])).toThrow(
        ConfigurationValidationError,
      );
      expect(() =>
        normalizeTopicsFilter(["not-a-hex" as unknown as Hex]),
      ).toThrow(ConfigurationValidationError);
    });

    it("throws ConfigurationValidationError on empty nested OR array or null in OR array", () => {
      expect(() => normalizeTopicsFilter([[]])).toThrow(
        ConfigurationValidationError,
      );
      expect(() => normalizeTopicsFilter([[null as unknown as Hex]])).toThrow(
        ConfigurationValidationError,
      );
    });

    it("throws ConfigurationValidationError on unrecognized object keys", () => {
      expect(() =>
        normalizeTopicsFilter({
          topic0: TRANSFER_TOPIC0,
          unknownKey: "0x123",
        } as unknown as { topic0: Hex }),
      ).toThrow(ConfigurationValidationError);
    });

    it("correctly integrates with validateSdkOptions", () => {
      const normalized = validateSdkOptions({
        abi: TRANSFER_ABI,
        chainId: 1,
        contractAddress: "0x0000000000000000000000000000000000000001",
        database: ":memory:",
        rpcUrls: ["https://rpc.example.com"],
        startBlock: 100,
        topic0: TRANSFER_TOPIC0,
        topic1: ALICE_ADDR,
      });
      expect(normalized.topics).toEqual([TRANSFER_TOPIC0, ALICE_TOPIC]);
    });
  });

  describe("matchesTopicFilter", () => {
    it("returns true when filter is undefined or empty", () => {
      expect(matchesTopicFilter([TRANSFER_TOPIC0], undefined)).toBe(true);
      expect(matchesTopicFilter([TRANSFER_TOPIC0], [])).toBe(true);
    });

    it("matches exact topic0 and wildcard topic1", () => {
      expect(
        matchesTopicFilter(
          [TRANSFER_TOPIC0, ALICE_TOPIC, BOB_TOPIC],
          [TRANSFER_TOPIC0, null, BOB_TOPIC],
        ),
      ).toBe(true);
    });

    it("matches when topic0 is wildcard (null) and only topic1/topic2 is specified", () => {
      expect(
        matchesTopicFilter(
          [TRANSFER_TOPIC0, ALICE_TOPIC, BOB_TOPIC],
          [null, ALICE_TOPIC],
        ),
      ).toBe(true);
      expect(
        matchesTopicFilter(
          [APPROVAL_TOPIC0, ALICE_TOPIC, BOB_TOPIC],
          [null, ALICE_TOPIC],
        ),
      ).toBe(true);
      expect(
        matchesTopicFilter(
          [TRANSFER_TOPIC0, BOB_TOPIC, BOB_TOPIC],
          [null, ALICE_TOPIC],
        ),
      ).toBe(false);
    });

    it("matches logical OR array in filter", () => {
      expect(
        matchesTopicFilter(
          [APPROVAL_TOPIC0, ALICE_TOPIC],
          [[TRANSFER_TOPIC0, APPROVAL_TOPIC0], ALICE_TOPIC],
        ),
      ).toBe(true);
    });

    it("returns false when topic does not match", () => {
      expect(
        matchesTopicFilter(
          [APPROVAL_TOPIC0, ALICE_TOPIC],
          [TRANSFER_TOPIC0, ALICE_TOPIC],
        ),
      ).toBe(false);
    });

    it("returns false when log has fewer topics than non-null filter topic", () => {
      expect(
        matchesTopicFilter([TRANSFER_TOPIC0], [TRANSFER_TOPIC0, ALICE_TOPIC]),
      ).toBe(false);
    });
  });

  describe("RpcPool integration with topics", () => {
    it("passes topics in eth_getLogs payload for single requests", async () => {
      let requestedPayload: unknown = null;
      const mockTransport: RpcTransport = {
        request({ method, params }) {
          if (method === "eth_chainId") return Promise.resolve("0x1");
          if (method === "eth_getLogs") {
            requestedPayload = params[0];
            return Promise.resolve([]);
          }
          return Promise.reject(new Error(`Unexpected method ${method}`));
        },
      };

      const pool = new RpcPool(
        1,
        ["https://rpc.example.com"],
        {
          batchSize: 1,
          endpointCooldownMs: 30000,
          maximumTimeoutSplitsPerRange: 2,
          maxRetriesPerEndpoint: 2,
          requestTimeoutMs: 10000,
        },
        { transport: mockTransport },
      );

      await pool.fetchLogs(
        "0x0000000000000000000000000000000000000001",
        100n,
        200n,
        {
          topics: [TRANSFER_TOPIC0, ALICE_TOPIC],
        },
      );

      expect(requestedPayload).toMatchObject({
        address: "0x0000000000000000000000000000000000000001",
        fromBlock: "0x64",
        toBlock: "0xc8",
        topics: [TRANSFER_TOPIC0, ALICE_TOPIC],
      });
    });

    it("passes topics in eth_getLogs batch payload", async () => {
      let batchRequests: readonly unknown[] = [];
      const mockTransport: RpcTransport = {
        request({ method }) {
          if (method === "eth_chainId") return Promise.resolve("0x1");
          return Promise.reject(new Error(`Unexpected method ${method}`));
        },
        requestBatch({ requests }) {
          batchRequests = requests;
          return Promise.resolve(
            requests.map((req, i) => ({
              id: i,
              ok: true,
              result: [],
            })),
          );
        },
      };

      const pool = new RpcPool(
        1,
        ["https://rpc.example.com"],
        {
          batchSize: 5,
          endpointCooldownMs: 30000,
          maximumTimeoutSplitsPerRange: 2,
          maxRetriesPerEndpoint: 2,
          requestTimeoutMs: 10000,
        },
        { transport: mockTransport },
      );

      await pool.fetchLogsBatch(
        "0x0000000000000000000000000000000000000001",
        [
          { fromBlock: 100n, toBlock: 150n },
          { fromBlock: 151n, toBlock: 200n },
        ],
        {
          topics: [TRANSFER_TOPIC0, [ALICE_TOPIC, BOB_TOPIC]],
        },
      );

      expect(batchRequests).toHaveLength(2);
      expect(batchRequests[0]).toMatchObject({
        method: "eth_getLogs",
        params: [
          {
            address: "0x0000000000000000000000000000000000000001",
            fromBlock: "0x64",
            toBlock: "0x96",
            topics: [TRANSFER_TOPIC0, [ALICE_TOPIC, BOB_TOPIC]],
          },
        ],
      });
    });
  });

  describe("UpdateService integration with topic filters", () => {
    it("propagates configured topics to RPC and rejects violating logs defensively", async () => {
      const fakeRpc = new FakeUpdateRpc();
      fakeRpc.logs = [
        {
          address: "0x0000000000000000000000000000000000000001",
          blockHash:
            "0xaaaa000000000000000000000000000000000000000000000000000000000001",
          blockNumber: 100n,
          data: "0x00000000000000000000000000000000000000000000000000000000000003e8",
          logIndex: 0,
          removed: false,
          topics: [APPROVAL_TOPIC0, ALICE_TOPIC, BOB_TOPIC],
          transactionHash:
            "0xbbbb000000000000000000000000000000000000000000000000000000000001",
          transactionIndex: 0,
        },
      ];

      const storage = await createStorageAdapter({
        filename: ":memory:",
        kind: "sqlite",
      });
      await storage.initialize();
      const target = createContractTarget({
        chainId: 1,
        contractAddress: "0x0000000000000000000000000000000000000001",
        startBlock: 100n,
      });
      const catalog = new EventCatalog(TRANSFER_ABI);
      await storage.registerTarget({
        abiFingerprint: catalog.abiFingerprint,
        canonicalAbiJson: catalog.canonicalAbiJson,
        target,
      });

      const updateService = new UpdateService({
        catalog,
        rpc: fakeRpc,
        rpcPolicy: DEFAULT_RPC_POLICY,
        storage,
        synchronizationPolicy: {
          ...DEFAULT_SYNCHRONIZATION_POLICY,
          confirmations: 0,
        },
        target,
        topics: [TRANSFER_TOPIC0],
      });

      // Update with default instance topics: fakeRpc receives topics, and log with APPROVAL violates filter
      await expect(updateService.update({ toBlock: 100 })).rejects.toThrow(
        StorageConsistencyError,
      );
      expect(fakeRpc.lastFetchLogsOptions?.topics).toEqual([TRANSFER_TOPIC0]);

      // Override topics in update() to APPROVAL_TOPIC0: now matches and succeeds
      const result = await updateService.update({
        toBlock: 100,
        topics: [APPROVAL_TOPIC0],
      });
      expect(fakeRpc.lastFetchLogsOptions?.topics).toEqual([APPROVAL_TOPIC0]);
      expect(result.storedLogs).toBe(1);
      expect(result.decodedLogs).toBe(1);

      await storage.close();
    });
  });
});
