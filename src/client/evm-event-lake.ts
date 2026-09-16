import { EventCatalog } from "../abi/event-catalog.js";
import type { EVMEventLakeOptions } from "../configuration/sdk-options.js";
import { validateSdkOptions } from "../configuration/validate-sdk-options.js";
import { createContractTarget } from "../contract-target/contract-target.js";
import {
  ClientClosedError,
  SynchronizationLockedError,
} from "../errors/evm-event-lake-errors.js";
import { emitLogSafely } from "../observability/sdk-logger.js";
import { EventQueryService } from "../query/event-query-service.js";
import type {
  EventQuery,
  EventQueryApi,
  EventRecord,
  EventPage,
} from "../query/event-query.js";
import { RpcPool } from "../rpc/rpc-pool.js";
import { createStorageAdapter } from "../storage/create-storage-adapter.js";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import {
  RedecodeService,
  type RedecodeOptions,
  type RedecodeResult,
} from "../synchronization/redecode-service.js";
import type {
  UpdateOptions,
  UpdateResult,
} from "../synchronization/synchronization-result.js";
import { UpdateService } from "../synchronization/update-service.js";
import type { SyncStatus } from "./sync-status.js";

export class EVMEventLake {
  public readonly events: EventQueryApi;

  readonly #lifecycleAbortController = new AbortController();
  readonly #queryService: EventQueryService;
  readonly #redecodeService: RedecodeService;
  readonly #storage: StorageAdapter;
  readonly #targetKey: string;
  readonly #updateService: UpdateService;
  #activeOperation: Promise<unknown> | null = null;
  #closePromise: Promise<void> | null = null;
  #closed = false;

  private constructor(input: {
    readonly queryService: EventQueryService;
    readonly redecodeService: RedecodeService;
    readonly storage: StorageAdapter;
    readonly targetKey: string;
    readonly updateService: UpdateService;
  }) {
    this.#queryService = input.queryService;
    this.#redecodeService = input.redecodeService;
    this.#storage = input.storage;
    this.#targetKey = input.targetKey;
    this.#updateService = input.updateService;
    this.events = Object.freeze({
      findFirst: (query?: EventQuery): Promise<EventRecord | null> => {
        this.#assertOpen();
        return this.#queryService.findFirst(query);
      },
      findMany: (query?: EventQuery): Promise<EventPage> => {
        this.#assertOpen();
        return this.#queryService.findMany(query);
      },
    });
  }

  public static async create(
    options: EVMEventLakeOptions,
  ): Promise<EVMEventLake> {
    const normalized = validateSdkOptions(options);
    const target = createContractTarget({
      chainId: normalized.chainId,
      contractAddress: normalized.contractAddress,
      startBlock: normalized.startBlock,
    });
    const catalog = new EventCatalog(normalized.abi);
    const storage = await createStorageAdapter(normalized.database);
    try {
      await storage.initialize();
      await storage.registerTarget({
        abiFingerprint: catalog.abiFingerprint,
        canonicalAbiJson: catalog.canonicalAbiJson,
        target,
      });
      const rpc = new RpcPool(
        normalized.chainId,
        normalized.rpcUrls,
        normalized.rpc,
      );
      const queryService = new EventQueryService({ catalog, storage, target });
      const updateService = new UpdateService({
        catalog,
        ...(normalized.enrichEvent === undefined
          ? {}
          : { enrichEvent: normalized.enrichEvent }),
        ...(normalized.observability.logger === undefined
          ? {}
          : { logger: normalized.observability.logger }),
        ...(normalized.observability.onProgress === undefined
          ? {}
          : { onProgress: normalized.observability.onProgress }),
        rpc,
        rpcPolicy: normalized.rpc,
        storage,
        synchronizationPolicy: normalized.synchronization,
        target,
        ...(normalized.topics === undefined
          ? {}
          : { topics: normalized.topics }),
      });
      const redecodeService = new RedecodeService({
        ...(normalized.observability.logger === undefined
          ? {}
          : { logger: normalized.observability.logger }),
        storage,
        target,
      });
      emitLogSafely(normalized.observability.logger, {
        event: "sdk_initialized",
        level: "info",
        message: "EVMEventLake SDK initialized",
        context: { targetKey: target.targetKey },
      });
      return new EVMEventLake({
        queryService,
        redecodeService,
        storage,
        targetKey: target.targetKey,
        updateService,
      });
    } catch (error) {
      await storage.close().catch(() => undefined);
      throw error;
    }
  }

  public async update(options: UpdateOptions = {}): Promise<UpdateResult> {
    this.#assertOpen();
    if (this.#activeOperation !== null) {
      throw new SynchronizationLockedError(
        "This SDK instance already has an active update or redecode operation",
        { context: { targetKey: this.#targetKey } },
      );
    }
    const signal =
      options.signal === undefined
        ? this.#lifecycleAbortController.signal
        : AbortSignal.any([
            options.signal,
            this.#lifecycleAbortController.signal,
          ]);
    const updatePromise = this.#updateService.update({ ...options, signal });
    this.#activeOperation = updatePromise;
    try {
      return await updatePromise;
    } finally {
      if (this.#activeOperation === updatePromise) this.#activeOperation = null;
    }
  }

  public async redecode(options: RedecodeOptions): Promise<RedecodeResult> {
    this.#assertOpen();
    if (this.#activeOperation !== null) {
      throw new SynchronizationLockedError(
        "This SDK instance already has an active update or redecode operation",
        { context: { targetKey: this.#targetKey } },
      );
    }
    const signal =
      options.signal === undefined
        ? this.#lifecycleAbortController.signal
        : AbortSignal.any([
            options.signal,
            this.#lifecycleAbortController.signal,
          ]);

    const newCatalog = new EventCatalog(options.abi);
    const redecodePromise = (async () => {
      const result = await this.#redecodeService.redecode(newCatalog, {
        ...options,
        signal,
      });
      const mergedCatalog = this.#queryService.catalog.merge(newCatalog);
      this.#queryService.setCatalog(mergedCatalog);
      this.#updateService.setCatalog(mergedCatalog);
      return result;
    })();

    this.#activeOperation = redecodePromise;
    try {
      return await redecodePromise;
    } finally {
      if (this.#activeOperation === redecodePromise) {
        this.#activeOperation = null;
      }
    }
  }

  public async getSyncStatus(): Promise<SyncStatus> {
    this.#assertOpen();
    const state = await this.#storage.getTargetState(this.#targetKey);
    if (state === null) {
      throw new ClientClosedError("Target state is unavailable");
    }
    return state;
  }

  public close(): Promise<void> {
    if (this.#closePromise !== null) return this.#closePromise;
    this.#closed = true;
    this.#lifecycleAbortController.abort();
    this.#closePromise = this.#closeResources();
    return this.#closePromise;
  }

  async #closeResources(): Promise<void> {
    await this.#activeOperation?.catch(() => undefined);
    await this.#storage.close();
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new ClientClosedError("EVMEventLake instance is closed");
    }
  }
}
