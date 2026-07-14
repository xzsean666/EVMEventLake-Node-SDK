export type EVMEventLakeErrorCode =
  | "ABI_VALIDATION_ERROR"
  | "CONFIGURATION_VALIDATION_ERROR"
  | "DECODED_VALUE_CODEC_ERROR"
  | "NO_VALID_RPC_ENDPOINT"
  | "OPERATION_CANCELLED"
  | "QUERY_VALIDATION_ERROR"
  | "REORG_DEPTH_EXCEEDED"
  | "RPC_CHAIN_MISMATCH"
  | "RPC_REQUEST_EXHAUSTED"
  | "STORAGE_INITIALIZATION_ERROR"
  | "SYNCHRONIZATION_LOCKED"
  | "TARGET_METADATA_CONFLICT"
  | "UNFETCHABLE_BLOCK"
  | "UNSUPPORTED_DATABASE_URL";

export interface EVMEventLakeErrorOptions {
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, unknown>>;
}

export class EVMEventLakeError extends Error {
  public readonly code: EVMEventLakeErrorCode;
  public readonly context: Readonly<Record<string, unknown>>;

  public constructor(
    code: EVMEventLakeErrorCode,
    message: string,
    options: EVMEventLakeErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = new.target.name;
    this.code = code;
    this.context = Object.freeze({ ...(options.context ?? {}) });
  }
}

export class ConfigurationValidationError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("CONFIGURATION_VALIDATION_ERROR", message, options);
  }
}

export class UnsupportedDatabaseUrlError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("UNSUPPORTED_DATABASE_URL", message, options);
  }
}

export class StorageInitializationError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("STORAGE_INITIALIZATION_ERROR", message, options);
  }
}

export class TargetMetadataConflictError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("TARGET_METADATA_CONFLICT", message, options);
  }
}

export class SynchronizationLockedError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("SYNCHRONIZATION_LOCKED", message, options);
  }
}

export class NoValidRpcEndpointError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("NO_VALID_RPC_ENDPOINT", message, options);
  }
}

export class RpcChainMismatchError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("RPC_CHAIN_MISMATCH", message, options);
  }
}

export class RpcRequestExhaustedError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("RPC_REQUEST_EXHAUSTED", message, options);
  }
}

export class UnfetchableBlockError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("UNFETCHABLE_BLOCK", message, options);
  }
}

export class AbiValidationError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("ABI_VALIDATION_ERROR", message, options);
  }
}

export class DecodedValueCodecError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("DECODED_VALUE_CODEC_ERROR", message, options);
  }
}

export class QueryValidationError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("QUERY_VALIDATION_ERROR", message, options);
  }
}

export class ReorgDepthExceededError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("REORG_DEPTH_EXCEEDED", message, options);
  }
}

export class OperationCancelledError extends EVMEventLakeError {
  public constructor(message: string, options?: EVMEventLakeErrorOptions) {
    super("OPERATION_CANCELLED", message, options);
  }
}
