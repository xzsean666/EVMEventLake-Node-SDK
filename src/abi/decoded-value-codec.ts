import { DecodedValueCodecError } from "../errors/evm-event-lake-errors.js";

type StoredDecodedValue =
  | { readonly type: "array"; readonly value: readonly StoredDecodedValue[] }
  | { readonly type: "bigint"; readonly value: string }
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "null" }
  | {
      readonly type: "object";
      readonly value: readonly (readonly [string, StoredDecodedValue])[];
    }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "string"; readonly value: string };

export function encodeDecodedValue(value: unknown): string {
  const activeObjects = new Set<object>();
  return JSON.stringify(toStoredDecodedValue(value, activeObjects));
}

export function decodeDecodedValue(serializedValue: string): unknown {
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(serializedValue) as unknown;
  } catch (cause) {
    throw new DecodedValueCodecError("Decoded value is not valid JSON", {
      cause,
    });
  }
  return fromStoredDecodedValue(assertStoredDecodedValue(parsedValue));
}

function toStoredDecodedValue(
  value: unknown,
  activeObjects: Set<object>,
): StoredDecodedValue {
  if (value === null) {
    return { type: "null" };
  }
  if (typeof value === "bigint") {
    return { type: "bigint", value: value.toString() };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", value };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DecodedValueCodecError("Decoded numeric values must be finite");
    }
    return { type: "number", value };
  }
  if (typeof value === "string") {
    return { type: "string", value };
  }
  if (typeof value !== "object") {
    throw new DecodedValueCodecError(
      `Unsupported decoded value type: ${typeof value}`,
    );
  }
  if (activeObjects.has(value)) {
    throw new DecodedValueCodecError("Decoded values must not be cyclic");
  }

  activeObjects.add(value);
  try {
    if (Array.isArray(value)) {
      return {
        type: "array",
        value: value.map((item) => toStoredDecodedValue(item, activeObjects)),
      };
    }

    const entries = Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(
        ([key, nestedValue]) =>
          [key, toStoredDecodedValue(nestedValue, activeObjects)] as const,
      );
    return { type: "object", value: entries };
  } finally {
    activeObjects.delete(value);
  }
}

function assertStoredDecodedValue(value: unknown): StoredDecodedValue {
  if (value === null || typeof value !== "object" || !("type" in value)) {
    throw new DecodedValueCodecError("Decoded value has an invalid shape");
  }

  const candidate = value as Record<string, unknown>;
  switch (candidate.type) {
    case "null":
      return { type: "null" };
    case "bigint":
      if (
        typeof candidate.value !== "string" ||
        !/^-?\d+$/.test(candidate.value)
      ) {
        break;
      }
      return { type: "bigint", value: candidate.value };
    case "boolean":
      if (typeof candidate.value !== "boolean") break;
      return { type: "boolean", value: candidate.value };
    case "number":
      if (
        typeof candidate.value !== "number" ||
        !Number.isFinite(candidate.value)
      ) {
        break;
      }
      return { type: "number", value: candidate.value };
    case "string":
      if (typeof candidate.value !== "string") break;
      return { type: "string", value: candidate.value };
    case "array":
      if (!Array.isArray(candidate.value)) break;
      return {
        type: "array",
        value: candidate.value.map((item) => assertStoredDecodedValue(item)),
      };
    case "object":
      if (!Array.isArray(candidate.value)) break;
      return {
        type: "object",
        value: candidate.value.map((entry) => {
          if (
            !Array.isArray(entry) ||
            entry.length !== 2 ||
            typeof entry[0] !== "string"
          ) {
            throw new DecodedValueCodecError(
              "Decoded object entry has an invalid shape",
            );
          }
          return [entry[0], assertStoredDecodedValue(entry[1])] as const;
        }),
      };
  }

  throw new DecodedValueCodecError("Decoded value has an invalid shape");
}

function fromStoredDecodedValue(value: StoredDecodedValue): unknown {
  switch (value.type) {
    case "null":
      return null;
    case "bigint":
      return BigInt(value.value);
    case "boolean":
    case "number":
    case "string":
      return value.value;
    case "array":
      return value.value.map((item) => fromStoredDecodedValue(item));
    case "object":
      return Object.fromEntries(
        value.value.map(([key, nestedValue]) => [
          key,
          fromStoredDecodedValue(nestedValue),
        ]),
      );
  }
}
