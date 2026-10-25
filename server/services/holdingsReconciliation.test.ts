import { test } from "node:test";
import assert from "node:assert/strict";
import { findOverlappingSymbols } from "./holdingsReconciliation";

test("finds tickers present in both manual and linked holdings", () => {
  assert.deepEqual(findOverlappingSymbols(["VTI", "AAPL", "MSFT"], ["AAPL", "VTI", "BND"]), ["AAPL", "VTI"]);
});

test("matches regardless of case and whitespace, and reports each ticker once", () => {
  assert.deepEqual(findOverlappingSymbols([" vti", "VTI", "aapl "], ["VTI", "AAPL"]), ["AAPL", "VTI"]);
});

test("returns nothing when there is no overlap or no linked holdings", () => {
  assert.deepEqual(findOverlappingSymbols(["VTI"], ["BND"]), []);
  assert.deepEqual(findOverlappingSymbols(["VTI"], []), []);
  assert.deepEqual(findOverlappingSymbols([""], [""]), []);
});
