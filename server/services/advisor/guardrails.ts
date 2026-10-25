// Checks applied to every AI Advisor answer before it's shown. Pure, so they
// can be tested without Bedrock.

import type { AdvisorAnswer, AdvisorFact } from "@shared/advisor";

export const ADVISOR_DISCLAIMER =
  "InvestSmart provides financial education and planning tools, not personalized investment, tax, or legal advice, and is not a registered investment adviser. Check important decisions with a qualified professional.";

// ── Grounding ───────────────────────────────────────────────────────────────

export function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectNumbers(v, out));
  return out;
}

const DOLLAR = /-?\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/g;
const PERCENT = /(-?\d+(?:\.\d+)?)\s?%/g;

function matches(x: number, known: number[]) {
  return known.some((n) => Math.abs(x - n) <= 1 || Math.abs(x - Math.abs(n)) <= 1 || (Math.abs(n) >= 1000 && Math.abs(x - Math.abs(n)) / Math.abs(n) <= 0.005));
}

// A fact is verified when each dollar amount and percentage in it matches a
// number the tools returned (allowing rounding to the dollar or 0.5%).
export function verifyFact(text: string, known: number[]): boolean {
  const dollars = Array.from(text.matchAll(DOLLAR)).map((m) => Number(`${m[1].replace(/,/g, "")}${m[2] ?? ""}`));
  const percents = Array.from(text.matchAll(PERCENT)).map((m) => Math.abs(Number(m[1])));
  return [...dollars, ...percents].every((x) => matches(x, known));
}

// ── Securities-instruction filter ───────────────────────────────────────────

const SECURITY_WORDS = "(shares?|stocks?|etfs?|options?|calls?|puts?|bitcoin|ethereum|crypto(?:currenc(?:y|ies))?|index funds?|mutual funds?|bonds?|securit(?:y|ies))";
const TRADE_PATTERNS = [
  new RegExp(`\\b(buy(?:ing|s)?|sell(?:ing|s)?|short(?:ing)?|purchas(?:e|es|ing)|dump(?:ing)?|load(?:ing)? up on|invest(?:ing)? in)\\b[^.!?]{0,60}\\b${SECURITY_WORDS}\\b`, "i"),
  /\b(buy(?:ing)?|sell(?:ing)?|short(?:ing)?)\s+(some\s+|more\s+)?\$?[A-Z]{2,5}\b/,
];

// The assistant declining ("I can't tell you whether to buy a stock") is not an instruction.
const REFUSAL = /\b(I|we)\s+(can't|cannot|can not|won't|will not|don't|do not|am not able|'m not able|am unable|'m unable|am not allowed|'m not allowed)\b|\b(InvestSmart|this app|this tool)\s+(doesn't|does not|can't|cannot|won't)\b/i;

// Only recommendations count: "you should buy…", "consider selling…", or a bare
// command ("Buy VTI."). Merely discussing a trade ("whether to buy a stock is a
// personal decision") is left alone.
const RECOMMENDS = /\b(you should|you could|you might want to|you may want to|consider|i(?:'d| would)? recommend|i suggest|it(?:'s| is) (?:a )?(?:good|smart|wise|great) (?:idea|time|move) to|go ahead and|now is (?:a )?(?:good )?time to|(?:best|smart|right) (?:move|option|choice|bet) (?:is|would be) to)\b/i;
const COMMAND = /^\W*(buy|sell|short|purchase|dump|load up on|invest in)\b/i;

export function stripTradeInstructions(text: string): { text: string; removed: boolean } {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const isInstruction = (s: string) => !REFUSAL.test(s) && TRADE_PATTERNS.some((p) => p.test(s)) && (RECOMMENDS.test(s) || COMMAND.test(s));
  const kept = sentences.filter((s) => !isInstruction(s));
  return { text: kept.join(" ").trim(), removed: kept.length !== sentences.length };
}

const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, max) : [];

export function finalizeAnswer(raw: unknown, toolOutputs: unknown[], sources: string[]): AdvisorAnswer {
  const obj = (raw && typeof raw === "object" ? raw : { answer: String(raw ?? "") }) as Record<string, unknown>;
  const known = collectNumbers(toolOutputs);
  const notices: string[] = [];
  let removedTrade = false;
  const clean = (s: string) => {
    const r = stripTradeInstructions(s.replace(/\*\*|__/g, "").replace(/^#+\s*/gm, ""));
    removedTrade ||= r.removed;
    return r.text;
  };

  const facts: AdvisorFact[] = [];
  for (const text of strings(obj.facts, 12).map(clean).filter(Boolean)) {
    facts.push({ text, verified: verifyFact(text, known) });
  }
  if (facts.some((f) => !f.verified)) {
    notices.push("Some figures couldn't be matched to your calculated data and are marked as not verified. Treat them with care.");
  }
  const answer = clean(typeof obj.answer === "string" ? obj.answer : "");
  if (removedTrade) notices.push("A statement that read like an instruction to buy or sell a specific investment was removed. InvestSmart doesn't make securities recommendations.");

  return {
    answer: answer || "I couldn't put together an answer from your data. Try rephrasing the question.",
    facts,
    assumptions: strings(obj.assumptions, 10).map(clean).filter(Boolean),
    estimates: strings(obj.estimates, 10).map(clean).filter(Boolean),
    needsInfo: strings(obj.needsInfo, 5).map(clean).filter(Boolean),
    followUps: strings(obj.followUps, 3).map(clean).filter(Boolean),
    sources,
    notices,
    disclaimer: ADVISOR_DISCLAIMER,
  };
}
