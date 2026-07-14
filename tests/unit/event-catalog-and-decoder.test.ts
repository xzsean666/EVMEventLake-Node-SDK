import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Abi,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  EventCatalog,
  canonicalizeAbi,
  decodeRawEventLog,
  type RawEvmLog,
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
] as const satisfies Abi;

function createRawLog(overrides: Partial<RawEvmLog> = {}): RawEvmLog {
  return {
    address: getAddress("0x0000000000000000000000000000000000000010"),
    blockHash: `0x${"01".repeat(32)}`,
    blockNumber: 100n,
    data: "0x",
    logIndex: 0,
    removed: false,
    topics: [],
    transactionHash: `0x${"02".repeat(32)}`,
    transactionIndex: 0,
    ...overrides,
  };
}

describe("EventCatalog", () => {
  it("creates signatures, selectors, and order-independent ABI fingerprints", () => {
    const overloadedAbi = [
      ...transferAbi,
      {
        anonymous: false,
        inputs: [{ indexed: true, name: "value", type: "bytes32" }],
        name: "Transfer",
        type: "event",
      },
    ] as const satisfies Abi;

    const catalog = new EventCatalog(overloadedAbi);
    const reorderedCatalog = new EventCatalog([...overloadedAbi].reverse());

    expect(catalog.events.map((event) => event.signature)).toEqual([
      "Transfer(address,address,uint256)",
      "Transfer(bytes32)",
    ]);
    expect(catalog.abiFingerprint).toBe(reorderedCatalog.abiFingerprint);
    expect(canonicalizeAbi(overloadedAbi)).toBe(
      canonicalizeAbi([...overloadedAbi].reverse()),
    );
  });
});

describe("decodeRawEventLog", () => {
  it("decodes a known event and preserves indexed parameter topics", () => {
    const from = getAddress("0x0000000000000000000000000000000000000001");
    const to = getAddress("0x0000000000000000000000000000000000000002");
    const topics = encodeEventTopics({
      abi: transferAbi,
      eventName: "Transfer",
      args: { from, to },
    }) as unknown as readonly Hex[];
    const data = encodeAbiParameters([{ type: "uint256" }], [123n]);

    const result = decodeRawEventLog(
      new EventCatalog(transferAbi),
      createRawLog({ data, topics }),
    );

    expect(result.status).toBe("decoded");
    if (result.status !== "decoded") return;
    expect(result.eventSignature).toBe("Transfer(address,address,uint256)");
    expect(result.arguments).toEqual({ from, to, value: 123n });
    expect(result.parameters[0]?.rawTopicValue).toBe(topics[1]);
    expect(result.parameters[1]?.rawTopicValue).toBe(topics[2]);
    expect(result.parameters[2]?.comparableValue).toContain("123");
  });

  it("returns unknown for an unrecognized topic", () => {
    const result = decodeRawEventLog(
      new EventCatalog(transferAbi),
      createRawLog({ topics: [`0x${"ff".repeat(32)}`] }),
    );
    expect(result).toEqual({ status: "unknown" });
  });

  it("retains a decode failure when a known selector has malformed data", () => {
    const topics = encodeEventTopics({
      abi: transferAbi,
      eventName: "Transfer",
      args: {
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
      },
    }) as unknown as readonly Hex[];
    const result = decodeRawEventLog(
      new EventCatalog(transferAbi),
      createRawLog({ data: "0x01", topics }),
    );

    expect(result.status).toBe("decode_failed");
    if (result.status !== "decode_failed") return;
    expect(result.candidateEventSignatures).toContain(
      "Transfer(address,address,uint256)",
    );
  });

  it("decodes anonymous events by testing anonymous ABI candidates", () => {
    const anonymousAbi = [
      {
        anonymous: true,
        inputs: [
          { indexed: true, name: "account", type: "address" },
          { indexed: false, name: "value", type: "uint256" },
        ],
        name: "AnonymousValue",
        type: "event",
      },
    ] as const satisfies Abi;
    const account = getAddress("0x0000000000000000000000000000000000000003");
    const topics = encodeEventTopics({
      abi: anonymousAbi,
      eventName: "AnonymousValue",
      args: { account },
    }) as readonly Hex[];
    const data = encodeAbiParameters([{ type: "uint256" }], [99n]);

    const result = decodeRawEventLog(
      new EventCatalog(anonymousAbi),
      createRawLog({ data, topics }),
    );

    expect(result.status).toBe("decoded");
    if (result.status !== "decoded") return;
    expect(result.arguments).toEqual({ account, value: 99n });
    expect(result.parameters[0]?.rawTopicValue).toBe(topics[0]);
  });
});
