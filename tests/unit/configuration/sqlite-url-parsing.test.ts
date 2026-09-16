import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  UnsupportedDatabaseUrlError,
  createSqliteStorageAdapter,
  parseDatabaseConfiguration,
  redactUrl,
} from "../../support/internal-exports.js";

describe("SQLite URL and Path Normalization", () => {
  describe("Relative file paths", () => {
    it("normalizes sqlite:relative-path to process.cwd()", () => {
      const config = parseDatabaseConfiguration("sqlite:events.db");
      expect(config).toEqual({
        filename: resolve(process.cwd(), "events.db"),
        kind: "sqlite",
      });
      expect(Object.isFrozen(config)).toBe(true);
    });

    it("normalizes sqlite://relative-path to process.cwd()", () => {
      const config = parseDatabaseConfiguration("sqlite://events.db");
      expect(config).toEqual({
        filename: resolve(process.cwd(), "events.db"),
        kind: "sqlite",
      });
    });

    it("normalizes sqlite:./path and sqlite://./path", () => {
      expect(parseDatabaseConfiguration("sqlite:./events.db")).toEqual({
        filename: resolve(process.cwd(), "./events.db"),
        kind: "sqlite",
      });
      expect(parseDatabaseConfiguration("sqlite://./events.db")).toEqual({
        filename: resolve(process.cwd(), "./events.db"),
        kind: "sqlite",
      });
    });

    it("normalizes sqlite:../path and sqlite://../path", () => {
      expect(parseDatabaseConfiguration("sqlite:../data/events.db")).toEqual({
        filename: resolve(process.cwd(), "../data/events.db"),
        kind: "sqlite",
      });
      expect(parseDatabaseConfiguration("sqlite://../data/events.db")).toEqual({
        filename: resolve(process.cwd(), "../data/events.db"),
        kind: "sqlite",
      });
    });

    it("normalizes bare relative paths without scheme", () => {
      expect(parseDatabaseConfiguration("./events.db")).toEqual({
        filename: resolve(process.cwd(), "./events.db"),
        kind: "sqlite",
      });
      expect(parseDatabaseConfiguration("../data/events.db")).toEqual({
        filename: resolve(process.cwd(), "../data/events.db"),
        kind: "sqlite",
      });
      expect(parseDatabaseConfiguration("events.db")).toEqual({
        filename: resolve(process.cwd(), "events.db"),
        kind: "sqlite",
      });
    });
  });

  describe("Absolute POSIX paths", () => {
    it("preserves sqlite:///var/data/events.db absolute path", () => {
      expect(
        parseDatabaseConfiguration("sqlite:///var/data/events.db"),
      ).toEqual({
        filename: "/var/data/events.db",
        kind: "sqlite",
      });
    });

    it("preserves sqlite:/var/data/events.db single-slash absolute path", () => {
      expect(parseDatabaseConfiguration("sqlite:/var/data/events.db")).toEqual({
        filename: "/var/data/events.db",
        kind: "sqlite",
      });
    });

    it("preserves bare /var/data/events.db absolute path", () => {
      expect(parseDatabaseConfiguration("/var/data/events.db")).toEqual({
        filename: "/var/data/events.db",
        kind: "sqlite",
      });
    });
  });

  describe("Windows drive paths", () => {
    it("strips leading slash from sqlite:///C:/path/db.sqlite", () => {
      expect(parseDatabaseConfiguration("sqlite:///C:/data/events.db")).toEqual(
        {
          filename: "C:/data/events.db",
          kind: "sqlite",
        },
      );
    });

    it("supports sqlite://C:/data/events.db", () => {
      expect(parseDatabaseConfiguration("sqlite://C:/data/events.db")).toEqual({
        filename: "C:/data/events.db",
        kind: "sqlite",
      });
    });

    it("supports sqlite:C:/data/events.db", () => {
      expect(parseDatabaseConfiguration("sqlite:C:/data/events.db")).toEqual({
        filename: "C:/data/events.db",
        kind: "sqlite",
      });
    });

    it("supports sqlite:C:\\data\\events.db with backslashes", () => {
      expect(parseDatabaseConfiguration("sqlite:C:\\data\\events.db")).toEqual({
        filename: "C:\\data\\events.db",
        kind: "sqlite",
      });
    });

    it("supports sqlite:///C:\\data\\events.db with leading slash and backslashes", () => {
      expect(
        parseDatabaseConfiguration("sqlite:///C:\\data\\events.db"),
      ).toEqual({
        filename: "C:\\data\\events.db",
        kind: "sqlite",
      });
    });

    it("supports bare Windows drive paths C:\\... and C:/...", () => {
      expect(parseDatabaseConfiguration("C:\\data\\events.db")).toEqual({
        filename: "C:\\data\\events.db",
        kind: "sqlite",
      });
      expect(parseDatabaseConfiguration("D:/storage/events.db")).toEqual({
        filename: "D:/storage/events.db",
        kind: "sqlite",
      });
    });
  });

  describe("In-memory SQLite databases", () => {
    it("handles :memory: flag across all documented variations", () => {
      expect(parseDatabaseConfiguration(":memory:")).toEqual({
        filename: ":memory:",
        kind: "sqlite",
      });
      expect(parseDatabaseConfiguration("sqlite::memory:")).toEqual({
        filename: ":memory:",
        kind: "sqlite",
      });
      expect(parseDatabaseConfiguration("sqlite://:memory:")).toEqual({
        filename: ":memory:",
        kind: "sqlite",
      });
      expect(parseDatabaseConfiguration("file::memory:")).toEqual({
        filename: ":memory:",
        kind: "sqlite",
      });
    });

    it("preserves :memory: in redactUrl", () => {
      expect(redactUrl(":memory:")).toBe(":memory:");
      expect(redactUrl("sqlite::memory:")).toBe("sqlite::memory:");
      expect(redactUrl("sqlite://:memory:")).toBe("sqlite://:memory:");
    });

    it("initializes and destroys in-memory SQLite storage adapter successfully", async () => {
      const adapter = createSqliteStorageAdapter(":memory:");
      await expect(adapter.initialize()).resolves.toBeUndefined();
      await expect(adapter.close()).resolves.toBeUndefined();
    });
  });

  describe("file:// scheme aliases", () => {
    it("supports file:///var/data/events.db", () => {
      expect(parseDatabaseConfiguration("file:///var/data/events.db")).toEqual({
        filename: "/var/data/events.db",
        kind: "sqlite",
      });
    });

    it("supports file://events.db and file:events.db relative paths", () => {
      expect(parseDatabaseConfiguration("file://events.db")).toEqual({
        filename: resolve(process.cwd(), "events.db"),
        kind: "sqlite",
      });
      expect(parseDatabaseConfiguration("file:events.db")).toEqual({
        filename: resolve(process.cwd(), "events.db"),
        kind: "sqlite",
      });
    });

    it("supports file:///C:/data/events.db", () => {
      expect(parseDatabaseConfiguration("file:///C:/data/events.db")).toEqual({
        filename: "C:/data/events.db",
        kind: "sqlite",
      });
    });
  });

  describe("Paths with spaces and percent-encoding", () => {
    it("decodes percent-encoded spaces", () => {
      expect(
        parseDatabaseConfiguration("sqlite:///var/data/my%20events/events.db"),
      ).toEqual({
        filename: "/var/data/my events/events.db",
        kind: "sqlite",
      });
    });

    it("accepts literal spaces in paths", () => {
      expect(
        parseDatabaseConfiguration("sqlite:///var/data/my events/events.db"),
      ).toEqual({
        filename: "/var/data/my events/events.db",
        kind: "sqlite",
      });
    });
  });

  describe("Rejection of malformed URLs and unsupported schemes", () => {
    it("rejects empty SQLite URLs", () => {
      expect(() => parseDatabaseConfiguration("sqlite:")).toThrow(
        UnsupportedDatabaseUrlError,
      );
      expect(() => parseDatabaseConfiguration("sqlite://")).toThrow(
        UnsupportedDatabaseUrlError,
      );
      expect(() => parseDatabaseConfiguration("sqlite:///")).toThrow(
        UnsupportedDatabaseUrlError,
      );
    });

    it("rejects URLs containing queries or fragments", () => {
      expect(() =>
        parseDatabaseConfiguration("sqlite://events.db?mode=ro"),
      ).toThrow(UnsupportedDatabaseUrlError);
      expect(() =>
        parseDatabaseConfiguration("sqlite://events.db#section"),
      ).toThrow(UnsupportedDatabaseUrlError);
      expect(() =>
        parseDatabaseConfiguration("sqlite:./events.db?wal=true"),
      ).toThrow(UnsupportedDatabaseUrlError);
      expect(() => parseDatabaseConfiguration("./events.db?wal=true")).toThrow(
        UnsupportedDatabaseUrlError,
      );
    });

    it("rejects unsupported schemes", () => {
      expect(() =>
        parseDatabaseConfiguration("mysql://localhost/events"),
      ).toThrow(UnsupportedDatabaseUrlError);
      expect(() =>
        parseDatabaseConfiguration("redis://localhost:6379"),
      ).toThrow(UnsupportedDatabaseUrlError);
      expect(() =>
        parseDatabaseConfiguration("http://localhost/events.db"),
      ).toThrow(UnsupportedDatabaseUrlError);
    });
  });
});
