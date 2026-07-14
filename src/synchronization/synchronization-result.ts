import type { RewindResult } from "../storage/storage-models.js";
import type { BlockNumberInput } from "../configuration/sdk-options.js";

export interface UpdateOptions {
  readonly blockRange?: number;
  readonly signal?: AbortSignal;
  readonly toBlock?: BlockNumberInput;
}

export interface UpdateRewindResult extends RewindResult {
  readonly rewindFromBlock: bigint;
}

export interface UpdateResult {
  readonly committedRanges: number;
  readonly decodeFailedLogs: number;
  readonly decodedLogs: number;
  readonly duplicateLogs: number;
  readonly durationMs: number;
  readonly endpointFailovers: number;
  readonly fetchedLogs: number;
  readonly fromBlock: bigint;
  readonly outcome: "no_op" | "synchronized";
  readonly preferredRanges: number;
  readonly previousNextBlock: bigint;
  readonly rangeSplits: number;
  readonly resultingNextBlock: bigint;
  readonly rewind: UpdateRewindResult | null;
  readonly rpcRequests: number;
  readonly storedLogs: number;
  readonly toBlock: bigint;
  readonly unknownLogs: number;
}
