import {
  getAddress,
  isAddress,
  isHex,
  keccak256,
  stringToBytes,
  type Hex,
} from "viem";

import {
  decodeDecodedValue,
  encodeDecodedValue,
} from "../abi/decoded-value-codec.js";
import type {
  EventCatalog,
  EventDefinition,
  EventInputDefinition,
} from "../abi/event-catalog.js";
import { normalizeBlockNumber } from "../configuration/validate-sdk-options.js";
import type { ContractTarget } from "../contract-target/contract-target.js";
import { QueryValidationError } from "../errors/evm-event-lake-errors.js";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type {
  StoredEventLog,
  StoredEventQuery,
  StoredIndexedParameterFilter,
} from "../storage/storage-models.js";
import type {
  EventPage,
  EventQuery,
  EventQueryWhere,
  EventRecord,
} from "./event-query.js";
import { decodeQueryCursor, encodeQueryCursor } from "./query-cursor.js";

const DEFAULT_QUERY_LIMIT = 100;
const MAXIMUM_QUERY_LIMIT = 1_000;

export class EventQueryService {
  #catalog: EventCatalog;
  readonly #storage: StorageAdapter;
  readonly #target: ContractTarget;

  public constructor(input: {
    readonly catalog: EventCatalog;
    readonly storage: StorageAdapter;
    readonly target: ContractTarget;
  }) {
    this.#catalog = input.catalog;
    this.#storage = input.storage;
    this.#target = input.target;
  }

  public get catalog(): EventCatalog {
    return this.#catalog;
  }

  public setCatalog(catalog: EventCatalog): void {
    this.#catalog = catalog;
  }

