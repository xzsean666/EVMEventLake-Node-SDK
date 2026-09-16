import type { Abi } from "viem";

import { encodeDecodedValue } from "../abi/decoded-value-codec.js";
import type { EventCatalog } from "../abi/event-catalog.js";
import { decodeRawEventLog, type RawEvmLog } from "../abi/event-decoder.js";
import type {
  EventEnricher,
  EventEnrichmentContext,
} from "../configuration/sdk-options.js";
import { normalizeBlockNumber } from "../configuration/validate-sdk-options.js";
import type { ContractTarget } from "../contract-target/contract-target.js";
import { ConfigurationValidationError } from "../errors/evm-event-lake-errors.js";
import type { SdkLogger } from "../observability/sdk-logger.js";
import { emitLogSafely } from "../observability/sdk-logger.js";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type {
  RedecodeCursor,
  StoredEventLog,
} from "../storage/storage-models.js";

export interface RedecodeOptions {
  readonly abi: Abi;
  readonly batchSize?: number;
  readonly enrichEvent?: EventEnricher;
  readonly fromBlock?: bigint | number;
  readonly onProgress?: (progress: RedecodeProgress) => void;
  readonly redecodeAll?: boolean;
  readonly signal?: AbortSignal;
  readonly toBlock?: bigint | number;
}

export interface RedecodeProgress {
  readonly failedLogs: number;
  readonly newlyDecodedLogs: number;
  readonly processedLogs: number;
  readonly remainingLogs: number;
  readonly totalLogs: number;
  readonly unchangedLogs: number;
}

export interface RedecodeResult {
  readonly abiFingerprint: string;
  readonly failedLogs: number;
  readonly newlyDecodedLogs: number;
  readonly processedLogs: number;
  readonly totalLogs: number;
  readonly unchangedLogs: number;
}

const DEFAULT_REDECODE_BATCH_SIZE = 500;

export class RedecodeService {
  readonly #logger: SdkLogger | undefined;
  readonly #storage: StorageAdapter;
  readonly #target: ContractTarget;

  public constructor(input: {
    readonly logger?: SdkLogger;
    readonly storage: StorageAdapter;
    readonly target: ContractTarget;
  }) {
    this.#logger = input.logger;
    this.#storage = input.storage;
    this.#target = input.target;
  }

  public async redecode(
    newCatalog: EventCatalog,
    options: RedecodeOptions,
  ): Promise<RedecodeResult> {
    options.signal?.throwIfAborted();

    const fromBlock =
      options.fromBlock !== undefined
        ? normalizeBlockNumber(options.fromBlock, "fromBlock")
        : undefined;
    const toBlock =
      options.toBlock !== undefined
        ? normalizeBlockNumber(options.toBlock, "toBlock")
        : undefined;

    if (
      fromBlock !== undefined &&
      toBlock !== undefined &&
      fromBlock > toBlock
    ) {
      throw new ConfigurationValidationError(
        "fromBlock cannot exceed toBlock",
        {
          context: {
            fromBlock: fromBlock.toString(),
            toBlock: toBlock.toString(),
          },
        },
      );
    }

    const batchSize = options.batchSize ?? DEFAULT_REDECODE_BATCH_SIZE;
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new ConfigurationValidationError(
        "batchSize must be a positive safe integer",
        { context: { batchSize } },
      );
    }

    if (
      options.enrichEvent !== undefined &&
      typeof options.enrichEvent !== "function"
    ) {
      throw new ConfigurationValidationError(
        "redecode.enrichEvent must be a function",
      );
    }

    const redecodeAll = options.redecodeAll ?? false;

