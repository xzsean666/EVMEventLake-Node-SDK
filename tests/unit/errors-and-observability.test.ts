import { describe, expect, it, vi } from "vitest";

import {
  ConfigurationValidationError,
  emitLogSafely,
  emitProgressSafely,
} from "../../src/index.js";

describe("public errors", () => {
  it("preserves stable error codes and frozen safe context", () => {
    const error = new ConfigurationValidationError("invalid option", {
      context: { field: "chainId" },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("CONFIGURATION_VALIDATION_ERROR");
    expect(error.context).toEqual({ field: "chainId" });
    expect(Object.isFrozen(error.context)).toBe(true);
  });
});

describe("observability isolation", () => {
  it("swallows logger and progress callback failures", () => {
    const logger = {
      log: vi.fn(() => {
        throw new Error("logger failed");
      }),
    };
    const onProgress = vi.fn(() => {
      throw new Error("progress failed");
    });

    expect(() =>
      emitLogSafely(logger, {
        event: "test",
        level: "info",
        message: "test",
      }),
    ).not.toThrow();
    expect(() =>
      emitProgressSafely(onProgress, { stage: "update_started" }),
    ).not.toThrow();
  });
});
