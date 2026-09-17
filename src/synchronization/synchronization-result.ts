import type {
  BlockNumberInput,
  EventEnricher,
  LogTopicsFilter,
  TopicFilterValue,
} from "../configuration/sdk-options.js";

export interface UpdateOptions {
  readonly blockRange?: number | undefined;
  readonly enrichEvent?: EventEnricher | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly toBlock?: BlockNumberInput | undefined;
  readonly topic0?: TopicFilterValue | undefined;
  readonly topic1?: TopicFilterValue | undefined;
  readonly topic2?: TopicFilterValue | undefined;
  readonly topic3?: TopicFilterValue | undefined;
  readonly topics?: LogTopicsFilter | undefined;
}

export interface UpdateRewindResult {
  readonly deletedLogs: number;
  readonly nextBlock: bigint;
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
  readonly prunedLogs?: number | undefined;
  readonly rangeSplits: number;
  readonly resultingNextBlock: bigint;
  readonly rewind: UpdateRewindResult | null;
  readonly rpcRequests: number;
  readonly storedLogs: number;
  readonly toBlock: bigint;
  readonly unknownLogs: number;
}