  public async findMany(query: EventQuery = {}): Promise<EventPage> {
    const normalized = this.#normalizeQuery(query);
    const rows = await this.#storage.queryEvents({
      ...normalized,
      limit: normalized.limit + 1,
    });
    const hasNextPage = rows.length > normalized.limit;
    const pageRows = rows.slice(0, normalized.limit);
    const items = Object.freeze(pageRows.map((row) => this.#mapEvent(row)));
    const lastRow = pageRows.at(-1);
    return Object.freeze({
      items,
      nextCursor:
        hasNextPage && lastRow !== undefined
          ? encodeQueryCursor({
              cursor: {
                blockNumber: lastRow.blockNumber,
                eventId: lastRow.eventId,
                logIndex: lastRow.logIndex,
                transactionIndex: lastRow.transactionIndex,
              },
              order: normalized.order,
              targetKey: this.#target.targetKey,
            })
          : null,
    });
  }

  public async findFirst(query: EventQuery = {}): Promise<EventRecord | null> {
    const page = await this.findMany({ ...query, limit: 1 });
    return page.items[0] ?? null;
  }

  #normalizeQuery(query: EventQuery): StoredEventQuery {
    const order = query.order ?? "ascending";
    if (order !== "ascending" && order !== "descending") {
      throw new QueryValidationError(
        "Query order must be ascending or descending",
      );
    }
    const limit = query.limit ?? DEFAULT_QUERY_LIMIT;
    if (
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      limit > MAXIMUM_QUERY_LIMIT
    ) {
      throw new QueryValidationError(
        `Query limit must be between 1 and ${MAXIMUM_QUERY_LIMIT}`,
      );
    }

    const where = query.where ?? {};
    const blockFilter = normalizeBlockFilter(where.blockNumber);
    const eventName = normalizeOptionalNonEmpty(where.eventName, "eventName");
    const eventSignature = normalizeOptionalNonEmpty(
      where.eventSignature,
      "eventSignature",
    );
    if (
      eventSignature !== undefined &&
      this.#catalog.findBySignature(eventSignature) === undefined
    ) {
      throw new QueryValidationError(
        "eventSignature is not present in the ABI",
      );
    }
    if (
      eventName !== undefined &&
      this.#catalog.findByName(eventName).length === 0
    ) {
      throw new QueryValidationError("eventName is not present in the ABI");
    }
    if (
      eventName !== undefined &&
      eventSignature !== undefined &&
      this.#catalog.findBySignature(eventSignature)?.name !== eventName
    ) {
      throw new QueryValidationError(
        "eventName and eventSignature refer to different ABI events",
      );
    }

    const decodeStatus = where.decodeStatus;
    if (
      decodeStatus !== undefined &&
      decodeStatus !== "decoded" &&
      decodeStatus !== "unknown" &&
      decodeStatus !== "decode_failed"
    ) {
      throw new QueryValidationError(
        "decodeStatus must be decoded, unknown, or decode_failed",
      );
    }

    const indexedParameters = this.#normalizeIndexedParameters(
      where.indexedParameters,
      eventName,
      eventSignature,
    );
    const unindexedParameters = this.#normalizeUnindexedParameters(
      where.unindexedParameters,
      eventName,
      eventSignature,
    );
    const transactionHash = normalizeTransactionHash(where.transactionHash);
    return Object.freeze({
      ...(query.after === undefined
        ? {}
        : {
            after: decodeQueryCursor({
              cursor: query.after,
              order,
              targetKey: this.#target.targetKey,
            }),
          }),
      ...blockFilter,
      ...(decodeStatus === undefined ? {} : { decodeStatus }),
      ...(eventName === undefined ? {} : { eventName }),
      ...(eventSignature === undefined ? {} : { eventSignature }),
      ...(indexedParameters.length === 0 ? {} : { indexedParameters }),
      ...(unindexedParameters.length === 0 ? {} : { unindexedParameters }),
      limit,
      order,
      targetKey: this.#target.targetKey,
      ...(transactionHash === undefined ? {} : { transactionHash }),
    });
  }

  #normalizeIndexedParameters(
    parameters: Readonly<Record<string, unknown>> | undefined,
    eventName: string | undefined,
    eventSignature: string | undefined,
  ): readonly StoredIndexedParameterFilter[] {
    if (parameters === undefined) return [];
    const entries = Object.entries(parameters);
    if (entries.length === 0) return [];

    const candidateEvents = resolveCandidateEvents(
      this.#catalog,
      eventName,
      eventSignature,
    );
    return Object.freeze(
      entries.map(([name, value]) => {
        if (name === "") {
          throw new QueryValidationError(
            "Indexed parameter names must be non-empty",
          );
        }
        const matchingInputs = candidateEvents
          .flatMap((event) => event.inputs)
          .filter((input) => input.indexed && input.name === name);
        if (matchingInputs.length === 0) {
          throw new QueryValidationError(
            `Indexed parameter ${name} is not present in the selected ABI events`,
          );
        }
        const solidityTypes = new Set(
          matchingInputs.map((input) => input.solidityType),
        );
        if (solidityTypes.size !== 1) {
          throw new QueryValidationError(
            `Indexed parameter ${name} is ambiguous; specify eventSignature`,
          );
        }
        const input = matchingInputs[0] as EventInputDefinition;
        return Object.freeze({
          comparableValue: encodeDecodedValue(
            normalizeIndexedValue(input.solidityType, value),
          ),
          name,
        });
      }),
    );
  }

  #normalizeUnindexedParameters(
    parameters: Readonly<Record<string, unknown>> | undefined,
    eventName: string | undefined,
    eventSignature: string | undefined,
  ): readonly StoredIndexedParameterFilter[] {
    if (parameters === undefined) return [];
    const entries = Object.entries(parameters);
    if (entries.length === 0) return [];

    const candidateEvents = resolveCandidateEvents(
      this.#catalog,
      eventName,
      eventSignature,
    );
    return Object.freeze(
      entries.map(([name, value]) => {
        if (name === "") {
          throw new QueryValidationError(
            "Unindexed parameter names must be non-empty",
          );
        }
        const matchingInputs = candidateEvents
          .flatMap((event) => event.inputs)
          .filter((input) => !input.indexed && input.name === name);
        if (matchingInputs.length === 0) {
          throw new QueryValidationError(
            `Unindexed parameter ${name} is not present in the selected ABI events`,
          );
        }
        const solidityTypes = new Set(
          matchingInputs.map((input) => input.solidityType),
        );
        if (solidityTypes.size !== 1) {
          throw new QueryValidationError(
            `Unindexed parameter ${name} is ambiguous; specify eventSignature`,
          );
        }
        const input = matchingInputs[0] as EventInputDefinition;
        return Object.freeze({
          comparableValue: encodeDecodedValue(
            normalizeUnindexedValue(input.solidityType, value),
          ),
          name,
        });
      }),
    );
  }

  #mapEvent(row: StoredEventLog): EventRecord {
    return Object.freeze({
      abiFingerprint: row.abiFingerprint,
      arguments:
        row.decodedArguments === null
          ? null
          : decodeDecodedValue(row.decodedArguments),
      blockHash: row.blockHash,
      blockNumber: row.blockNumber,
      chainId: this.#target.chainId,
      contractAddress: row.contractAddress,
      data: row.data,
      decodeStatus: row.decodeStatus,
      eventName: row.eventName,
      eventSignature: row.eventSignature,
      logIndex: row.logIndex,
      removed: row.removed,
      topics: row.topics,
      transactionHash: row.transactionHash,
      transactionIndex: row.transactionIndex,
    });
  }
}

