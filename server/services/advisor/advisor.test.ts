import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { collectNumbers, finalizeAnswer, stripTradeInstructions, verifyFact } from "./guardrails";

const toolOutputs = [{ totals: { netWorth: 22300.5, cash: 1000 }, monthly: { surplus: 1050.5 }, pools: [{ progressPercent: 70.3, verifiedAmount: 7030 }] }];
const known = collectNumbers(toolOutputs);

describe("verifyFact", () => {
  test("accepts amounts that match calculated values, allowing rounding", () => {
    assert.equal(verifyFact("Your net worth is $22,300.50.", known), true);
    assert.equal(verifyFact("Your net worth is about $22,300.", known), true);
    assert.equal(verifyFact("Your surplus is $1,051 a month and your ring fund is 70.3% funded.", known), true);
  });
  test("rejects amounts that don't appear in any tool result", () => {
    assert.equal(verifyFact("You have $48,000 in savings.", known), false);
    assert.equal(verifyFact("Your pool is 95% funded.", known), false);
  });
  test("facts without numbers aren't flagged", () => {
    assert.equal(verifyFact("You have an emergency pool.", known), true);
  });
});

describe("stripTradeInstructions", () => {
  test("removes buy/sell instructions for securities", () => {
    for (const s of [
      "You should buy VTI now.",
      "Consider selling your Apple shares before earnings.",
      "Invest in an S&P 500 index fund with your surplus.",
      "Load up on bitcoin while it's cheap.",
      "Your best move is to buy TSLA.",
      "It's a good time to sell your bond funds.",
    ]) {
      const r = stripTradeInstructions(`Your surplus is $500. ${s} Keep saving.`);
      assert.equal(r.removed, true, s);
      assert.equal(r.text, "Your surplus is $500. Keep saving.");
    }
  });
  test("keeps the assistant's own refusals", () => {
    for (const s of [
      "I can't tell you whether to buy Tesla stock or how many shares to buy.",
      "I'm not able to recommend selling any specific fund.",
      "InvestSmart doesn't tell you which stocks to buy.",
      "Whether to buy Tesla stock is a personal investment decision.",
      "Many people buy index funds for retirement, but that's a choice to make with an adviser.",
    ]) {
      assert.equal(stripTradeInstructions(s).removed, false, s);
    }
  });
  test("leaves everyday buying and general education alone", () => {
    for (const s of [
      "If you buy a car with a $400 payment, your surplus drops to $650.",
      "Diversification means spreading money across many investments.",
      "You could sell unused items to boost your emergency fund.",
    ]) {
      assert.equal(stripTradeInstructions(s).removed, false, s);
    }
  });
});

describe("finalizeAnswer", () => {
  test("marks unverified facts, strips trade calls, and always adds the disclaimer", () => {
    const a = finalizeAnswer({
      answer: "You're on track. Buy more shares of VOO.",
      facts: ["Your net worth is $22,300.50.", "You hold $99,999 in bonds."],
      assumptions: ["No investment growth assumed."],
      estimates: ["At $500/month you'd finish in 6 months."],
      followUps: ["What about rent?"],
    }, toolOutputs, ["Your financial overview"]);
    assert.equal(a.answer, "You're on track.");
    assert.deepEqual(a.facts.map((f) => f.verified), [true, false]);
    assert.equal(a.notices.length, 2);
    assert.ok(a.disclaimer.includes("not a registered investment adviser"));
    assert.deepEqual(a.sources, ["Your financial overview"]);
  });
  test("strips markdown emphasis", () => {
    assert.equal(finalizeAnswer({ answer: "Share your **take-home pay**." }, [], []).answer, "Share your take-home pay.");
  });
  test("handles a plain-text reply", () => {
    const a = finalizeAnswer({ answer: "Hello" }, [], []);
    assert.equal(a.answer, "Hello");
    assert.deepEqual(a.facts, []);
  });
});
