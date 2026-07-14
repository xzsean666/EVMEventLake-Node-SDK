import { describe, expect, it } from "vitest";

import {
  planSynchronizationRanges,
  splitSynchronizationRange,
} from "../support/internal-exports.js";

describe("synchronization range planner", () => {
  it("plans gap-free inclusive preferred ranges", () => {
    expect(planSynchronizationRanges(100n, 105n, 2)).toEqual([
      { fromBlock: 100n, toBlock: 101n },
      { fromBlock: 102n, toBlock: 103n },
      { fromBlock: 104n, toBlock: 105n },
    ]);
  });

  it("splits ranges without overlap and honors the minimum child size", () => {
    expect(
      splitSynchronizationRange({ fromBlock: 100n, toBlock: 109n }, 2),
    ).toEqual([
      { fromBlock: 100n, toBlock: 104n },
      { fromBlock: 105n, toBlock: 109n },
    ]);
    expect(
      splitSynchronizationRange({ fromBlock: 100n, toBlock: 102n }, 2),
    ).toBeNull();
  });
});
