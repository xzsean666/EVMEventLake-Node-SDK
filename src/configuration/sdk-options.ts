import type { Abi, Address } from "viem";

import type {
  SdkLogger,
  UpdateProgressCallback,
} from "../observability/sdk-logger.js";

export type BlockNumberInput = bigint | number;

export interface SynchronizationPolicyOptions {
  readonly confirmations?: number;
  readonly defaultBlockRange?: number;
  readonly leaseDurationMs?: number;
  readonly minimumBlockRange?: number;
  readonly reorgCheckDepth?: number;
}

export interface RpcPolicyOptions {
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
  readonly observability?: ObservabilityOptions;
  readonly rpc?: RpcPolicyOptions;
  readonly rpcUrls: readonly string[];
  readonly startBlock: BlockNumberInput;
  readonly synchronization?: SynchronizationPolicyOptions;
}

export interface SqliteDatabaseConfiguration {
  readonly filename: string;
  readonly kind: "sqlite";
}

export interface PostgresqlDatabaseConfiguration {
  readonly connectionString: string;
  readonly kind: "postgresql";
}

export type DatabaseConfiguration =
  PostgresqlDatabaseConfiguration | SqliteDatabaseConfiguration;

export interface NormalizedSynchronizationPolicy {
  readonly confirmations: number;
  readonly defaultBlockRange: number;
  readonly leaseDurationMs: number;
  readonly minimumBlockRange: number;
  readonly reorgCheckDepth: number;
}

export interface NormalizedRpcPolicy {
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
  readonly observability: Readonly<ObservabilityOptions>;
  readonly rpc: NormalizedRpcPolicy;
  readonly rpcUrls: readonly string[];
  readonly startBlock: bigint;
  readonly synchronization: NormalizedSynchronizationPolicy;
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
  endpointCooldownMs: 30_000,
  maximumTimeoutSplitsPerRange: 2,
  maxRetriesPerEndpoint: 2,
  requestTimeoutMs: 20_000,
});
