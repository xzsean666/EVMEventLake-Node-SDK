import { resolve } from "node:path";

import {
  getAddress,
  isAddress,
  padHex,
  toHex,
  type Abi,
  type AbiEvent,
  type Hex,
} from "viem";
import { formatAbiItem } from "viem/utils";

import {
  AbiValidationError,
  ConfigurationValidationError,
  UnsupportedDatabaseUrlError,
} from "../errors/evm-event-lake-errors.js";
import {
  DEFAULT_RPC_POLICY,
  DEFAULT_SYNCHRONIZATION_POLICY,
  type DataRetentionOptions,
  type DatabaseConfiguration,
  type EVMEventLakeOptions,
  type LogTopicsFilter,
  type NormalizedEVMEventLakeOptions,
  type NormalizedRpcPolicy,
  type NormalizedRpcTopic,
  type NormalizedRpcTopics,
  type NormalizedSynchronizationPolicy,
  type RpcPolicyOptions,
  type SynchronizationPolicyOptions,
  type TopicFilterObject,
  type TopicFilterValue,
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

const TOPIC_HEX_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_HEX_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function encodeBigIntTopic(val: bigint, contextPath: string): Hex {
  if (val >= 0n) {
    if (val >= 1n << 256n) {
      throw new ConfigurationValidationError(
        `${contextPath} bigint value exceeds 256 bits`,
        { context: { field: contextPath, value: val.toString() } },
      );
    }
    return toHex(val, { size: 32 });
  }
  // Signed integer (two's complement for 256 bits)
  const minInt256 = -(1n << 255n);
  if (val < minInt256) {
    throw new ConfigurationValidationError(
      `${contextPath} negative bigint value exceeds 256-bit signed integer range`,
      { context: { field: contextPath, value: val.toString() } },
    );
  }
  const twosComplement = (1n << 256n) + val;
  return toHex(twosComplement, { size: 32 });
}

function normalizeSingleTopic(value: unknown, contextPath: string): Hex {
  if (typeof value === "boolean") {
    return toHex(value, { size: 32 });
  }

  if (typeof value === "bigint") {
    return encodeBigIntTopic(value, contextPath);
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new ConfigurationValidationError(
        `${contextPath} number must be a safe integer`,
        { context: { field: contextPath, value } },
      );
    }
    return encodeBigIntTopic(BigInt(value), contextPath);
  }

  if (typeof value === "string") {
    if (TOPIC_HEX_PATTERN.test(value)) {
      return value.toLowerCase() as Hex;
    }
    if (ADDRESS_HEX_PATTERN.test(value)) {
      return padHex(value.toLowerCase() as Hex, { size: 32, dir: "left" });
    }
    throw new ConfigurationValidationError(
      `${contextPath} must be a valid 32-byte hex topic, 20-byte address, number, bigint, or boolean (received "${value}")`,
      { context: { field: contextPath, value } },
    );
  }

  throw new ConfigurationValidationError(
    `${contextPath} must be a 32-byte hex string, 20-byte address, number, bigint, or boolean`,
    { context: { field: contextPath, value } },
  );
}

function normalizeTopicEntry(
  item: unknown,
  contextPath: string,
): NormalizedRpcTopic {
  if (item === null || item === undefined) {
    return null;
  }
  if (
    typeof item === "string" ||
    typeof item === "bigint" ||
    typeof item === "number" ||
    typeof item === "boolean"
  ) {
    return normalizeSingleTopic(item, contextPath);
  }
  if (Array.isArray(item)) {
    const itemArray: readonly unknown[] = item;
    if (itemArray.length === 0) {
      throw new ConfigurationValidationError(
        `${contextPath} array cannot be empty`,
        { context: { field: contextPath } },
      );
    }
    const normalizedList: Hex[] = [];
    for (let j = 0; j < itemArray.length; j++) {
      const subItem = itemArray[j];
      if (subItem === null || subItem === undefined) {
        throw new ConfigurationValidationError(
          `${contextPath}[${j}] inside an OR topic array cannot be null or undefined`,
          { context: { field: `${contextPath}[${j}]` } },
        );
      }
      normalizedList.push(
        normalizeSingleTopic(subItem, `${contextPath}[${j}]`),
      );
    }
    return Object.freeze(normalizedList);
  }
  throw new ConfigurationValidationError(
    `${contextPath} has invalid topic format`,
    { context: { field: contextPath, value: item } },
  );
}

export interface TopicFilterOptionsInput {
  readonly topic0?: TopicFilterValue | undefined;
  readonly topic1?: TopicFilterValue | undefined;
  readonly topic2?: TopicFilterValue | undefined;
  readonly topic3?: TopicFilterValue | undefined;
  readonly topics?: LogTopicsFilter | null | undefined;
}

