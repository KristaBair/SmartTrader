// AI Advisor: answers planning questions using only the app's deterministic
// calculations as its source of facts. Conversations are not stored.

import { z } from "zod";

export const advisorPrefsSchema = z.object({
  // Each switch controls whether the advisor may read that part of the user's data.
  useAccounts: z.boolean().default(true),
  useSpending: z.boolean().default(true),
  usePoolsAndGoals: z.boolean().default(true),
});
export type AdvisorPrefs = z.infer<typeof advisorPrefsSchema>;

export const advisorRequestSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  // Earlier turns kept by the browser for follow-ups; plain text only.
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(4000),
  })).max(10).default([]),
});
export type AdvisorRequest = z.infer<typeof advisorRequestSchema>;

export interface AdvisorFact {
  text: string;
  // True when every dollar amount in it matches a value the app calculated.
  verified: boolean;
}

export interface AdvisorAnswer {
  answer: string;
  facts: AdvisorFact[];
  assumptions: string[];
  estimates: string[];
  // Information the advisor needs from the user to answer fully.
  needsInfo: string[];
  followUps: string[];
  // Which calculations were used, in plain language.
  sources: string[];
  notices: string[];
  disclaimer: string;
}
