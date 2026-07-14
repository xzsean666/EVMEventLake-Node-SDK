import type { Address, Hex } from "viem";

import type { BlockNumberInput } from "../configuration/sdk-options.js";
export type EventDecodeStatus = "decode_failed" | "decoded" | "unknown";

export interface BlockNumberRangeFilter {
  readonly greaterThanOrEqual?: BlockNumberInput;
  readonly lessThanOrEqual?: BlockNumberInput;
}

export interface EventQueryWhere {
  readonly blockNumber?: BlockNumberInput | BlockNumberRangeFilter;
  readonly eventName?: string;
  readonly eventSignature?: string;
  readonly indexedParameters?: Readonly<Record<string, unknown>>;
  readonly transactionHash?: string;
}

export interface EventQuery {
  readonly after?: string;
  readonly limit?: number;
  readonly order?: "ascending" | "descending";
  readonly where?: EventQueryWhere;
}

export interface EventRecord {
  readonly abiFingerprint: string;
  readonly arguments: unknown;
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly data: Hex;
  readonly decodeStatus: EventDecodeStatus;
  readonly eventName: string | null;
  readonly eventSignature: string | null;
  readonly logIndex: number;
  readonly removed: boolean;
  readonly topics: readonly Hex[];
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
}

export interface EventPage {
  readonly items: readonly EventRecord[];
  readonly nextCursor: string | null;
}

export interface EventQueryApi {
  findFirst(query?: EventQuery): Promise<EventRecord | null>;
  findMany(query?: EventQuery): Promise<EventPage>;
}
