import "fake-indexeddb/auto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
} from "viem";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_RPC_POLICY,
  DEFAULT_SYNCHRONIZATION_POLICY,
  EventCatalog,
  EventEnrichmentError,
  EventQueryService,
  RedecodeService,
  UpdateService,
  createContractTarget,
  createIndexeddbStorageAdapter,
  createRpcEndpointIdentity,
  createSqliteStorageAdapter,
  type EventEnricher,
  type RpcBlockHeader,
  type RpcLog,
  type RpcLogsResult,
  type RpcPoolMetrics,
  type StorageAdapter,
  type UpdateRpcClient,
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

const upgradedAbi = [
  ...abi,
  {
    anonymous: false,
    inputs: [{ indexed: true, name: "implementation", type: "address" }],
    name: "Upgraded",
    type: "event",
  },
] as const;

const contractAddress = "0x0000000000000000000000000000000000000010" as Address;
const target = createContractTarget({
  chainId: 1,
  contractAddress,
  startBlock: 100n,
});
const catalog = new EventCatalog(abi);

class FakeUpdateRpc implements UpdateRpcClient {
  public blockHashes = new Map<bigint, Hex>();
  public latestBlock = 101n;
  public logs = new Map<bigint, readonly RpcLog[]>();
  #failovers = 0;
  #requests = 0;

  public constructor() {
    for (let block = 90n; block <= 110n; block += 1n) {
      this.blockHashes.set(block, hex32(Number(block % 255n)));
    }
  }

  public cooldownEndpoint(): void {}

