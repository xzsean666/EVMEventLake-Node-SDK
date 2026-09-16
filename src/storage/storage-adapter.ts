import type {
  CommitRangeRequest,
  CommitRangeResult,
  CountLogsForRedecodeRequest,
  GetLogsForRedecodeRequest,
  RewindResult,
  StoredEventLog,
  StoredEventQuery,
  SyncCheckpoint,
  TargetRegistration,
  TargetState,
  UpdateDecodedLogsRequest,
  UpdateDecodedLogsResult,
} from "./storage-models.js";

export interface AcquireLeaseRequest {
  readonly expiresAt: string;
  readonly ownerToken: string;
  readonly targetKey: string;
}

export type RenewLeaseRequest = AcquireLeaseRequest;

export interface ReleaseLeaseRequest {
  readonly ownerToken: string;
  readonly targetKey: string;
}

export interface StorageAdapter {
  acquireLease(request: AcquireLeaseRequest): Promise<boolean>;
  close(): Promise<void>;
  commitRange(request: CommitRangeRequest): Promise<CommitRangeResult>;
  countLogsForRedecode(request: CountLogsForRedecodeRequest): Promise<number>;
  getLogsForRedecode(
    request: GetLogsForRedecodeRequest,
  ): Promise<readonly StoredEventLog[]>;
  getRecentCheckpoints(
    targetKey: string,
    limit: number,
  ): Promise<readonly SyncCheckpoint[]>;
  getTargetState(targetKey: string): Promise<TargetState | null>;
  initialize(): Promise<void>;
  queryEvents(query: StoredEventQuery): Promise<readonly StoredEventLog[]>;
  registerTarget(registration: TargetRegistration): Promise<TargetState>;
  releaseLease(request: ReleaseLeaseRequest): Promise<boolean>;
  renewLease(request: RenewLeaseRequest): Promise<boolean>;
  rewind(targetKey: string, rewindToBlock: bigint): Promise<RewindResult>;
  updateDecodedLogs(
    request: UpdateDecodedLogsRequest,
  ): Promise<UpdateDecodedLogsResult>;
}
