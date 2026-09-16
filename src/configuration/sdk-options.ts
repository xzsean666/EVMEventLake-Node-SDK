import type { Abi, Address, Hex } from "viem";

import type {
  SdkLogger,
  UpdateProgressCallback,
} from "../observability/sdk-logger.js";
import type { EventDecodeStatus } from "../query/event-query.js";

export type BlockNumberInput = bigint | number;

export interface EventEnrichmentContext {
  readonly abiFingerprint: string;
  readonly arguments: unknown;
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly data: Hex;
  readonly decodeStatus: EventDecodeStatus;
  readonly eventId: string;
  readonly eventName: string | null;
  readonly eventSignature: string | null;
  readonly logIndex: number;
  readonly removed: boolean;
  readonly topics: readonly Hex[];
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
}

export type EventEnricher = (context: EventEnrichmentContext) => unknown;

export interface SynchronizationPolicyOptions {
  readonly confirmations?: number;
  readonly defaultBlockRange?: number;
  readonly leaseDurationMs?: number;
  readonly minimumBlockRange?: number;
  readonly reorgCheckDepth?: number;
}

export type TopicFilterPrimitive = Hex | bigint | number | boolean;

export type TopicFilterValue =
  TopicFilterPrimitive | readonly TopicFilterPrimitive[] | null;

export interface TopicFilterObject {
  readonly topic0?: TopicFilterValue | undefined;
  readonly topic1?: TopicFilterValue | undefined;
  readonly topic2?: TopicFilterValue | undefined;
  readonly topic3?: TopicFilterValue | undefined;
}

export type TopicFilterArray = readonly (TopicFilterValue | undefined)[];

export type LogTopicsFilter = TopicFilterArray | TopicFilterObject;

export type NormalizedRpcTopic = Hex | readonly Hex[] | null;

export type NormalizedRpcTopics = readonly NormalizedRpcTopic[];

export interface RpcPolicyOptions {
  readonly batchSize?: number;
  readonly endpointCooldownMs?: number;
  readonly maximumTimeoutSplitsPerRange?: number;
  readonly maxRetriesPerEndpoint?: number;
  readonly requestTimeoutMs?: number;
}

export interface ObservabilityOptions {
  readonly logger?: SdkLogger;
  readonly onProgress?: UpdateProgressCallback;
}

export interface EVMEventLakeOptions {
  readonly abi: Abi;
  readonly chainId: number;
  readonly contractAddress: string;
  readonly database: string;
  readonly enrichEvent?: EventEnricher;
  readonly observability?: ObservabilityOptions;
  readonly rpc?: RpcPolicyOptions;
  readonly rpcUrls: readonly string[];
  readonly startBlock: BlockNumberInput;
  readonly synchronization?: SynchronizationPolicyOptions;
  readonly topic0?: TopicFilterValue | undefined;
  readonly topic1?: TopicFilterValue | undefined;
  readonly topic2?: TopicFilterValue | undefined;
  readonly topic3?: TopicFilterValue | undefined;
  readonly topics?: LogTopicsFilter | undefined;
}

export interface SqliteDatabaseConfiguration {
  readonly filename: string;
  readonly kind: "sqlite";
}

export interface PostgresqlDatabaseConfiguration {
  readonly connectionString: string;
  readonly kind: "postgresql";
}

export interface IndexeddbDatabaseConfiguration {
  readonly databaseName: string;
  readonly kind: "indexeddb";
}

export type DatabaseConfiguration =
  | IndexeddbDatabaseConfiguration
  | PostgresqlDatabaseConfiguration
  | SqliteDatabaseConfiguration;

export interface NormalizedSynchronizationPolicy {
  readonly confirmations: number;
  readonly defaultBlockRange: number;
  readonly leaseDurationMs: number;
  readonly minimumBlockRange: number;
  readonly reorgCheckDepth: number;
}

export interface NormalizedRpcPolicy {
  readonly batchSize: number;
  readonly endpointCooldownMs: number;
  readonly maximumTimeoutSplitsPerRange: number;
  readonly maxRetriesPerEndpoint: number;
  readonly requestTimeoutMs: number;
}

export interface NormalizedEVMEventLakeOptions {
  readonly abi: Abi;
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly database: DatabaseConfiguration;
  readonly enrichEvent?: EventEnricher;
  readonly observability: Readonly<ObservabilityOptions>;
  readonly rpc: NormalizedRpcPolicy;
  readonly rpcUrls: readonly string[];
  readonly startBlock: bigint;
  readonly synchronization: NormalizedSynchronizationPolicy;
  readonly topics?: NormalizedRpcTopics | undefined;
}

export const DEFAULT_SYNCHRONIZATION_POLICY: NormalizedSynchronizationPolicy =
  Object.freeze({
    confirmations: 12,
    defaultBlockRange: 2_000,
    leaseDurationMs: 60_000,
    minimumBlockRange: 1,
    reorgCheckDepth: 20,
  });

export const DEFAULT_RPC_POLICY: NormalizedRpcPolicy = Object.freeze({
  batchSize: 1,
  endpointCooldownMs: 30_000,
  maximumTimeoutSplitsPerRange: 2,
  maxRetriesPerEndpoint: 2,
  requestTimeoutMs: 20_000,
});
