import type { Address, Hex } from "viem";

export interface SyncCheckpoint {
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly committedAt: string;
  readonly targetKey: string;
}

export interface SyncStatus {
  readonly activeAbiFingerprint: string;
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly createdAt: string;
  readonly hasActiveLease: boolean;
  readonly latestCheckpoint: SyncCheckpoint | null;
  readonly nextBlock: bigint;
  readonly startBlock: bigint;
  readonly syncedThroughBlock: bigint | null;
  readonly targetKey: string;
  readonly updatedAt: string;
}
