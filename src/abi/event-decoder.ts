import {
  decodeAbiParameters,
  decodeEventLog,
  getAddress,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";

import { encodeDecodedValue } from "./decoded-value-codec.js";
import type { EventCatalog, EventDefinition } from "./event-catalog.js";

export interface RawEvmLog {
  readonly address: Address;
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly data: Hex;
  readonly logIndex: number;
  readonly removed: boolean;
  readonly topics: readonly Hex[];
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
}

export interface DecodedEventParameter {
  readonly comparableValue: string;
  readonly indexed: boolean;
  readonly name: string;
  readonly position: number;
  readonly rawTopicValue: Hex | null;
  readonly solidityType: string;
  readonly value: unknown;
}

export interface DecodedEventResult {
  readonly arguments: unknown;
  readonly eventName: string;
  readonly eventSignature: string;
  readonly parameters: readonly DecodedEventParameter[];
  readonly status: "decoded";
}

export interface UnknownEventResult {
  readonly status: "unknown";
}

export interface DecodeFailedEventResult {
  readonly candidateEventSignatures: readonly string[];
  readonly errorMessage: string;
  readonly status: "decode_failed";
}

export type EventDecodeResult =
  DecodeFailedEventResult | DecodedEventResult | UnknownEventResult;

export function decodeRawEventLog(
  catalog: EventCatalog,
  rawLog: RawEvmLog,
): EventDecodeResult {
  const topicCandidates = catalog.findByTopic0(rawLog.topics[0]);
  const candidates =
    topicCandidates.length > 0 ? topicCandidates : catalog.anonymousEvents;
  if (candidates.length === 0) {
    return { status: "unknown" };
  }

  const decodedCandidates: DecodedEventResult[] = [];
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      decodedCandidates.push(decodeCandidate(candidate, rawLog));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (decodedCandidates.length === 1) {
    return decodedCandidates[0] as DecodedEventResult;
  }
  if (decodedCandidates.length > 1) {
    return Object.freeze({
      candidateEventSignatures: Object.freeze(
        decodedCandidates.map((candidate) => candidate.eventSignature),
      ),
      errorMessage: "Event log matches multiple ABI event definitions",
      status: "decode_failed" as const,
    });
  }

  if (topicCandidates.length === 0) {
    return { status: "unknown" };
  }
  return Object.freeze({
    candidateEventSignatures: Object.freeze(
      candidates.map((candidate) => candidate.signature),
    ),
    errorMessage: errors[0] ?? "Event log could not be decoded",
    status: "decode_failed" as const,
  });
}

function decodeCandidate(
  definition: EventDefinition,
  rawLog: RawEvmLog,
): DecodedEventResult {
  if (!definition.anonymous) {
    const indexedInputCount = definition.abiEvent.inputs.filter(
      (input) => input.indexed === true,
    ).length;
    if (rawLog.topics.length !== indexedInputCount + 1) {
      throw new Error(
        "Event log topic count does not match the ABI indexed parameter count",
      );
    }
  }
  const decodedArguments = definition.anonymous
    ? decodeAnonymousEvent(definition.abiEvent, rawLog)
    : (decodeEventLog({
        abi: [definition.abiEvent],
        data: rawLog.data,
        strict: true,
        topics: [...rawLog.topics] as [] | [Hex, ...Hex[]],
      }).args ?? []);
  return Object.freeze({
    arguments: decodedArguments,
    eventName: definition.name,
    eventSignature: definition.signature,
    parameters: Object.freeze(
      definition.abiEvent.inputs.map((input, position) =>
        createDecodedParameter(
          definition.abiEvent,
          input,
          position,
          decodedArguments,
          rawLog.topics,
        ),
      ),
    ),
    status: "decoded" as const,
  });
}

function decodeAnonymousEvent(event: AbiEvent, rawLog: RawEvmLog): unknown {
  const indexedInputs = event.inputs.filter((input) => input.indexed === true);
  if (indexedInputs.length !== rawLog.topics.length) {
    throw new Error("Anonymous event indexed topic count does not match ABI");
  }

  const nonIndexedInputs = event.inputs.filter(
    (input) => input.indexed !== true,
  );
  const nonIndexedValues =
    nonIndexedInputs.length === 0
      ? []
      : decodeAbiParameters(nonIndexedInputs, rawLog.data);

  let indexedValuePosition = 0;
  let nonIndexedValuePosition = 0;
  const values = event.inputs.map((input) => {
    if (input.indexed === true) {
      const topic = rawLog.topics[indexedValuePosition];
      indexedValuePosition += 1;
      if (topic === undefined) {
        throw new Error("Anonymous event is missing an indexed topic");
      }
      if (isHashedIndexedType(input.type)) {
        return topic;
      }
      return decodeAbiParameters([input], topic)[0];
    }

    const value = nonIndexedValues[nonIndexedValuePosition];
    nonIndexedValuePosition += 1;
    return value;
  });

  const names = event.inputs.map((input) => input.name ?? "");
  const hasUniqueNames =
    names.every((name) => name !== "") && new Set(names).size === names.length;
  if (!hasUniqueNames) return values;
  return Object.fromEntries(
    names.map((name, position) => [name, values[position]]),
  );
}

function isHashedIndexedType(solidityType: string): boolean {
  return (
    solidityType === "bytes" ||
    solidityType === "string" ||
    solidityType.includes("[") ||
    solidityType.startsWith("tuple")
  );
}

function createDecodedParameter(
  event: AbiEvent,
  input: AbiEvent["inputs"][number],
  position: number,
  decodedArguments: unknown,
  topics: readonly Hex[],
): DecodedEventParameter {
  const value = readDecodedArgument(decodedArguments, input.name, position);
  const normalizedValue = normalizeDecodedParameterValue(input, value);
  return Object.freeze({
    comparableValue: encodeDecodedValue(normalizedValue),
    indexed: input.indexed ?? false,
    name: input.name ?? "",
    position,
    rawTopicValue: getIndexedTopic(event, position, topics),
    solidityType: input.type,
    value,
  });
}

export function readDecodedArgument(
  decodedArguments: unknown,
  name: string | undefined,
  position: number,
): unknown {
  if (Array.isArray(decodedArguments)) {
    return decodedArguments[position];
  }
  if (decodedArguments !== null && typeof decodedArguments === "object") {
    const argumentsByName = decodedArguments as Record<string, unknown>;
    if (name !== undefined && name !== "" && name in argumentsByName) {
      return argumentsByName[name];
    }
    return argumentsByName[position.toString()];
  }
  return undefined;
}

function normalizeDecodedParameterValue(
  input: AbiEvent["inputs"][number],
  value: unknown,
): unknown {
  if (typeof value !== "string") return value;
  if (input.type === "address") {
    return getAddress(value).toLowerCase();
  }
  if (input.type.startsWith("bytes")) {
    return value.toLowerCase();
  }
  if (input.indexed === true && isHashedIndexedType(input.type)) {
    return value.toLowerCase();
  }
  return value;
}

function getIndexedTopic(
  event: AbiEvent,
  inputPosition: number,
  topics: readonly Hex[],
): Hex | null {
  const input = event.inputs[inputPosition];
  if (input?.indexed !== true) return null;

  let indexedPosition = 0;
  for (let position = 0; position < inputPosition; position += 1) {
    if (event.inputs[position]?.indexed === true) indexedPosition += 1;
  }
  const topicPosition = indexedPosition + (event.anonymous ? 0 : 1);
  return topics[topicPosition] ?? null;
}
