import { resolve } from "node:path";

import { getAddress, isAddress, type Abi, type AbiEvent } from "viem";
import { formatAbiItem } from "viem/utils";

import {
  AbiValidationError,
  ConfigurationValidationError,
  UnsupportedDatabaseUrlError,
} from "../errors/evm-event-lake-errors.js";
import {
  DEFAULT_RPC_POLICY,
  DEFAULT_SYNCHRONIZATION_POLICY,
  type DatabaseConfiguration,
  type EVMEventLakeOptions,
  type NormalizedEVMEventLakeOptions,
  type NormalizedRpcPolicy,
  type NormalizedSynchronizationPolicy,
  type RpcPolicyOptions,
  type SynchronizationPolicyOptions,
} from "./sdk-options.js";

function normalizeNonNegativeInteger(
  value: number | undefined,
  defaultValue: number,
  fieldName: string,
): number {
  const normalizedValue = value ?? defaultValue;
  if (!Number.isSafeInteger(normalizedValue) || normalizedValue < 0) {
    throw new ConfigurationValidationError(
      `${fieldName} must be a non-negative safe integer`,
      { context: { field: fieldName, value: normalizedValue } },
    );
  }
  return normalizedValue;
}

function normalizePositiveInteger(
  value: number | undefined,
  defaultValue: number,
  fieldName: string,
): number {
  const normalizedValue = normalizeNonNegativeInteger(
    value,
    defaultValue,
    fieldName,
  );
  if (normalizedValue === 0) {
    throw new ConfigurationValidationError(`${fieldName} must be positive`, {
      context: { field: fieldName, value: normalizedValue },
    });
  }
  return normalizedValue;
}

export function normalizeBlockNumber(
  value: bigint | number,
  fieldName: string,
): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ConfigurationValidationError(
        `${fieldName} must be a non-negative safe integer or bigint`,
        { context: { field: fieldName, value } },
      );
    }
    return BigInt(value);
  }

  if (value < 0n) {
    throw new ConfigurationValidationError(
      `${fieldName} must be non-negative`,
      {
        context: { field: fieldName, value: value.toString() },
      },
    );
  }
  return value;
}

function isWindowsDrivePath(path: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(path);
}

function normalizeSqlitePath(databaseUrl: string): string {
  if (
    databaseUrl === ":memory:" ||
    databaseUrl === "sqlite::memory:" ||
    databaseUrl === "sqlite://:memory:" ||
    databaseUrl === "file::memory:"
  ) {
    return ":memory:";
  }

  let rawLocation = databaseUrl;
  if (rawLocation.startsWith("sqlite:")) {
    rawLocation = rawLocation.slice("sqlite:".length);
  } else if (rawLocation.startsWith("file:")) {
    rawLocation = rawLocation.slice("file:".length);
  }

  if (
    rawLocation === "" ||
    rawLocation.includes("?") ||
    rawLocation.includes("#")
  ) {
    throw new UnsupportedDatabaseUrlError(
      "SQLite URL must contain a file path without query or fragment",
      { context: { database: redactUrl(databaseUrl) } },
    );
  }

  try {
    rawLocation = decodeURI(rawLocation);
  } catch {
    // Keep rawLocation if decodeURI fails on malformed percent encoding
  }

  if (rawLocation.startsWith("//")) {
    rawLocation = rawLocation.slice(2);
  }

  // Windows drive with leading slash (e.g. /C:/data.db or /C:\data.db)
  if (/^\/[a-zA-Z]:[/\\]/.test(rawLocation)) {
    rawLocation = rawLocation.slice(1);
  }

  if (
    rawLocation === "" ||
    rawLocation === "/" ||
    rawLocation === "\\" ||
    rawLocation === "."
  ) {
    throw new UnsupportedDatabaseUrlError(
      "SQLite URL must contain a file path without query or fragment",
      { context: { database: redactUrl(databaseUrl) } },
    );
  }

  if (rawLocation.startsWith("/") || isWindowsDrivePath(rawLocation)) {
    return rawLocation;
  }

  return resolve(process.cwd(), rawLocation);
}