function resolveCandidateEvents(
  catalog: EventCatalog,
  eventName: string | undefined,
  eventSignature: string | undefined,
): readonly EventDefinition[] {
  if (eventSignature !== undefined) {
    const event = catalog.findBySignature(eventSignature);
    if (event === undefined) {
      throw new QueryValidationError(
        "eventSignature is not present in the ABI",
      );
    }
    return [event];
  }
  if (eventName !== undefined) return catalog.findByName(eventName);
  return catalog.events;
}

function normalizeBlockFilter(
  filter: EventQueryWhere["blockNumber"],
): Pick<StoredEventQuery, "blockNumber" | "fromBlock" | "toBlock"> {
  if (filter === undefined) return {};
  if (typeof filter === "bigint" || typeof filter === "number") {
    return Object.freeze({
      blockNumber: normalizeQueryBlockNumber(filter, "query.blockNumber"),
    });
  }
  if (filter === null || typeof filter !== "object") {
    throw new QueryValidationError("blockNumber filter is invalid");
  }
  const fromBlock =
    filter.greaterThanOrEqual === undefined
      ? undefined
      : normalizeQueryBlockNumber(
          filter.greaterThanOrEqual,
          "query.blockNumber.greaterThanOrEqual",
        );
  const toBlock =
    filter.lessThanOrEqual === undefined
      ? undefined
      : normalizeQueryBlockNumber(
          filter.lessThanOrEqual,
          "query.blockNumber.lessThanOrEqual",
        );
  if (fromBlock === undefined && toBlock === undefined) {
    throw new QueryValidationError("blockNumber range must contain a boundary");
  }
  if (fromBlock !== undefined && toBlock !== undefined && fromBlock > toBlock) {
    throw new QueryValidationError(
      "blockNumber lower boundary exceeds upper boundary",
    );
  }
  return Object.freeze({
    ...(fromBlock === undefined ? {} : { fromBlock }),
    ...(toBlock === undefined ? {} : { toBlock }),
  });
}

