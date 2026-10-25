// API for the AI Advisor. Registered after requireAuth and the Terms check.
// Questions and answers are not stored.

import type { Express } from "express";
import { storage } from "./storage";
import { getUserId } from "./auth";
import { askAdvisor } from "./services/advisor/advisor";
import { advisorPrefsSchema, advisorRequestSchema } from "@shared/advisor";

// Keeps Bedrock usage bounded per user. In memory, so it resets on restart.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_QUESTIONS = 15;
const recent = new Map<string, number[]>();

export function takeAdvisorSlot(userId: string, now = Date.now()): boolean {
  const times = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= MAX_QUESTIONS) {
    recent.set(userId, times);
    return false;
  }
  times.push(now);
  recent.set(userId, times);
  return true;
}

export function registerAdvisorRoutes(app: Express) {
  app.get("/api/advisor/prefs", async (_req, res) => {
    try {
      res.json(await storage.getAdvisorPrefs(getUserId(res)));
    } catch (error) {
      console.error("Load advisor prefs error:", error);
      res.status(500).json({ message: "Could not load your AI Advisor settings." });
    }
  });

  app.put("/api/advisor/prefs", async (req, res) => {
    const parsed = advisorPrefsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid settings" });
    try {
      await storage.saveAdvisorPrefs(getUserId(res), parsed.data);
      res.json(parsed.data);
    } catch (error) {
      console.error("Save advisor prefs error:", error);
      res.status(500).json({ message: "Could not save your settings." });
    }
  });

  app.post("/api/advisor/ask", async (req, res) => {
    const parsed = advisorRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid question" });
    const userId = getUserId(res);
    if (!takeAdvisorSlot(userId)) {
      return res.status(429).json({ message: `You've asked ${MAX_QUESTIONS} questions in the last 10 minutes. Please wait a few minutes and try again.` });
    }
    try {
      const prefs = await storage.getAdvisorPrefs(userId);
      res.json(await askAdvisor(userId, prefs, parsed.data));
    } catch (error) {
      const name = (error as Error).name;
      console.error("Advisor error:", name, (error as Error).message);
      const unavailable = ["ResourceNotFoundException", "AccessDeniedException", "ThrottlingException", "ServiceUnavailableException", "ModelNotReadyException"].includes(name);
      res.status(unavailable ? 503 : 500).json({
        message: unavailable ? "The AI Advisor isn't available right now. Your planners and data still work; try again later." : "The AI Advisor couldn't answer that. Try again.",
      });
    }
  });
}
