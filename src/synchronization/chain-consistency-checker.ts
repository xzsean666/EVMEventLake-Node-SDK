import type { RpcBlockHeader } from "../rpc/rpc-pool.js";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type {
  RewindResult,
  SyncCheckpoint,
} from "../storage/storage-models.js";
import { ReorgDepthExceededError } from "../errors/evm-event-lake-errors.js";

export interface ChainConsistencyRpcClient {
  getBlockHeader(
    blockNumber: bigint,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RpcBlockHeader>;
}

export interface ChainConsistencyResult {
  readonly checked: boolean;
  readonly rewind: RewindResult | null;
  readonly rewindFromBlock: bigint | null;
}

export async function ensureChainConsistency(input: {
  readonly beforeRequest?: () => Promise<void>;
  readonly reorgCheckDepth: number;
  readonly rpc: ChainConsistencyRpcClient;
  readonly signal?: AbortSignal;
  readonly storage: StorageAdapter;
  readonly targetKey: string;
}): Promise<ChainConsistencyResult> {
  const checkpoints = await input.storage.getRecentCheckpoints(
    input.targetKey,
    input.reorgCheckDepth,
  );
  if (checkpoints.length === 0) {
    return Object.freeze({
      checked: false,
      rewind: null,
      rewindFromBlock: null,
    });
  }

  const latestCheckpoint = checkpoints[0] as SyncCheckpoint;
  if (
    await checkpointMatches(
      input.rpc,
      latestCheckpoint,
      input.signal,
      input.beforeRequest,
    )
  ) {
    return Object.freeze({
      checked: true,
      rewind: null,
      rewindFromBlock: null,
    });
  }

  for (const checkpoint of checkpoints.slice(1)) {
    if (
      await checkpointMatches(
        input.rpc,
        checkpoint,
        input.signal,
        input.beforeRequest,
      )
    ) {
      const rewind = await input.storage.rewind(
        input.targetKey,
        checkpoint.blockNumber,
      );
      return Object.freeze({
        checked: true,
        rewind,
        rewindFromBlock: latestCheckpoint.blockNumber,
      });
    }
  }

  throw new ReorgDepthExceededError(
    "No matching chain checkpoint was found inside reorgCheckDepth",
    {
      context: {
        newestCheckpoint: latestCheckpoint.blockNumber.toString(),
        reorgCheckDepth: input.reorgCheckDepth,
        targetKey: input.targetKey,
      },
    },
  );
}

async function checkpointMatches(
  rpc: ChainConsistencyRpcClient,
  checkpoint: SyncCheckpoint,
  signal: AbortSignal | undefined,
  beforeRequest: (() => Promise<void>) | undefined,
): Promise<boolean> {
  await beforeRequest?.();
  const block = await rpc.getBlockHeader(
    checkpoint.blockNumber,
    signal === undefined ? {} : { signal },
  );
  return block.hash.toLowerCase() === checkpoint.blockHash.toLowerCase();
}