export function parseDatabaseConfiguration(
  databaseUrl: string,
): DatabaseConfiguration {
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
    throw new UnsupportedDatabaseUrlError("database must be a non-empty URL");
  }

  if (
    databaseUrl.startsWith("idb://") ||
    databaseUrl.startsWith("indexeddb://")
  ) {
    const prefix = databaseUrl.startsWith("idb://") ? "idb://" : "indexeddb://";
    const databaseName = databaseUrl.slice(prefix.length);
    if (
      databaseName === "" ||
      databaseName.includes("?") ||
      databaseName.includes("#") ||
      databaseName.includes("/") ||
      databaseName.includes("\\") ||
      databaseName.trim() !== databaseName
    ) {
      throw new UnsupportedDatabaseUrlError(
        "IndexedDB URL must contain a valid database name without path separators, query, or fragment",
        { context: { database: redactUrl(databaseUrl) } },
      );
    }
    return Object.freeze({
      databaseName,
      kind: "indexeddb" as const,
    });
  }

  if (
    databaseUrl === ":memory:" ||
    databaseUrl.startsWith("sqlite:") ||
    databaseUrl.startsWith("file:")
  ) {
    return Object.freeze({
      filename: normalizeSqlitePath(databaseUrl),
      kind: "sqlite" as const,
    });
  }

  const isWindowsAbsolute = isWindowsDrivePath(databaseUrl);
  const isPosixAbsolute = databaseUrl.startsWith("/");
  const isExplicitRelative =
    databaseUrl.startsWith("./") || databaseUrl.startsWith("../");
  const hasUriScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(databaseUrl);

  if (
    isWindowsAbsolute ||
    isPosixAbsolute ||
    isExplicitRelative ||
    !hasUriScheme
  ) {
    return Object.freeze({
      filename: normalizeSqlitePath(databaseUrl),
      kind: "sqlite" as const,
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch (cause) {
    throw new UnsupportedDatabaseUrlError("database is not a valid URL", {
      cause,
      context: { database: redactUrl(databaseUrl) },
    });
  }

  if (
    parsedUrl.protocol !== "postgres:" &&
    parsedUrl.protocol !== "postgresql:"
  ) {
    throw new UnsupportedDatabaseUrlError(
      "database URL must use sqlite, postgres, postgresql, idb, or indexeddb",
      { context: { database: redactUrl(databaseUrl) } },
    );
  }

  return Object.freeze({
    connectionString: databaseUrl,
    kind: "postgresql" as const,
  });
}

export function normalizeRpcUrls(
  rpcUrls: readonly string[],
): readonly string[] {
  if (!Array.isArray(rpcUrls) || rpcUrls.length === 0) {
    throw new ConfigurationValidationError(
      "rpcUrls must contain at least one URL",
    );
  }

  const normalizedUrls: string[] = [];
  const seenUrls = new Set<string>();

  for (const rpcUrlCandidate of rpcUrls as readonly unknown[]) {
    if (typeof rpcUrlCandidate !== "string") {
      throw new ConfigurationValidationError("rpcUrls entries must be strings");
    }
    const rpcUrl = rpcUrlCandidate;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rpcUrl);
    } catch (cause) {
      throw new ConfigurationValidationError(
        "rpcUrls contains an invalid URL",
        {
          cause,
          context: { rpcUrl: redactUrl(rpcUrl) },
        },
      );
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new ConfigurationValidationError(
        "RPC endpoints must use HTTP or HTTPS",
        { context: { rpcUrl: redactUrl(rpcUrl) } },
      );
    }
    if (
      parsedUrl.protocol === "http:" &&
      !isLoopbackHostname(parsedUrl.hostname)
    ) {
      throw new ConfigurationValidationError(
        "RPC endpoints must use HTTPS unless connecting to a loopback host (RPC URLs commonly embed API keys, which HTTP would send in cleartext)",
        { context: { rpcUrl: redactUrl(rpcUrl) } },
      );
    }
    if (parsedUrl.hash !== "") {
      throw new ConfigurationValidationError(
        "RPC endpoint URL must not contain a fragment",
        { context: { rpcUrl: redactUrl(rpcUrl) } },
      );
    }

    const normalizedUrl = parsedUrl.toString();
    if (!seenUrls.has(normalizedUrl)) {
      normalizedUrls.push(normalizedUrl);
      seenUrls.add(normalizedUrl);
    }
  }

  return Object.freeze(normalizedUrls);
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function normalizeSynchronizationPolicy(
  policy: SynchronizationPolicyOptions = {},
): NormalizedSynchronizationPolicy {
  const normalizedPolicy = {
    confirmations: normalizeNonNegativeInteger(
      policy.confirmations,
      DEFAULT_SYNCHRONIZATION_POLICY.confirmations,
      "synchronization.confirmations",
    ),
    defaultBlockRange: normalizePositiveInteger(
      policy.defaultBlockRange,
      DEFAULT_SYNCHRONIZATION_POLICY.defaultBlockRange,
      "synchronization.defaultBlockRange",
    ),
    leaseDurationMs: normalizePositiveInteger(
      policy.leaseDurationMs,
      DEFAULT_SYNCHRONIZATION_POLICY.leaseDurationMs,
      "synchronization.leaseDurationMs",
    ),
    minimumBlockRange: normalizePositiveInteger(
      policy.minimumBlockRange,
      DEFAULT_SYNCHRONIZATION_POLICY.minimumBlockRange,
      "synchronization.minimumBlockRange",
    ),
    reorgCheckDepth: normalizePositiveInteger(
      policy.reorgCheckDepth,
      DEFAULT_SYNCHRONIZATION_POLICY.reorgCheckDepth,
      "synchronization.reorgCheckDepth",
    ),
  };

  if (normalizedPolicy.minimumBlockRange > normalizedPolicy.defaultBlockRange) {
    throw new ConfigurationValidationError(
      "synchronization.minimumBlockRange cannot exceed defaultBlockRange",
    );
  }

  return Object.freeze(normalizedPolicy);
}

function normalizeRpcPolicy(
  policy: RpcPolicyOptions = {},
): NormalizedRpcPolicy {
  return Object.freeze({
    batchSize: normalizePositiveInteger(
      policy.batchSize,
      DEFAULT_RPC_POLICY.batchSize,
      "rpc.batchSize",
    ),
    endpointCooldownMs: normalizePositiveInteger(
      policy.endpointCooldownMs,
      DEFAULT_RPC_POLICY.endpointCooldownMs,
      "rpc.endpointCooldownMs",
    ),
    maximumTimeoutSplitsPerRange: normalizePositiveInteger(
      policy.maximumTimeoutSplitsPerRange,
      DEFAULT_RPC_POLICY.maximumTimeoutSplitsPerRange,
      "rpc.maximumTimeoutSplitsPerRange",
    ),
    maxRetriesPerEndpoint: normalizeNonNegativeInteger(
      policy.maxRetriesPerEndpoint,
      DEFAULT_RPC_POLICY.maxRetriesPerEndpoint,
      "rpc.maxRetriesPerEndpoint",
    ),
    requestTimeoutMs: normalizePositiveInteger(
      policy.requestTimeoutMs,
      DEFAULT_RPC_POLICY.requestTimeoutMs,
      "rpc.requestTimeoutMs",
    ),
  });
}

function validateAbi(abi: Abi): Abi {
  if (!Array.isArray(abi)) {
    throw new AbiValidationError("abi must be an array");
  }

  const events: AbiEvent[] = [];
  for (const item of abi as readonly unknown[]) {
    if (
      item !== null &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "event"
    ) {
      events.push(item as AbiEvent);
    }
  }
  if (events.length === 0) {
    throw new AbiValidationError("abi must contain at least one event");
  }

  try {
    for (const event of events) {
      formatAbiItem(event);
    }
  } catch (cause) {
    throw new AbiValidationError("abi contains an invalid event definition", {
      cause,
    });
  }

  return deepFreeze(structuredClone(abi) as Abi);
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
  }
  return value;
}

