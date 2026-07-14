import { describe, expect, it } from "vitest";

import {
  AbiValidationError,
  ConfigurationValidationError,
  UnsupportedDatabaseUrlError,
  parseDatabaseConfiguration,
  redactUrl,
  validateSdkOptions,
} from "../../src/index.js";

const transferAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

describe("validateSdkOptions", () => {
  it("normalizes a valid configuration and applies documented defaults", () => {
    const normalized = validateSdkOptions({
      abi: transferAbi,
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000001",
      database: "sqlite://events.db",
      rpcUrls: ["https://rpc.example", "https://rpc.example/"],
      startBlock: 12_345,
    });

    expect(normalized.chainId).toBe(1);
    expect(normalized.startBlock).toBe(12_345n);
    expect(normalized.contractAddress).toBe(
      "0x0000000000000000000000000000000000000001",
    );
    expect(normalized.rpcUrls).toEqual(["https://rpc.example/"]);
    expect(normalized.synchronization.confirmations).toBe(12);
    expect(normalized.synchronization.defaultBlockRange).toBe(2_000);
    expect(normalized.rpc.requestTimeoutMs).toBe(20_000);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.abi)).toBe(true);
  });

  it("supports PostgreSQL URLs without exposing credentials in redaction", () => {
    const database = parseDatabaseConfiguration(
      "postgresql://eventlake:secret@localhost:5432/eventlake?sslmode=require",
    );

    expect(database.kind).toBe("postgresql");
    expect(
      redactUrl(
        "postgresql://eventlake:secret@localhost:5432/eventlake?sslmode=require",
      ),
    ).toBe("postgresql://localhost:5432/eventlake");
  });

  it("rejects unsupported database schemes", () => {
    expect(() =>
      parseDatabaseConfiguration("mysql://localhost/events"),
    ).toThrow(UnsupportedDatabaseUrlError);
  });

  it("rejects invalid contract, chain, block, and RPC configuration", () => {
    const validOptions = {
      abi: transferAbi,
      chainId: 1,
      contractAddress: "0x0000000000000000000000000000000000000001",
      database: "sqlite://events.db",
      rpcUrls: ["https://rpc.example"],
      startBlock: 0n,
    } as const;

    expect(() => validateSdkOptions({ ...validOptions, chainId: 0 })).toThrow(
      ConfigurationValidationError,
    );
    expect(() =>
      validateSdkOptions({ ...validOptions, contractAddress: "invalid" }),
    ).toThrow(ConfigurationValidationError);
    expect(() =>
      validateSdkOptions({ ...validOptions, startBlock: -1 }),
    ).toThrow(ConfigurationValidationError);
    expect(() => validateSdkOptions({ ...validOptions, rpcUrls: [] })).toThrow(
      ConfigurationValidationError,
    );
    expect(() =>
      validateSdkOptions({ ...validOptions, rpcUrls: ["ws://rpc.example"] }),
    ).toThrow(ConfigurationValidationError);
  });

  it("rejects an ABI without events", () => {
    expect(() =>
      validateSdkOptions({
        abi: [
          {
            inputs: [],
            name: "balanceOf",
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
            type: "function",
          },
        ],
        chainId: 1,
        contractAddress: "0x0000000000000000000000000000000000000001",
        database: "sqlite://events.db",
        rpcUrls: ["https://rpc.example"],
        startBlock: 0,
      }),
    ).toThrow(AbiValidationError);
  });

  it("rejects policy ranges that cannot shrink safely", () => {
    expect(() =>
      validateSdkOptions({
        abi: transferAbi,
        chainId: 1,
        contractAddress: "0x0000000000000000000000000000000000000001",
        database: "sqlite://events.db",
        rpcUrls: ["https://rpc.example"],
        startBlock: 0,
        synchronization: {
          defaultBlockRange: 10,
          minimumBlockRange: 11,
        },
      }),
    ).toThrow(ConfigurationValidationError);
  });
});
