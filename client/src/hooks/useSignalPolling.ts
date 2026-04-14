// Runs in the background while the user is signed in.
// Every 3 minutes it asks the server to scan the latest news for BUY/SELL signals.
// Signals the user has already seen are tracked in localStorage so they never pop up twice.

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

const POLL_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes — keeps us within free News API limits
const SEEN_KEY = "smarttrader_seen_signals"; // localStorage key for deduplication
const MAX_SEEN = 200; // cap so we don't fill up localStorage with thousands of old IDs

function getSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

// Add newly seen IDs and trim the list if it gets too long
function markSeen(ids: string[]) {
  try {
    const seen = getSeenIds();
    ids.forEach(id => seen.add(id));
    const trimmed = Array.from(seen).slice(-MAX_SEEN);
    localStorage.setItem(SEEN_KEY, JSON.stringify(trimmed));
  } catch {}
}

export function useSignalPolling(enabled: boolean) {
  const [newSignals, setNewSignals] = useState<TradingSignal[]>([]);

  // Ref instead of state so we don't trigger re-renders just to track "is fetching"
  const isFetchingRef = useRef(false);

  async function fetchSignals() {
    // Skip if a fetch is already in flight — prevents overlap on slow connections
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const res = await apiRequest("GET", "/api/trading-signals");
      const data = await res.json();
      const signals: TradingSignal[] = data.signals || [];
      if (signals.length === 0) return;

      // Filter out anything we've already shown to avoid repeat alerts
      const seen = getSeenIds();
      const fresh = signals.filter(s => !seen.has(s.id));

      if (fresh.length > 0) {
        markSeen(fresh.map(s => s.id));
        setNewSignals(fresh); // this triggers TradingAlerts to pop them up
      }
    } catch {
      // Silently swallow errors — background polling shouldn't interrupt the user
    } finally {
      isFetchingRef.current = false;
    }
  }

  useEffect(() => {
    if (!enabled) return;

    // Hit it once right away so users don't wait 3 minutes for the first signal
    fetchSignals();
    const timer = setInterval(fetchSignals, POLL_INTERVAL_MS);
    return () => clearInterval(timer); // clean up when user signs out
  }, [enabled]);

  // The UI calls this after consuming the signals so we don't re-show them
  function clearSignals() {
    setNewSignals([]);
  }

  return { newSignals, clearSignals };
}
