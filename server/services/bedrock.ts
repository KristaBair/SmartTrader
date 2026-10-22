// Thin wrapper around the Amazon Bedrock Converse API.
// Every AI feature in the app goes through one of these two helpers so the model,
// retry behavior, and JSON handling live in one place.

import {
  ConverseCommand,
  type ContentBlock,
  type ImageFormat,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import { awsConfig, bedrock } from "../aws";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

interface ConverseOptions {
  system?: string;
  // Either a single prompt or a full conversation (for the onboarding chat).
  prompt?: string;
  history?: ChatTurn[];
  image?: { bytes: Uint8Array; format: ImageFormat };
  // Always set explicitly: leaving it unset reserves the model's maximum output quota.
  maxTokens: number;
}

function buildMessages({ prompt, history = [], image }: ConverseOptions): Message[] {
  const messages: Message[] = history.map((turn) => ({
    role: turn.role,
    content: [{ text: turn.content }],
  }));

  if (prompt !== undefined) {
    const content: ContentBlock[] = [];
    if (image) content.push({ image: { format: image.format, source: { bytes: image.bytes } } });
    content.push({ text: prompt });
    messages.push({ role: "user", content });
  }

  // Bedrock requires the conversation to start with a user turn.
  while (messages.length > 0 && messages[0].role !== "user") messages.shift();
  return messages;
}

// Returns the model's plain-text reply.
export async function converseText(options: ConverseOptions): Promise<string> {
  const response = await bedrock.send(
    new ConverseCommand({
      modelId: awsConfig.bedrockModelId,
      system: options.system ? [{ text: options.system }] : undefined,
      messages: buildMessages(options),
      inferenceConfig: { maxTokens: options.maxTokens },
    })
  );

  const text = (response.output?.message?.content ?? [])
    .map((block) => block.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("No response from Bedrock");
  return text;
}

// Asks for JSON and parses it. The prompts spell out the exact shape; this pulls
// the outermost {...} so stray prose or markdown fences don't break parsing.
export async function converseJson<T>(options: ConverseOptions): Promise<T> {
  const system = [options.system, "Respond with a single valid JSON object only. No markdown, no commentary."]
    .filter(Boolean)
    .join("\n\n");
  return extractJsonObject(await converseText({ ...options, system })) as T;
}

export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("AI response did not contain JSON");
  return JSON.parse(text.slice(start, end + 1));
}

// Maps an upload's MIME type to a format Bedrock accepts, or null if unsupported.
export function toImageFormat(mimeType: string): ImageFormat | null {
  const subtype = mimeType.split("/")[1]?.toLowerCase();
  if (subtype === "jpeg" || subtype === "jpg") return "jpeg";
  if (subtype === "png" || subtype === "gif" || subtype === "webp") return subtype;
  return null;
}
