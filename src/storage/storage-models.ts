import { createHash } from "node:crypto";

import type { Address, Hex } from "viem";

import type { DecodedEventParameter } from "../abi/event-decoder.js";
import type { ContractTarget } from "../contract-target/contract-target.js";

export type StoredDecodeStatus = "decode_failed" | "decoded" | "unknown";

export interface StoredEventLog {
  readonly abiFingerprint: string;
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly contractAddress: Address;
  readonly data: Hex;
  readonly decodedArguments: string | null;
  readonly decodeStatus: StoredDecodeStatus;
  readonly eventId: string;
  readonly eventName: string | null;
  readonly eventSignature: string | null;
  readonly logIndex: number;
  readonly parameters: readonly DecodedEventParameter[];
  readonly removed: boolean;
  readonly targetKey: string;
  readonly topics: readonly Hex[];
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
}

export interface StoredEventQuery {
  readonly after?: StoredEventQueryCursor;
  readonly blockNumber?: bigint;
  readonly decodeStatus?: StoredDecodeStatus;
  readonly eventName?: string;
  readonly eventSignature?: string;
  readonly fromBlock?: bigint;
  readonly indexedParameters?: readonly StoredIndexedParameterFilter[];
  readonly limit: number;
  readonly order: "ascending" | "descending";
  readonly targetKey: string;
  readonly toBlock?: bigint;
  readonly transactionHash?: Hex;
  readonly unindexedParameters?: readonly StoredParameterFilter[];
}

export interface StoredParameterFilter {
  readonly comparableValue: string;
  readonly name: string;
}

export type StoredIndexedParameterFilter = StoredParameterFilter;

export interface StoredEventQueryCursor {
  readonly blockNumber: bigint;
  readonly eventId: string;
  readonly logIndex: number;
  readonly transactionIndex: number;
}

export interface TargetRegistration {
  readonly abiFingerprint: string;
  readonly canonicalAbiJson: string;
  readonly target: ContractTarget;
}

export interface TargetState {
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

export interface SyncCheckpoint {
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly committedAt: string;
  readonly targetKey: string;
}

export interface CommitRangeRequest {
  readonly abiFingerprint: string;
  readonly endBlockHash: Hex;
  readonly fromBlock: bigint;
  readonly logs: readonly StoredEventLog[];
  readonly targetKey: string;
  readonly toBlock: bigint;
}

export interface CommitRangeResult {
  readonly duplicateLogs: number;
  readonly insertedLogs: number;
}

export interface RewindResult {
  readonly deletedLogs: number;
  readonly nextBlock: bigint;
}

export interface RedecodeCursor {
  readonly blockNumber: bigint;
  readonly logIndex: number;
}

export interface CountLogsForRedecodeRequest {
  readonly fromBlock?: bigint;
  readonly redecodeAll?: boolean;
  readonly targetKey: string;
  readonly toBlock?: bigint;
}

export interface GetLogsForRedecodeRequest {
  readonly after?: RedecodeCursor;
  readonly fromBlock?: bigint;
  readonly limit: number;
  readonly redecodeAll?: boolean;
  readonly targetKey: string;
  readonly toBlock?: bigint;
}

export interface UpdateDecodedLogsRequest {
  readonly logs: readonly StoredEventLog[];
  readonly targetKey: string;
}

export interface UpdateDecodedLogsResult {
  readonly updatedLogs: number;
}

export function createStoredEventId(input: {
  readonly blockHash: Hex;
  readonly logIndex: number;
  readonly targetKey: string;
  readonly transactionHash: Hex;
}): string {
  const identity = [
    input.targetKey,
    input.blockHash.toLowerCase(),
    input.transactionHash.toLowerCase(),
    input.logIndex.toString(),
  ].join("|");
  return createHash("sha256").update(identity).digest("hex");
}

export function blockNumberToStorageKey(blockNumber: bigint): string {
  if (blockNumber < 0n) {
    throw new RangeError("Block number must be non-negative");
  }
  return blockNumber.toString().padStart(78, "0");
}

export function storageKeyToBlockNumber(storageKey: string): bigint {
  return BigInt(storageKey);
}
