// AI Advisor: Claude on Amazon Bedrock answers planning questions by calling
// the app's deterministic tools, then its answer is checked before it's shown:
// - every dollar figure stated as a fact must match a calculated value,
// - statements that read like buy/sell instructions for securities are removed.

import {
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { awsConfig, bedrock } from "../../aws";
import { extractJsonObject } from "../bedrock";
import { ADVISOR_TOOLS, runTool, type ToolContext } from "./tools";
import type { AdvisorAnswer, AdvisorPrefs, AdvisorRequest } from "@shared/advisor";
import { finalizeAnswer } from "./guardrails";

export { ADVISOR_DISCLAIMER } from "./guardrails";

const MAX_STEPS = 6;
const MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You are the InvestSmart planning assistant. You help people understand their own finances: budgeting, saving, emergency funds, rent, debt payoff, savings pools, goals, and retirement planning.

Facts
- The only source of facts about the user is the tool results. Never invent balances, income, spending, transactions, projections, ages, or any personal information.
- Use the tools to get numbers; don't do your own projections when a tool can calculate them. You may add or subtract tool numbers, but say so.
- If something needed is missing (age, gross income, a price), ask for it in "needsInfo" instead of guessing. If a tool says access is turned off, say so.
- Savings pools are earmarks on existing money, not extra money.
- Money for emergencies means cash and savings only; investments and retirement accounts don't count.

Scope
- This is education and planning, not personalized investment advice. Never tell the user to buy, sell, or hold any specific stock, ETF, fund, bond, option, or cryptocurrency, and don't suggest specific securities or allocations. You may explain general concepts (for example, what diversification means) and point to the app's planners.
- Don't claim to be a financial adviser or fiduciary. Mention a qualified professional for tax, legal, or investment decisions when relevant.

Answer format
Every reply, including one that only asks the user for information, must be only a JSON object with no markdown and no text before or after it:
{"answer": "2-5 plain-language sentences that directly answer the question",
 "facts": ["each a specific fact taken from tool results, with its number"],
 "assumptions": ["assumptions behind the answer, including the tools' stated assumptions"],
 "estimates": ["projections or predictions, clearly worded as estimates"],
 "needsInfo": ["questions for the user, if anything is missing"],
 "followUps": ["up to 3 short follow-up questions the user might ask next"]}
Keep "facts" separate from "estimates". Use dollar amounts exactly as the tools give them. If you need information from the user, say so briefly in "answer" and list the questions in "needsInfo".`;

const TOOL_CONFIG: { tools: Tool[] } = {
  tools: ADVISOR_TOOLS.map((t) => ({
    toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.inputSchema as DocumentType } },
  })),
};

// ── Conversation loop ───────────────────────────────────────────────────────

export async function askAdvisor(userId: string, prefs: AdvisorPrefs, request: AdvisorRequest): Promise<AdvisorAnswer> {
  const ctx: ToolContext = { userId, prefs, now: new Date(), memo: new Map() };
  const permissionNote = `Data the user allows: accounts=${prefs.useAccounts ? "on" : "off"}, spending=${prefs.useSpending ? "on" : "off"}, pools and goals=${prefs.usePoolsAndGoals ? "on" : "off"}. Today is ${ctx.now.toISOString().slice(0, 10)}.`;

  const messages: Message[] = request.history.map((turn) => ({ role: turn.role, content: [{ text: turn.content }] }));
  while (messages.length > 0 && messages[0].role !== "user") messages.shift();
  messages.push({ role: "user", content: [{ text: request.question }] });

  const toolOutputs: unknown[] = [];
  const sources = new Set<string>();

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await bedrock.send(new ConverseCommand({
      modelId: awsConfig.bedrockModelId,
      system: [{ text: SYSTEM_PROMPT }, { text: permissionNote }],
      messages,
      toolConfig: TOOL_CONFIG,
      inferenceConfig: { maxTokens: MAX_TOKENS },
    }));
    const content = response.output?.message?.content ?? [];
    messages.push({ role: "assistant", content });

    const toolUses = content.filter((block): block is ContentBlock.ToolUseMember => "toolUse" in block && Boolean(block.toolUse));
    if (response.stopReason !== "tool_use" || toolUses.length === 0) {
      const text = content.map((b) => ("text" in b ? b.text ?? "" : "")).join("").trim();
      let parsed: unknown;
      try { parsed = extractJsonObject(text); } catch { parsed = { answer: text }; }
      return finalizeAnswer(parsed, toolOutputs, Array.from(sources));
    }

    const results: ContentBlock[] = [];
    for (const block of toolUses) {
      const { toolUseId, name, input } = block.toolUse;
      const output = await runTool(ctx, name ?? "", (input ?? {}) as Record<string, unknown>);
      toolOutputs.push(output);
      const tool = ADVISOR_TOOLS.find((t) => t.name === name);
      if (tool && !(output && typeof output === "object" && "error" in output)) sources.add(tool.source);
      results.push({ toolResult: { toolUseId, content: [{ json: output as DocumentType }] } });
    }
    messages.push({ role: "user", content: results });
  }

  return finalizeAnswer({ answer: "That question needed more steps than allowed. Try asking about one thing at a time." }, toolOutputs, Array.from(sources));
}
