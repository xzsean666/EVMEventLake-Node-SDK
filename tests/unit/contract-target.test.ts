import { describe, expect, it } from "vitest";

import {
  createContractTarget,
  createTargetKey,
} from "../support/internal-exports.js";

describe("contract target identity", () => {
  it("creates a stable lowercase chain and contract key", () => {
    const contractAddress =
      "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" as const;
    const target = createContractTarget({
      chainId: 1,
      contractAddress,
      startBlock: 6_082_465n,
    });

    expect(target.targetKey).toBe(
      "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
    expect(target.contractAddress).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
    expect(createTargetKey(1, contractAddress)).toBe(target.targetKey);
    expect(Object.isFrozen(target)).toBe(true);
  });
});