export function normalizeTopicsFilter(
  input?: LogTopicsFilter | null,
  topLevel?: TopicFilterOptionsInput,
): NormalizedRpcTopics | undefined {
  if (input === null) {
    return undefined;
  }

  let effectiveInput: LogTopicsFilter | undefined = input ?? undefined;
  if (effectiveInput === undefined) {
    if (topLevel?.topics !== undefined) {
      if (topLevel.topics === null) {
        return undefined;
      }
      effectiveInput = topLevel.topics;
    } else if (
      topLevel?.topic0 !== undefined ||
      topLevel?.topic1 !== undefined ||
      topLevel?.topic2 !== undefined ||
      topLevel?.topic3 !== undefined
    ) {
      effectiveInput = {
        ...(topLevel.topic0 !== undefined ? { topic0: topLevel.topic0 } : {}),
        ...(topLevel.topic1 !== undefined ? { topic1: topLevel.topic1 } : {}),
        ...(topLevel.topic2 !== undefined ? { topic2: topLevel.topic2 } : {}),
        ...(topLevel.topic3 !== undefined ? { topic3: topLevel.topic3 } : {}),
      };
    } else {
      return undefined;
    }
  }

  let rawList: readonly unknown[];

  if (Array.isArray(effectiveInput)) {
    if (effectiveInput.length > 4) {
      throw new ConfigurationValidationError(
        "topics filter cannot contain more than 4 topics (topic0..topic3)",
        { context: { length: effectiveInput.length } },
      );
    }
    rawList = effectiveInput;
  } else if (typeof effectiveInput === "object" && effectiveInput !== null) {
    for (const key of Object.keys(effectiveInput)) {
      if (
        key !== "topic0" &&
        key !== "topic1" &&
        key !== "topic2" &&
        key !== "topic3"
      ) {
        throw new ConfigurationValidationError(
          `Unrecognized topic key "${key}", expected topic0, topic1, topic2, or topic3`,
          { context: { key } },
        );
      }
    }
    const obj = effectiveInput as TopicFilterObject;
    rawList = [
      obj.topic0 ?? topLevel?.topic0,
      obj.topic1 ?? topLevel?.topic1,
      obj.topic2 ?? topLevel?.topic2,
      obj.topic3 ?? topLevel?.topic3,
    ];
  } else {
    throw new ConfigurationValidationError(
      "topics filter must be an array or an object with topic0..topic3 properties",
      { context: { topics: effectiveInput } },
    );
  }

  const normalized: NormalizedRpcTopic[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    normalized.push(normalizeTopicEntry(item, `topics[${i}]`));
  }

  while (normalized.length > 0 && normalized[normalized.length - 1] === null) {
    normalized.pop();
  }

  if (normalized.length === 0) {
    return undefined;
  }

  return Object.freeze(normalized);
}

export function matchesTopicFilter(
  logTopics: readonly Hex[],
  filterTopics: NormalizedRpcTopics | undefined,
): boolean {
  if (filterTopics === undefined || filterTopics.length === 0) {
    return true;
  }
  for (let i = 0; i < filterTopics.length; i++) {
    const filterItem = filterTopics[i];
    if (filterItem === null || filterItem === undefined) {
      continue;
    }
    const logTopic = logTopics[i];
    if (logTopic === undefined) {
      return false;
    }
    if (typeof filterItem === "string") {
      if (filterItem.toLowerCase() !== logTopic.toLowerCase()) {
        return false;
      }
    } else if (Array.isArray(filterItem)) {
      const match = filterItem.some(
        (candidate: string) =>
          candidate.toLowerCase() === logTopic.toLowerCase(),
      );
      if (!match) return false;
    }
  }
  return true;
}

export function normalizeDataRetention(
  retention?: DataRetentionOptions,
): DataRetentionOptions {
  if (retention === undefined || retention === null) {
    return Object.freeze({ enabled: false });
  }
  if (typeof retention !== "object") {
    throw new ConfigurationValidationError("retention must be an object");
  }

  const enabled = retention.enabled === true;
  if (!enabled) {
    return Object.freeze({ enabled: false });
  }

  let maxBlocks: bigint | undefined;
  if (retention.maxBlocks !== undefined) {
    maxBlocks = normalizeBlockNumber(
      retention.maxBlocks,
      "retention.maxBlocks",
    );
    if (maxBlocks === 0n) {
      throw new ConfigurationValidationError(
        "retention.maxBlocks must be positive",
        {
          context: {
            field: "retention.maxBlocks",
            value: maxBlocks.toString(),
          },
        },
      );
    }
  }

  let maxEvents: number | undefined;
  if (retention.maxEvents !== undefined) {
    maxEvents = normalizePositiveInteger(
      retention.maxEvents,
      0,
      "retention.maxEvents",
    );
  }

  const pruneOnUpdate = retention.pruneOnUpdate ?? true;

  return Object.freeze({
    enabled: true,
    ...(maxBlocks !== undefined ? { maxBlocks } : {}),
    ...(maxEvents !== undefined ? { maxEvents } : {}),
    pruneOnUpdate,
  });
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
  if (
    options.enrichEvent !== undefined &&
    typeof options.enrichEvent !== "function"
  ) {
    throw new ConfigurationValidationError("enrichEvent must be a function", {
      context: { enrichEvent: typeof options.enrichEvent },
    });
  }

  const topics = normalizeTopicsFilter(options.topics, options);

  return Object.freeze({
    abi: validateAbi(options.abi),
    chainId: options.chainId,
    contractAddress: getAddress(
      options.contractAddress,
    ).toLowerCase() as `0x${string}`,
    database: parseDatabaseConfiguration(options.database),
    ...(options.enrichEvent === undefined
      ? {}
      : { enrichEvent: options.enrichEvent }),
    observability: Object.freeze({ ...(options.observability ?? {}) }),
    retention: normalizeDataRetention(options.retention),
    rpc: normalizeRpcPolicy(options.rpc),
    rpcUrls: normalizeRpcUrls(options.rpcUrls),
    startBlock: normalizeBlockNumber(options.startBlock, "startBlock"),
    synchronization: normalizeSynchronizationPolicy(options.synchronization),
    ...(topics === undefined ? {} : { topics }),
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
