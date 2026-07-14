export type SdkLogLevel = "debug" | "error" | "info" | "warn";

export interface SdkLogEvent {
  readonly context?: Readonly<Record<string, unknown>>;
  readonly event: string;
  readonly level: SdkLogLevel;
  readonly message: string;
}

export interface SdkLogger {
  log(event: SdkLogEvent): void;
}

export type UpdateProgressStage =
  | "endpoint_validated"
  | "range_committed"
  | "range_fetch_started"
  | "range_split"
  | "reorg_rewind"
  | "update_completed"
  | "update_started";

export interface UpdateProgressEvent {
  readonly context?: Readonly<Record<string, unknown>>;
  readonly stage: UpdateProgressStage;
}

export type UpdateProgressCallback = (event: UpdateProgressEvent) => void;

export function emitLogSafely(
  logger: SdkLogger | undefined,
  event: SdkLogEvent,
): void {
  try {
    logger?.log(event);
  } catch {
    // Observability must never change synchronization correctness.
  }
}

export function emitProgressSafely(
  callback: UpdateProgressCallback | undefined,
  event: UpdateProgressEvent,
): void {
  try {
    callback?.(event);
  } catch {
    // Progress reporting is deliberately isolated from SDK behavior.
  }
}