function normalizeOptionalNonEmpty(
  value: string | undefined,
  fieldName: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new QueryValidationError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function normalizeTransactionHash(value: string | undefined): Hex | undefined {
  if (value === undefined) return undefined;
  if (!isHexBytes(value, 32)) {
    throw new QueryValidationError(
      "transactionHash must be a 32-byte hexadecimal value",
    );
  }
  return value.toLowerCase() as Hex;
}

function normalizeIndexedValue(solidityType: string, value: unknown): unknown {
  if (solidityType === "address") {
    if (typeof value !== "string" || !isAddress(value, { strict: false })) {
      throw new QueryValidationError("Indexed address value is invalid");
    }
    return getAddress(value).toLowerCase();
  }
  const integerMatch = /^(u?int)(\d*)$/.exec(solidityType);
  if (integerMatch !== null) {
    try {
      if (typeof value === "number" && !Number.isSafeInteger(value)) {
        throw new Error("unsafe integer");
      }
      if (
        typeof value !== "bigint" &&
        typeof value !== "number" &&
        typeof value !== "string"
      ) {
        throw new Error("unsupported integer type");
      }
      const normalizedValue = BigInt(value);
      const bitWidth = integerMatch[2] === "" ? 256 : Number(integerMatch[2]);
      if (
        !Number.isInteger(bitWidth) ||
        bitWidth < 8 ||
        bitWidth > 256 ||
        bitWidth % 8 !== 0
      ) {
        throw new Error("invalid integer bit width");
      }
      const isUnsigned = integerMatch[1] === "uint";
      const minimum = isUnsigned ? 0n : -(1n << BigInt(bitWidth - 1));
      const maximum = isUnsigned
        ? (1n << BigInt(bitWidth)) - 1n
        : (1n << BigInt(bitWidth - 1)) - 1n;
      if (normalizedValue < minimum || normalizedValue > maximum) {
        throw new Error("integer is outside ABI bounds");
      }
      return normalizedValue;
    } catch (cause) {
      throw new QueryValidationError("Indexed integer value is invalid", {
        cause,
      });
    }
  }
  if (solidityType === "bool") {
    if (typeof value !== "boolean") {
      throw new QueryValidationError("Indexed bool value must be boolean");
    }
    return value;
  }
  if (
    solidityType === "string" ||
    solidityType === "bytes" ||
    solidityType.includes("[") ||
    solidityType.startsWith("tuple")
  ) {
    if (isHexBytes(value, 32)) {
      return value.toLowerCase();
    }
    if (solidityType === "string") {
      if (typeof value === "string") {
        return keccak256(stringToBytes(value)).toLowerCase();
      }
      throw new QueryValidationError(
        "Indexed string value must be a string or 32-byte topic hash",
      );
    }
    if (solidityType === "bytes") {
      if (typeof value === "string" && isHex(value)) {
        return keccak256(value).toLowerCase();
      }
      if (value instanceof Uint8Array) {
        return keccak256(value).toLowerCase();
      }
      if (typeof value === "string") {
        return keccak256(stringToBytes(value)).toLowerCase();
      }
      throw new QueryValidationError(
        "Indexed bytes value must be a hex string, Uint8Array, or 32-byte topic hash",
      );
    }
    throw new QueryValidationError(
      "Dynamic indexed values must be supplied as their 32-byte topic hash",
    );
  }
  if (solidityType.startsWith("bytes")) {
    const byteLength = Number(solidityType.slice("bytes".length));
    if (
      typeof value !== "string" ||
      !Number.isInteger(byteLength) ||
      byteLength < 1 ||
      byteLength > 32 ||
      !isHexBytes(value, byteLength)
    ) {
      throw new QueryValidationError("Indexed bytes value is invalid");
    }
    return value.toLowerCase();
  }
  return value;
}

function normalizeUnindexedValue(
  solidityType: string,
  value: unknown,
): unknown {
  if (solidityType === "address") {
    if (typeof value !== "string" || !isAddress(value, { strict: false })) {
      throw new QueryValidationError("Unindexed address value is invalid");
    }
    return getAddress(value).toLowerCase();
  }
  const integerMatch = /^(u?int)(\d*)$/.exec(solidityType);
  if (integerMatch !== null) {
    try {
      if (typeof value === "number" && !Number.isSafeInteger(value)) {
        throw new Error("unsafe integer");
      }
      if (
        typeof value !== "bigint" &&
        typeof value !== "number" &&
        typeof value !== "string"
      ) {
        throw new Error("unsupported integer type");
      }
      const normalizedValue = BigInt(value);
      const bitWidth = integerMatch[2] === "" ? 256 : Number(integerMatch[2]);
      if (
        !Number.isInteger(bitWidth) ||
        bitWidth < 8 ||
        bitWidth > 256 ||
        bitWidth % 8 !== 0
      ) {
        throw new Error("invalid integer bit width");
      }
      const isUnsigned = integerMatch[1] === "uint";
      const minimum = isUnsigned ? 0n : -(1n << BigInt(bitWidth - 1));
      const maximum = isUnsigned
        ? (1n << BigInt(bitWidth)) - 1n
        : (1n << BigInt(bitWidth - 1)) - 1n;
      if (normalizedValue < minimum || normalizedValue > maximum) {
        throw new Error("integer is outside ABI bounds");
      }
      return normalizedValue;
    } catch (cause) {
      throw new QueryValidationError("Unindexed integer value is invalid", {
        cause,
      });
    }
  }
  if (solidityType === "bool") {
    if (typeof value !== "boolean") {
      throw new QueryValidationError("Unindexed bool value must be boolean");
    }
    return value;
  }
  if (solidityType === "string") {
    if (typeof value !== "string") {
      throw new QueryValidationError("Unindexed string value must be a string");
    }
    return value;
  }
  if (solidityType === "bytes") {
    if (typeof value !== "string" || !isHex(value)) {
      throw new QueryValidationError(
        "Unindexed bytes value must be a hex string",
      );
    }
    return value.toLowerCase();
  }
  if (solidityType.startsWith("bytes")) {
    const byteLength = Number(solidityType.slice("bytes".length));
    if (
      typeof value !== "string" ||
      !Number.isInteger(byteLength) ||
      byteLength < 1 ||
      byteLength > 32 ||
      !isHexBytes(value, byteLength)
    ) {
      throw new QueryValidationError("Unindexed bytes value is invalid");
    }
    return value.toLowerCase();
  }
  return value;
}

function normalizeQueryBlockNumber(
  value: bigint | number,
  fieldName: string,
): bigint {
  try {
    return normalizeBlockNumber(value, fieldName);
  } catch (cause) {
    throw new QueryValidationError(`${fieldName} is invalid`, { cause });
  }
}

function isHexBytes(value: unknown, byteLength: number): value is Hex {
  return (
    typeof value === "string" &&
    isHex(value) &&
    value.length === 2 + byteLength * 2
  );
}
