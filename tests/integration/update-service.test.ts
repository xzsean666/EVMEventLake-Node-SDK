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
  OperationCancelledError,
  ReorgDepthExceededError,
  RpcRequestFailure,
  SynchronizationFailedError,
  UpdateService,
  createContractTarget,
  createRpcEndpointIdentity,
  createSqliteStorageAdapter,
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
const contractAddress = "0x0000000000000000000000000000000000000010" as Address;
const target = createContractTarget({
  chainId: 1,
  contractAddress,
  startBlock: 100n,
});
const catalog = new EventCatalog(abi);

class FakeUpdateRpc implements UpdateRpcClient {
  public blockHashes = new Map<bigint, Hex>();
  public cancelBlock: bigint | null = null;
  public failBlock: bigint | null = null;
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
    if (
      this.cancelBlock !== null &&
      fromBlock <= this.cancelBlock &&
      toBlock >= this.cancelBlock
    ) {
      return Promise.reject(new OperationCancelledError("cancelled by test"));
    }
    if (
      this.failBlock !== null &&
      fromBlock <= this.failBlock &&
      toBlock >= this.failBlock
    ) {
      return Promise.reject(
        new RpcRequestFailure("unavailable", {
          category: "transport",
          endpointUrl: "https://rpc.example",
          method: "eth_getLogs",
        }),
      );
    }
    return Promise.resolve({
      endpointIdentity: createRpcEndpointIdentity("https://rpc.example"),
      endpointUrl: "https://rpc.example/",
      logs: [...this.logs.entries()]
        .filter(([block]) => block >= fromBlock && block <= toBlock)
        .flatMap(([, logs]) => logs),
    });
  }

  public getBlockHeader(blockNumber: bigint): Promise<RpcBlockHeader> {
    this.#requests += 1;
    return Promise.resolve({
      hash: this.blockHashes.get(blockNumber) ?? hex32(250),
      number: blockNumber,
      parentHash: this.blockHashes.get(blockNumber - 1n) ?? hex32(249),
    });
  }

  public getBlockNumber(): Promise<bigint> {
    this.#requests += 1;
    return Promise.resolve(this.latestBlock);
  }

  public getMetrics(): RpcPoolMetrics {
    return { endpointFailovers: this.#failovers, requestCount: this.#requests };
  }
}

describe("UpdateService", () => {
  let adapter: StorageAdapter;
  let directory: string;
  let rpc: FakeUpdateRpc;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "eventlake-update-"));
    adapter = createSqliteStorageAdapter(join(directory, "events.db"));
    await adapter.initialize();
    await adapter.registerTarget({
      abiFingerprint: catalog.abiFingerprint,
      canonicalAbiJson: catalog.canonicalAbiJson,
      target,
    });
    rpc = new FakeUpdateRpc();
  });

  afterEach(async () => {
    await adapter.close();
    await rm(directory, { force: true, recursive: true });
  });

  it("synchronizes, decodes, checkpoints, and resumes as a no-op", async () => {
    rpc.logs.set(100n, [createValueChangedLog(100n, 10n, rpc.blockHashes)]);
    const service = createService(adapter, rpc);

    const result = await service.update({ blockRange: 1, toBlock: 101n });
    expect(result.outcome).toBe("synchronized");
    expect(result.committedRanges).toBe(2);
    expect(result.decodedLogs).toBe(1);
    expect(result.resultingNextBlock).toBe(102n);
    expect((await adapter.getTargetState(target.targetKey))?.nextBlock).toBe(
      102n,
    );

    const noOp = await service.update({ toBlock: 101n });
    expect(noOp.outcome).toBe("no_op");
  });

  it("keeps earlier committed ranges when a later range fails", async () => {
    rpc.logs.set(100n, [createValueChangedLog(100n, 10n, rpc.blockHashes)]);
    rpc.failBlock = 101n;
    const service = createService(adapter, rpc);

    await expect(
      service.update({ blockRange: 1, toBlock: 101n }),
    ).rejects.toBeInstanceOf(SynchronizationFailedError);
    expect((await adapter.getTargetState(target.targetKey))?.nextBlock).toBe(
      101n,
    );
  });

  it("rewinds a mismatched latest checkpoint and replays from the match", async () => {
    const service = createService(adapter, rpc);
    await service.update({ blockRange: 1, toBlock: 101n });
    const originalBlock100Hash = rpc.blockHashes.get(100n) as Hex;
    rpc.blockHashes.set(101n, hex32(220));
    rpc.logs.set(101n, [createValueChangedLog(101n, 99n, rpc.blockHashes)]);

    const result = await service.update({ blockRange: 1, toBlock: 101n });
    expect(result.rewind?.nextBlock).toBe(101n);
    expect(result.resultingNextBlock).toBe(102n);
    expect(rpc.blockHashes.get(100n)).toBe(originalBlock100Hash);
  });

  it("stops when a reorg is deeper than stored checkpoint history", async () => {
    const service = createService(adapter, rpc);
    await service.update({ blockRange: 1, toBlock: 100n });
    rpc.blockHashes.set(100n, hex32(230));

    await expect(service.update({ toBlock: 100n })).rejects.toBeInstanceOf(
      ReorgDepthExceededError,
    );
    expect((await adapter.getTargetState(target.targetKey))?.nextBlock).toBe(
      101n,
    );
  });

  it("returns a cancellation error while preserving earlier ranges", async () => {
    const service = createService(adapter, rpc);
    rpc.cancelBlock = 101n;

    await expect(
      service.update({ blockRange: 1, toBlock: 101n }),
    ).rejects.toMatchObject({
      code: "OPERATION_CANCELLED",
      context: { lastCommittedBlock: "100" },
    });
    expect((await adapter.getTargetState(target.targetKey))?.nextBlock).toBe(
      101n,
    );
  });
});

function createService(
  adapter: StorageAdapter,
  rpc: FakeUpdateRpc,
): UpdateService {
  return new UpdateService({
    catalog,
    dependencies: { createOwnerToken: () => "test-owner" },
    rpc,
    rpcPolicy: { ...DEFAULT_RPC_POLICY, maxRetriesPerEndpoint: 0 },
    storage: adapter,
    synchronizationPolicy: {
      ...DEFAULT_SYNCHRONIZATION_POLICY,
      confirmations: 0,
    },
    target,
  });
}

function createValueChangedLog(
  blockNumber: bigint,
  value: bigint,
  blockHashes: ReadonlyMap<bigint, Hex>,
): RpcLog {
  const owner = "0x0000000000000000000000000000000000000001";
  const topics = encodeEventTopics({
    abi,
    eventName: "ValueChanged",
    args: { owner },
  }) as unknown as readonly Hex[];
  return {
    address: contractAddress,
    blockHash: blockHashes.get(blockNumber) ?? hex32(250),
    blockNumber,
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    logIndex: 0,
    removed: false,
    topics,
    transactionHash: hex32(Number((blockNumber + 1n) % 255n)),
    transactionIndex: 0,
  };
}

function hex32(byte: number): Hex {
  return `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;
}
