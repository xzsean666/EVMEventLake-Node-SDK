export interface AbiVersionTable {
  abi_fingerprint: string;
  canonical_abi_json: string;
  registered_at: string;
  target_key: string;
}

export interface EventLogTable {
  abi_fingerprint: string;
  block_hash: string;
  block_number_key: string;
  contract_address: string;
  created_at: string;
  data: string;
  decode_status: string;
  decoded_arguments: string | null;
  event_id: string;
  event_name: string | null;
  event_signature: string | null;
  log_index: number;
  removed: number;
  target_key: string;
  topics_json: string;
  transaction_hash: string;
  transaction_index: number;
}

export interface EventParameterTable {
  comparable_value: string;
  event_id: string;
  is_indexed: number;
  name: string;
  position: number;
  raw_topic: string | null;
  solidity_type: string;
  target_key: string;
}

export interface LakeTargetTable {
  active_abi_fingerprint: string;
  chain_id: number;
  contract_address: string;
  created_at: string;
  next_block_key: string;
  start_block_key: string;
  target_key: string;
  updated_at: string;
}

export interface SchemaMigrationTable {
  applied_at: string;
  version: number;
}

export interface SyncCheckpointTable {
  block_hash: string;
  block_number_key: string;
  committed_at: string;
  target_key: string;
}

export interface SyncLeaseTable {
  expires_at: string;
  owner_token: string;
  target_key: string;
}

export interface StorageDatabaseSchema {
  abi_versions: AbiVersionTable;
  event_logs: EventLogTable;
  event_parameters: EventParameterTable;
  lake_targets: LakeTargetTable;
  schema_migrations: SchemaMigrationTable;
  sync_checkpoints: SyncCheckpointTable;
  sync_leases: SyncLeaseTable;
}
