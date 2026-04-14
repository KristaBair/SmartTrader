/**
 * useSignalPolling.ts
 *
 * Polls /api/trading-signals every POLL_INTERVAL_MS.
 * Tracks which signal IDs have already been shown (stored in localStorage
 * so they don't re-trigger on page reload).
 * Returns only NEW signals on each poll so the alerts overlay can show them.
 */

import { useState, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";

export interface TradingSignal {
  id: string;
  ticker: string;
  action: "BUY" | "SELL";
  reason: string;
  confidence: number;
  urgency: "high" | "medium";
  newsHeadline?: string;
}

const POLL_INTERVAL_MS = 3 * 60 * 1000; // every 3 minutes
const SEEN_KEY = "smarttrader_seen_signals";
const MAX_SEEN = 200; // cap stored IDs to avoid localStorage bloat

function getSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function markSeen(ids: string[]) {
  try {
    const seen = getSeenIds();
    ids.forEach(id => seen.add(id));
    // Trim to last MAX_SEEN
    const trimmed = Array.from(seen).slice(-MAX_SEEN);
    localStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
  } catch {}
}

export function useSignalPolling(enabled: boolean) {
  const [newSignals, setNewSignals] = useState<TradingSignal[]>([]);
  const isFetchingRef = useRef(false);

  async function fetchSignals() {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const res = await apiRequest("GET", "/api/trading-signals");
      const data = await res.json();
      const signals: TradingSignal[] = data.signals || [];
      if (signals.length === 0) return;

      const seen = getSeenIds();
      const fresh = signals.filter(s => !seen.has(s.id));
      if (fresh.length > 0) {
        markSeen(fresh.map(s => s.id));
        setNewSignals(fresh);
      }
    } catch (err) {
      // Silently fail — don't interrupt the user with error toasts for background polling
    } finally {
      isFetchingRef.current = false;
    }
  }

  useEffect(() => {
    if (!enabled) return;

    // Fetch immediately on mount, then on interval
    fetchSignals();
    const timer = setInterval(fetchSignals, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  // Clear signals after they've been consumed by the UI
  function clearSignals() {
    setNewSignals([]);
  }

  return { newSignals, clearSignals };
}
