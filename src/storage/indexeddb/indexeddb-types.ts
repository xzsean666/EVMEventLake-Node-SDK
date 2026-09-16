import type { Hex } from "viem";

import type { DecodedEventParameter } from "../../abi/event-decoder.js";
import type { StoredDecodeStatus } from "../storage-models.js";

export interface LakeTargetStoreRow {
  activeAbiFingerprint: string;
  chainId: number;
  contractAddress: string;
  createdAt: string;
  nextBlockKey: string;
  startBlockKey: string;
  targetKey: string;
  updatedAt: string;
}

export interface AbiVersionStoreRow {
  abiFingerprint: string;
  canonicalAbiJson: string;
  registeredAt: string;
  targetKey: string;
}

export interface EventLogStoreRow {
  abiFingerprint: string;
  blockHash: Hex;
  blockNumberKey: string;
  contractAddress: string;
  createdAt: string;
  data: Hex;
  decodeStatus: StoredDecodeStatus;
  decodedArguments: string | null;
  eventId: string;
  eventName: string | null;
  eventSignature: string | null;
  logIndex: number;
  parameters: readonly DecodedEventParameter[];
  removed: boolean;
  targetKey: string;
  topics: readonly Hex[];
  transactionHash: Hex;
  transactionIndex: number;
}

export interface EventParameterStoreRow {
  blockNumberKey: string;
  comparableValue: string;
  eventId: string;
  indexed: number;
  logIndex: number;
  name: string;
  position: number;
  rawTopic: Hex | null;
  solidityType: string;
  targetKey: string;
}

export interface SyncCheckpointStoreRow {
  blockHash: Hex;
  blockNumberKey: string;
  committedAt: string;
  targetKey: string;
}

export interface SyncLeaseStoreRow {
  expiresAt: string;
  ownerToken: string;
  targetKey: string;
}

export interface SchemaMigrationStoreRow {
  appliedAt: string;
  version: number;
}
