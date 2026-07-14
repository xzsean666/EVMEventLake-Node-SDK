import type { Address } from "viem";

export interface ContractTarget {
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly startBlock: bigint;
  readonly targetKey: string;
}

export function createContractTarget(input: {
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly startBlock: bigint;
}): ContractTarget {
  return Object.freeze({
    chainId: input.chainId,
    contractAddress: input.contractAddress.toLowerCase() as Address,
    startBlock: input.startBlock,
    targetKey: createTargetKey(input.chainId, input.contractAddress),
  });
}

export function createTargetKey(
  chainId: number,
  contractAddress: Address,
): string {
  return `${chainId}:${contractAddress.toLowerCase()}`;
}
