import { QueryValidationError } from "../errors/evm-event-lake-errors.js";
import type { StoredEventQueryCursor } from "../storage/storage-models.js";

interface QueryCursorPayload {
  readonly blockNumber: string;
  readonly eventId: string;
  readonly logIndex: number;
  readonly order: "ascending" | "descending";
  readonly targetKey: string;
  readonly transactionIndex: number;
  readonly version: 1;
}

export function encodeQueryCursor(input: {
  readonly cursor: StoredEventQueryCursor;
  readonly order: "ascending" | "descending";
  readonly targetKey: string;
}): string {
  const payload: QueryCursorPayload = {
    blockNumber: input.cursor.blockNumber.toString(),
    eventId: input.cursor.eventId,
    logIndex: input.cursor.logIndex,
    order: input.order,
    targetKey: input.targetKey,
    transactionIndex: input.cursor.transactionIndex,
    version: 1,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeQueryCursor(input: {
  readonly cursor: string;
  readonly order: "ascending" | "descending";
  readonly targetKey: string;
}): StoredEventQueryCursor {
  let payload: unknown;
  try {
    payload = JSON.parse(
      Buffer.from(input.cursor, "base64url").toString("utf8"),
    ) as unknown;
  } catch (cause) {
    throw new QueryValidationError("Query cursor is invalid", { cause });
  }
  if (payload === null || typeof payload !== "object") {
    throw new QueryValidationError("Query cursor has an invalid shape");
  }
  const candidate = payload as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    candidate.targetKey !== input.targetKey ||
    candidate.order !== input.order ||
    typeof candidate.blockNumber !== "string" ||
    !/^\d+$/.test(candidate.blockNumber) ||
    typeof candidate.transactionIndex !== "number" ||
    !Number.isSafeInteger(candidate.transactionIndex) ||
    typeof candidate.logIndex !== "number" ||
    !Number.isSafeInteger(candidate.logIndex) ||
    typeof candidate.eventId !== "string" ||
    candidate.eventId === ""
  ) {
    throw new QueryValidationError(
      "Query cursor does not match target, order, or schema",
    );
  }
  return Object.freeze({
    blockNumber: BigInt(candidate.blockNumber),
    eventId: candidate.eventId,
    logIndex: candidate.logIndex,
    transactionIndex: candidate.transactionIndex,
  });
}