export function validateSdkOptions(
  options: EVMEventLakeOptions,
): NormalizedEVMEventLakeOptions {
  if (options === null || typeof options !== "object") {
    throw new ConfigurationValidationError("SDK options must be an object");
  }
  if (!Number.isSafeInteger(options.chainId) || options.chainId <= 0) {
    throw new ConfigurationValidationError(
      "chainId must be a positive integer",
      {
        context: { chainId: options.chainId },
      },
    );
  }
  if (!isAddress(options.contractAddress, { strict: false })) {
    throw new ConfigurationValidationError(
      "contractAddress must be a valid EVM address",
      { context: { contractAddress: options.contractAddress } },
    );
  }

  return Object.freeze({
    abi: validateAbi(options.abi),
    chainId: options.chainId,
    contractAddress: getAddress(
      options.contractAddress,
    ).toLowerCase() as `0x${string}`,
    database: parseDatabaseConfiguration(options.database),
    observability: Object.freeze({ ...(options.observability ?? {}) }),
    rpc: normalizeRpcPolicy(options.rpc),
    rpcUrls: normalizeRpcUrls(options.rpcUrls),
    startBlock: normalizeBlockNumber(options.startBlock, "startBlock"),
    synchronization: normalizeSynchronizationPolicy(options.synchronization),
  });
}

export function redactUrl(rawUrl: string): string {
  if (
    rawUrl === ":memory:" ||
    rawUrl === "sqlite::memory:" ||
    rawUrl === "sqlite://:memory:" ||
    rawUrl === "file::memory:"
  ) {
    return rawUrl;
  }
  try {
    const parsedUrl = new URL(rawUrl);
    parsedUrl.username = "";
    parsedUrl.password = "";
    if (parsedUrl.pathname !== "/" && parsedUrl.pathname !== "") {
      parsedUrl.pathname = "/redacted";
    }
    parsedUrl.search = "";
    parsedUrl.hash = "";
    return parsedUrl.toString();
  } catch {
    return "<invalid-url>";
  }
}
