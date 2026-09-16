import { CooldownTracker } from "evm-call";

import { createRpcEndpointIdentity } from "./rpc-error-classifier.js";

export type RpcEndpointValidationState = "invalid" | "unknown" | "valid";

export class RpcEndpoint {
  public batchSupported = true;
  public readonly identity: string;
  public validationState: RpcEndpointValidationState = "unknown";
  public readonly url: string;
  readonly #tracker: CooldownTracker;
  #explicitCooldownUntil = 0;

  public constructor(url: string, now?: () => number) {
    this.identity = createRpcEndpointIdentity(url);
    this.url = url;
    this.#tracker = new CooldownTracker(
      now !== undefined ? { clock: { now } } : undefined,
    );
  }

  public get cooldownUntil(): number {
    const state = this.#tracker.getState();
    return Math.max(this.#explicitCooldownUntil, state.cooldownUntil ?? 0);
  }

  public set cooldownUntil(value: number) {
    this.#explicitCooldownUntil = value;
  }

  public isAvailable(now: number): boolean {
    if (this.validationState === "invalid") return false;
    if (this.#explicitCooldownUntil > now) return false;
    return !this.#tracker.isCoolingDown(now);
  }

  public markCoolingDown(now: number, cooldownMs: number): void {
    this.#explicitCooldownUntil = Math.max(
      this.#explicitCooldownUntil,
      now + cooldownMs,
    );
    this.#tracker.recordFailure(now);
  }

  public recordSuccess(): void {
    this.#explicitCooldownUntil = 0;
    this.#tracker.recordSuccess();
  }

  public getCooldownTracker(): CooldownTracker {
    return this.#tracker;
  }
}