  public fetchLogs(
    _address: Address,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<RpcLogsResult> {
    this.#requests += 1;
    const matched: RpcLog[] = [];
    for (let block = fromBlock; block <= toBlock; block += 1n) {
      const blockLogs = this.logs.get(block) ?? [];
      matched.push(...blockLogs);
    }
    return Promise.resolve({
      endpointIdentity: createRpcEndpointIdentity("https://mock-rpc.internal"),
      endpointUrl: "https://mock-rpc.internal",
      logs: Object.freeze(matched),
      range: { fromBlock, toBlock },
    });
  }

  public getBlockHeader(blockNumber: bigint): Promise<RpcBlockHeader> {
    this.#requests += 1;
    const hash = this.blockHashes.get(blockNumber) ?? hex32(0);
    return Promise.resolve({
      hash,
      number: blockNumber,
      parentHash: this.blockHashes.get(blockNumber - 1n) ?? hex32(0),
    });
  }

  public getBlockNumber(): Promise<bigint> {
    this.#requests += 1;
    return Promise.resolve(this.latestBlock);
  }

  public getMetrics(): RpcPoolMetrics {
    return {
      endpointFailovers: this.#failovers,
      requestCount: this.#requests,
    };
  }
}

describe("Event Enrichment (TASK-013)", () => {
  let directory: string;
  let storage: StorageAdapter;
  let rpc: FakeUpdateRpc;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "eventlake-enricher-"));
    storage = createSqliteStorageAdapter(join(directory, "events.db"));
    await storage.initialize();
    await storage.registerTarget({
      abiFingerprint: catalog.abiFingerprint,
      canonicalAbiJson: catalog.canonicalAbiJson,
      target,
    });
    rpc = new FakeUpdateRpc();
    const topics = encodeEventTopics({
      abi,
      args: { owner: "0x0000000000000000000000000000000000000001" },
      eventName: "ValueChanged",
    }) as Hex[];
    const data = encodeAbiParameters([{ type: "uint256" }], [10n]);
    rpc.logs.set(100n, [
      {
        address: contractAddress,
        blockHash: rpc.blockHashes.get(100n)!,
        blockNumber: 100n,
        data,
        logIndex: 0,
        removed: false,
        topics,
        transactionHash: hex32(200),
        transactionIndex: 0,
      },
    ]);
  });

  afterEach(async () => {
    await storage.close();
    await rm(directory, { force: true, recursive: true });
  });

  it("applies synchronous enrichEvent hook and persists additionalData", async () => {
    const enrichEvent: EventEnricher = (event) => {
      expect(event.eventName).toBe("ValueChanged");
      expect(event.blockNumber).toBe(100n);
      return {
        customTag: "sync-enriched",
        doubleValue: 20n,
      };
    };

    const service = new UpdateService({
      catalog,
      enrichEvent,
      rpc,
      rpcPolicy: DEFAULT_RPC_POLICY,
      storage,
      synchronizationPolicy: {
        ...DEFAULT_SYNCHRONIZATION_POLICY,
        confirmations: 0,
      },
      target,
    });

    const result = await service.update({ toBlock: 100n });
    expect(result.storedLogs).toBe(1);

    const queryService = new EventQueryService({ catalog, storage, target });
    const page = await queryService.findMany();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.eventName).toBe("ValueChanged");
    expect(page.items[0]?.additionalData).toEqual({
      customTag: "sync-enriched",
      doubleValue: 20n,
    });
  });

  it("applies asynchronous enrichEvent hook and supports complex JSON with BigInt and arrays", async () => {
    const enrichEvent: EventEnricher = async (event) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        bigNumber: 999999999999999999n,
        meta: {
          items: [1, 2, "three"],
          tx: event.transactionHash,
        },
      };
    };

    const service = new UpdateService({
      catalog,
      enrichEvent,
      rpc,
      rpcPolicy: DEFAULT_RPC_POLICY,
      storage,
      synchronizationPolicy: {
        ...DEFAULT_SYNCHRONIZATION_POLICY,
        confirmations: 0,
      },
      target,
    });

    await service.update({ toBlock: 100n });

    const queryService = new EventQueryService({ catalog, storage, target });
    const first = await queryService.findFirst();
    expect(first).not.toBeNull();
    expect(first?.additionalData).toEqual({
      bigNumber: 999999999999999999n,
      meta: {
        items: [1, 2, "three"],
        tx: hex32(200),
      },
    });
  });

  it("allows overriding enrichEvent in update() call", async () => {
    const defaultEnricher: EventEnricher = () => ({ tag: "default" });
    const overriddenEnricher: EventEnricher = () => ({ tag: "overridden" });

    const service = new UpdateService({
      catalog,
      enrichEvent: defaultEnricher,
      rpc,
      rpcPolicy: DEFAULT_RPC_POLICY,
      storage,
      synchronizationPolicy: {
        ...DEFAULT_SYNCHRONIZATION_POLICY,
        confirmations: 0,
      },
      target,
    });

    await service.update({ enrichEvent: overriddenEnricher, toBlock: 100n });

    const queryService = new EventQueryService({ catalog, storage, target });
    const record = await queryService.findFirst();
    expect(record?.additionalData).toEqual({ tag: "overridden" });
  });

  it("wraps enricher exceptions in EventEnrichmentError and does not commit progress", async () => {
    const failingEnricher: EventEnricher = () => {
      throw new Error("Enricher failed unexpectedly");
    };

    const service = new UpdateService({
      catalog,
      enrichEvent: failingEnricher,
      rpc,
      rpcPolicy: DEFAULT_RPC_POLICY,
      storage,
      synchronizationPolicy: {
        ...DEFAULT_SYNCHRONIZATION_POLICY,
        confirmations: 0,
      },
      target,
    });

    await expect(service.update({ toBlock: 100n })).rejects.toThrow(
      EventEnrichmentError,
    );

    // Verify nothing committed and nextBlock is still 100n
    const state = await storage.getTargetState(target.targetKey);
    expect(state?.nextBlock).toBe(100n);
    const queryService = new EventQueryService({ catalog, storage, target });
    const page = await queryService.findMany();
    expect(page.items).toHaveLength(0);
  });

  it("defaults additionalData to null when enricher returns null or undefined", async () => {
    const service = new UpdateService({
      catalog,
      enrichEvent: () => undefined,
      rpc,
      rpcPolicy: DEFAULT_RPC_POLICY,
      storage,
      synchronizationPolicy: {
        ...DEFAULT_SYNCHRONIZATION_POLICY,
        confirmations: 0,
      },
      target,
    });

    await service.update({ toBlock: 100n });

    const queryService = new EventQueryService({ catalog, storage, target });
    const record = await queryService.findFirst();
    expect(record?.additionalData).toBeNull();
  });

  it("re-enriches logs during redecode() when enrichEvent is provided, and preserves it when omitted", async () => {
    // 1. Initial sync with first enricher
    const service = new UpdateService({
      catalog,
      enrichEvent: () => ({ version: 1 }),
      rpc,
      rpcPolicy: DEFAULT_RPC_POLICY,
      storage,
      synchronizationPolicy: {
        ...DEFAULT_SYNCHRONIZATION_POLICY,
        confirmations: 0,
      },
      target,
    });

    await service.update({ toBlock: 100n });

    const queryService = new EventQueryService({ catalog, storage, target });
    let record = await queryService.findFirst();
    expect(record?.additionalData).toEqual({ version: 1 });

    // 2. Redecode without enrichEvent preserves existing additionalData
    const newCatalog = new EventCatalog(upgradedAbi);
    const redecodeService = new RedecodeService({ storage, target });
    await redecodeService.redecode(newCatalog, {
      abi: upgradedAbi,
      redecodeAll: true,
    });

    record = await queryService.findFirst();
    expect(record?.additionalData).toEqual({ version: 1 });

    // 3. Redecode with new enrichEvent updates additionalData
    await redecodeService.redecode(newCatalog, {
      abi: upgradedAbi,
      enrichEvent: (event) => ({
        redecoded: true,
        sig: event.eventSignature,
        version: 2,
      }),
      redecodeAll: true,
    });

    record = await queryService.findFirst();
    expect(record?.additionalData).toEqual({
      redecoded: true,
      sig: "ValueChanged(address,uint256)",
      version: 2,
    });
  });

  it("operates with 100% parity on IndexedDB storage", async () => {
    const idbStorage = createIndexeddbStorageAdapter("test-idb-enricher");
    await idbStorage.initialize();
    await idbStorage.registerTarget({
      abiFingerprint: catalog.abiFingerprint,
      canonicalAbiJson: catalog.canonicalAbiJson,
      target,
    });

    try {
      const service = new UpdateService({
        catalog,
        enrichEvent: (event) => ({
          browserStorage: "indexeddb",
          tx: event.transactionHash,
        }),
        rpc,
        rpcPolicy: DEFAULT_RPC_POLICY,
        storage: idbStorage,
        synchronizationPolicy: {
          ...DEFAULT_SYNCHRONIZATION_POLICY,
          confirmations: 0,
        },
        target,
      });

      await service.update({ toBlock: 100n });

      const queryService = new EventQueryService({
        catalog,
        storage: idbStorage,
        target,
      });
      const record = await queryService.findFirst();
      expect(record).not.toBeNull();
      expect(record?.additionalData).toEqual({
        browserStorage: "indexeddb",
        tx: record?.transactionHash,
      });
    } finally {
      await idbStorage.close();
    }
  });
});

function hex32(byte: number): Hex {
  return `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;
}
