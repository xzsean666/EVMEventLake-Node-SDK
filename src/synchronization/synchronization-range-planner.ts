import { ConfigurationValidationError } from "../errors/evm-event-lake-errors.js";

export interface SynchronizationRange {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
}

export function* iterateSynchronizationRanges(
  fromBlock: bigint,
  toBlock: bigint,
  blockRange: number,
): Generator<SynchronizationRange> {
  validateRange(fromBlock, toBlock, blockRange);
  const rangeSize = BigInt(blockRange);
  let currentBlock = fromBlock;
  while (currentBlock <= toBlock) {
    const rangeEnd = minBigInt(toBlock, currentBlock + rangeSize - 1n);
    yield Object.freeze({ fromBlock: currentBlock, toBlock: rangeEnd });
    currentBlock = rangeEnd + 1n;
  }
}

export function planSynchronizationRanges(
  fromBlock: bigint,
  toBlock: bigint,
  blockRange: number,
): readonly SynchronizationRange[] {
  return Object.freeze([
    ...iterateSynchronizationRanges(fromBlock, toBlock, blockRange),
  ]);
}

export function splitSynchronizationRange(
  range: SynchronizationRange,
  minimumBlockRange: number,
): readonly [SynchronizationRange, SynchronizationRange] | null {
  if (!Number.isSafeInteger(minimumBlockRange) || minimumBlockRange <= 0) {
    throw new ConfigurationValidationError(
      "minimumBlockRange must be a positive safe integer",
    );
  }
  const size = synchronizationRangeSize(range);
  const minimumSize = BigInt(minimumBlockRange);
  if (size < minimumSize * 2n) return null;

  const leftSize = size / 2n;
  const left = Object.freeze({
    fromBlock: range.fromBlock,
    toBlock: range.fromBlock + leftSize - 1n,
  });
  const right = Object.freeze({
    fromBlock: left.toBlock + 1n,
    toBlock: range.toBlock,
  });
  return Object.freeze([left, right]);
}

export function synchronizationRangeSize(range: SynchronizationRange): bigint {
  return range.toBlock - range.fromBlock + 1n;
}

function validateRange(
  fromBlock: bigint,
  toBlock: bigint,
  blockRange: number,
): void {
  if (fromBlock < 0n || toBlock < fromBlock) {
    throw new ConfigurationValidationError(
      "Synchronization block range is invalid",
    );
  }
  if (!Number.isSafeInteger(blockRange) || blockRange <= 0) {
    throw new ConfigurationValidationError(
      "blockRange must be a positive safe integer",
    );
  }
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
