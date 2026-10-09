import { describe, expect, it } from "vitest";
import { getConfig } from "../../src/config.js";

describe("getConfig", () => {
  it("accepts explicit test configuration", () => {
    const config = getConfig({
      databaseUrl: "postgres://example",
      host: "127.0.0.1",
      port: 4321,
      webOrigin: "http://localhost:3000",
      sessionTtlDays: 7,
      nodeEnv: "test",
    });

    expect(config.port).toBe(4321);
    expect(config.sessionTtlDays).toBe(7);
    expect(config.nodeEnv).toBe("test");
  });
});
