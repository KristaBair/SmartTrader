import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { classifyQuoteFreshness, isUsMarketOpen } from "./dataProvenance";

// 2026-10-21 is a Wednesday (EDT, UTC-4); 2026-12-02 is a Wednesday (EST, UTC-5).
describe("isUsMarketOpen", () => {
  test("open during the regular session", () => {
    assert.equal(isUsMarketOpen(new Date("2026-10-21T14:00:00Z")), true); // 10:00 EDT
  });

  test("closed before the open and after the close", () => {
    assert.equal(isUsMarketOpen(new Date("2026-10-21T13:00:00Z")), false); // 09:00 EDT
    assert.equal(isUsMarketOpen(new Date("2026-10-21T20:00:00Z")), false); // 16:00 EDT exactly
  });

  test("closed on weekends", () => {
    assert.equal(isUsMarketOpen(new Date("2026-10-24T15:00:00Z")), false); // Saturday
  });

  test("follows New York time across the daylight-saving change", () => {
    assert.equal(isUsMarketOpen(new Date("2026-12-02T14:45:00Z")), true);  // 09:45 EST
    assert.equal(isUsMarketOpen(new Date("2026-12-02T14:15:00Z")), false); // 09:15 EST
  });
});

describe("classifyQuoteFreshness", () => {
  const now = new Date("2026-10-21T15:00:00Z"); // 11:00 EDT, market open

  test("recent quote during market hours is real-time", () => {
    assert.equal(classifyQuoteFreshness(new Date(now.getTime() - 60_000), now), "real-time");
  });

  test("old quote during market hours is delayed", () => {
    assert.equal(classifyQuoteFreshness(new Date(now.getTime() - 20 * 60_000), now), "delayed");
  });

  test("any quote while the market is closed is the previous close", () => {
    const evening = new Date("2026-10-21T23:00:00Z");
    assert.equal(classifyQuoteFreshness(new Date("2026-10-21T20:00:00Z"), evening), "previous-close");
  });
});