    // 1. Register newly provided ABI version into storage
    await this.#storage.registerTarget({
      abiFingerprint: newCatalog.abiFingerprint,
      canonicalAbiJson: newCatalog.canonicalAbiJson,
      target: this.#target,
    });

    // 2. Count candidate logs
    const totalLogs = await this.#storage.countLogsForRedecode({
      ...(fromBlock !== undefined ? { fromBlock } : {}),
      redecodeAll,
      targetKey: this.#target.targetKey,
      ...(toBlock !== undefined ? { toBlock } : {}),
    });

    emitLogSafely(this.#logger, {
      context: {
        redecodeAll,
        targetKey: this.#target.targetKey,
        totalLogs,
      },
      event: "redecode_started",
      level: "info",
      message: `Starting redecode for ${totalLogs} logs`,
    });

    if (totalLogs === 0) {
      return Object.freeze({
        abiFingerprint: newCatalog.abiFingerprint,
        failedLogs: 0,
        newlyDecodedLogs: 0,
        processedLogs: 0,
        totalLogs: 0,
        unchangedLogs: 0,
      });
    }

    let processedLogs = 0;
    let newlyDecodedLogs = 0;
    let failedLogs = 0;
    let unchangedLogs = 0;
    let afterCursor: RedecodeCursor | undefined = undefined;

    while (true) {
      options.signal?.throwIfAborted();

      const batch: readonly StoredEventLog[] =
        await this.#storage.getLogsForRedecode({
          ...(afterCursor !== undefined ? { after: afterCursor } : {}),
          ...(fromBlock !== undefined ? { fromBlock } : {}),
          limit: batchSize,
          redecodeAll,
          targetKey: this.#target.targetKey,
          ...(toBlock !== undefined ? { toBlock } : {}),
        });

      if (batch.length === 0) {
        break;
      }

      const logsToUpdate: StoredEventLog[] = [];

      for (const log of batch) {
        const rawLog: RawEvmLog = {
          address: log.contractAddress,
          blockHash: log.blockHash,
          blockNumber: log.blockNumber,
          data: log.data,
          logIndex: log.logIndex,
          removed: log.removed,
          topics: log.topics,
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
        };

        const decodeResult = decodeRawEventLog(newCatalog, rawLog);

        let additionalData = log.additionalData;
        if (options.enrichEvent !== undefined) {
          const enrichmentContext: EventEnrichmentContext = Object.freeze({
            abiFingerprint: newCatalog.abiFingerprint,
            arguments:
              decodeResult.status === "decoded" ? decodeResult.arguments : null,
            blockHash: log.blockHash,
            blockNumber: log.blockNumber,
            chainId: this.#target.chainId,
            contractAddress: log.contractAddress,
            data: log.data,
            decodeStatus: decodeResult.status,
            eventId: log.eventId,
            eventName:
              decodeResult.status === "decoded" ? decodeResult.eventName : null,
            eventSignature:
              decodeResult.status === "decoded"
                ? decodeResult.eventSignature
                : null,
            logIndex: log.logIndex,
            removed: log.removed,
            topics: log.topics,
            transactionHash: log.transactionHash,
            transactionIndex: log.transactionIndex,
          });
          const enrichResult = await options.enrichEvent(enrichmentContext);
          additionalData =
            enrichResult !== undefined && enrichResult !== null
              ? encodeDecodedValue(enrichResult)
              : null;
        }

        if (decodeResult.status === "decoded") {
          const wasAlreadyDecoded =
            log.decodeStatus === "decoded" &&
            log.eventSignature === decodeResult.eventSignature;

          if (wasAlreadyDecoded && options.enrichEvent === undefined) {
            unchangedLogs++;
          } else {
            newlyDecodedLogs++;
            logsToUpdate.push(
              Object.freeze({
                ...log,
                abiFingerprint: newCatalog.abiFingerprint,
                additionalData,
                decodeStatus: "decoded" as const,
                decodedArguments: encodeDecodedValue(decodeResult.arguments),
                eventName: decodeResult.eventName,
                eventSignature: decodeResult.eventSignature,
                parameters: decodeResult.parameters,
              }),
            );
          }
        } else if (decodeResult.status === "decode_failed") {
          failedLogs++;
          logsToUpdate.push(
            Object.freeze({
              ...log,
              abiFingerprint: newCatalog.abiFingerprint,
              additionalData,
              decodeStatus: "decode_failed" as const,
              decodedArguments: null,
              eventName: null,
              eventSignature: null,
              parameters: Object.freeze([]),
            }),
          );
        } else {
          if (
            log.decodeStatus === "unknown" &&
            options.enrichEvent === undefined
          ) {
            unchangedLogs++;
          } else {
            logsToUpdate.push(
              Object.freeze({
                ...log,
                abiFingerprint: newCatalog.abiFingerprint,
                additionalData,
                decodeStatus: "unknown" as const,
                decodedArguments: null,
                eventName: null,
                eventSignature: null,
                parameters: Object.freeze([]),
              }),
            );
          }
        }
      }

      if (logsToUpdate.length > 0) {
        await this.#storage.updateDecodedLogs({
          logs: logsToUpdate,
          targetKey: this.#target.targetKey,
        });
      }

      processedLogs += batch.length;
      const lastLog = batch.at(-1)!;
      afterCursor = {
        blockNumber: lastLog.blockNumber,
        logIndex: lastLog.logIndex,
      };

      options.onProgress?.({
        failedLogs,
        newlyDecodedLogs,
        processedLogs,
        remainingLogs: Math.max(0, totalLogs - processedLogs),
        totalLogs,
        unchangedLogs,
      });

      if (batch.length < batchSize) {
        break;
      }
    }

    emitLogSafely(this.#logger, {
      context: {
        failedLogs,
        newlyDecodedLogs,
        processedLogs,
        targetKey: this.#target.targetKey,
        unchangedLogs,
      },
      event: "redecode_completed",
      level: "info",
      message: `Redecode completed: ${newlyDecodedLogs} newly decoded, ${unchangedLogs} unchanged, ${failedLogs} failed`,
    });

    return Object.freeze({
      abiFingerprint: newCatalog.abiFingerprint,
      failedLogs,
      newlyDecodedLogs,
      processedLogs,
      totalLogs,
      unchangedLogs,
    });
  }
}
