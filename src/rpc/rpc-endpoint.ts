import { createRpcEndpointIdentity } from "./rpc-error-classifier.js";

export type RpcEndpointValidationState = "invalid" | "unknown" | "valid";

export class RpcEndpoint {
  public cooldownUntil = 0;
  public readonly identity: string;
  public validationState: RpcEndpointValidationState = "unknown";
  public readonly url: string;

  public constructor(url: string) {
    this.identity = createRpcEndpointIdentity(url);
    this.url = url;
  }

  public isAvailable(now: number): boolean {
    return this.validationState !== "invalid" && this.cooldownUntil <= now;
  }

  public markCoolingDown(now: number, cooldownMs: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, now + cooldownMs);
  }
}
