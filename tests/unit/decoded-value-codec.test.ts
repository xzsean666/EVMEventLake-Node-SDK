import { describe, expect, it } from "vitest";

import {
  DecodedValueCodecError,
  decodeDecodedValue,
  encodeDecodedValue,
} from "../../src/index.js";

describe("decoded value codec", () => {
  it("round-trips bigint, tuples, arrays, bytes, and primitive values", () => {
    const value = {
      amount: 123_456_789_012_345_678_901_234_567_890n,
      enabled: true,
      nested: [1n, "0x1234", { owner: "0xabc", value: null }],
    };

    expect(decodeDecodedValue(encodeDecodedValue(value))).toEqual(value);
  });

  it("produces deterministic output for object key order", () => {
    expect(encodeDecodedValue({ beta: 2n, alpha: 1n })).toBe(
      encodeDecodedValue({ alpha: 1n, beta: 2n }),
    );
  });

  it("rejects unsupported, cyclic, or malformed values", () => {
    expect(() => encodeDecodedValue(undefined)).toThrow(DecodedValueCodecError);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => encodeDecodedValue(cyclic)).toThrow(DecodedValueCodecError);
    expect(() => decodeDecodedValue("not-json")).toThrow(
      DecodedValueCodecError,
    );
    expect(() => decodeDecodedValue('{"type":"bigint","value":"x"}')).toThrow(
      DecodedValueCodecError,
    );
  });
});
