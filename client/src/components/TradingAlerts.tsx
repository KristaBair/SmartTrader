// Pop-up trading signal cards that appear in the top-right corner.
// Green = BUY, red = SELL. Each one auto-dismisses after 12 seconds.
// Clicking the action button sends the user straight to Pattern Analyzer for that stock.

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { TrendingUp, TrendingDown, X, Zap } from "lucide-react";

export interface TradingSignal {
  id: string;
  ticker: string;
  action: "BUY" | "SELL";
  reason: string;
  confidence: number;
  urgency: "high" | "medium";
  newsHeadline?: string;
}

// Internal type that adds display state on top of the raw signal data
interface ActiveAlert extends TradingSignal {
  addedAt: number;  // timestamp so we can calculate how long it's been showing
  visible: boolean; // flipped to false just before we remove it (enables the slide-out animation)
}

interface TradingAlertsProps {
  signals: TradingSignal[];
}

const AUTO_DISMISS_MS = 12000; // 12 seconds feels long enough to actually read

export default function TradingAlerts({ signals }: TradingAlertsProps) {
  const [, navigate] = useLocation();
  const [alerts, setAlerts] = useState<ActiveAlert[]>([]);

  // When the polling hook delivers fresh signals, add them to our local stack
  useEffect(() => {
    if (signals.length === 0) return;

    const incoming: ActiveAlert[] = signals.map(s => ({
      ...s,
      addedAt: Date.now(),
      visible: true,
    }));

    setAlerts(prev => {
      // Safety dedup — the hook already filters by seen IDs but this covers edge cases
      const existingIds = new Set(prev.map(a => a.id));
      const fresh = incoming.filter(a => !existingIds.has(a.id));
      return [...prev, ...fresh];
    });
  }, [signals]);

  // Every 500ms, hide alerts that have been up for 12+ seconds and then clean them out
  useEffect(() => {
    if (alerts.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setAlerts(prev =>
        prev
          .map(a =>
            now - a.addedAt >= AUTO_DISMISS_MS ? { ...a, visible: false } : a
          )
          // Give the CSS transition a moment to finish before actually removing the element
          .filter(a => a.visible || now - a.addedAt < AUTO_DISMISS_MS + 500)
      );
    }, 500);
    return () => clearInterval(interval);
  }, [alerts.length]);

  function dismiss(id: string) {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }

  // Dismiss the alert first, then navigate — avoids a flash of the alert on the new page
  function openPatternAnalyzer(ticker: string, id: string) {
    dismiss(id);
    navigate(`/patterns?ticker=${ticker}`);
  }

  if (alerts.length === 0) return null;

  return (
    // pointer-events-none on the container so it doesn't block clicks on the page behind it
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
      {alerts.map(alert => {
        const isBuy = alert.action === "BUY";
        return (
          <div
            key={alert.id}
            className={`pointer-events-auto rounded-2xl shadow-2xl border overflow-hidden transition-all duration-500 ${
              alert.visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-full"
            } ${
              isBuy
                ? "bg-emerald-950 border-emerald-600"
                : "bg-red-950 border-red-600"
            }`}
          >
            {/* Coloured header bar with action label */}
            <div
              className={`flex items-center justify-between px-4 py-2 ${
                isBuy ? "bg-emerald-600" : "bg-red-600"
              }`}
            >
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-white" />
                <span className="text-white font-bold text-sm tracking-wide">
                  {isBuy ? "BUY SIGNAL" : "SELL SIGNAL"}
                </span>
                {/* "Urgent" badge for high-confidence signals */}
                {alert.urgency === "high" && (
                  <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">
                    Urgent
                  </span>
                )}
              </div>
              <button
                onClick={() => dismiss(alert.id)}
                className="text-white/80 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Main body: icon, ticker, reason, confidence */}
            <div className="px-4 py-3">
              <div className="flex items-start gap-3">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    isBuy ? "bg-emerald-700" : "bg-red-700"
                  }`}
                >
                  {isBuy ? (
                    <TrendingUp className="h-6 w-6 text-emerald-200" />
                  ) : (
                    <TrendingDown className="h-6 w-6 text-red-200" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-lg leading-tight">
                    {isBuy ? "Buy" : "Sell"}{" "}
                    <span className={isBuy ? "text-emerald-300" : "text-red-300"}>
                      {alert.ticker}
                    </span>{" "}
                    now
                  </p>
                  <p className="text-white/80 text-sm mt-1 leading-snug">
                    {alert.reason}
                  </p>
                  <p className="text-white/50 text-xs mt-1">
                    AI confidence: {alert.confidence}%
                  </p>
                </div>
              </div>

              {/* Show the headline that triggered the signal so the user can judge it */}
              {alert.newsHeadline && (
                <p className="mt-2 text-white/50 text-xs italic border-t border-white/10 pt-2 line-clamp-2">
                  "{alert.newsHeadline}"
                </p>
              )}

              <button
                onClick={() => openPatternAnalyzer(alert.ticker, alert.id)}
                className={`mt-3 w-full py-2 rounded-xl text-sm font-semibold transition-colors ${
                  isBuy
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                    : "bg-red-600 hover:bg-red-500 text-white"
                }`}
              >
                View {alert.ticker} Pattern Analysis
              </button>
            </div>

            {/* Thin progress bar that drains as the auto-dismiss timer ticks down */}
            <div className={`h-1 ${isBuy ? "bg-emerald-900" : "bg-red-900"}`}>
              <div
                className={`h-full transition-all ease-linear ${
                  isBuy ? "bg-emerald-400" : "bg-red-400"
                }`}
                style={{
                  width: `${Math.max(
                    0,
                    100 - ((Date.now() - alert.addedAt) / AUTO_DISMISS_MS) * 100
                  )}%`,
                  transitionDuration: "500ms",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
