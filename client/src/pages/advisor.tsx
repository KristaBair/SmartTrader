// AI Advisor: planning questions answered from the user's own calculated data.
// Facts, assumptions, and estimates are shown separately; nothing is stored.

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, MessageSquareText, Send, ShieldAlert } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { errorMessage } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import type { AdvisorAnswer, AdvisorPrefs } from "@shared/advisor";

const EXAMPLES = [
  "How much rent can I afford?",
  "Am I saving enough for retirement?",
  "Where could I cut back on my spending?",
  "How much should I have in my emergency fund?",
  "If I save $300 a month, when could I buy a house?",
  "How much do I have saved toward my ring fund?",
  "Can I afford a new car without hurting my other goals?",
];

type Turn = { role: "user"; text: string } | { role: "assistant"; answer: AdvisorAnswer } | { role: "error"; text: string };

function Section({ title, items, tone = "default" }: { title: string; items: string[]; tone?: "default" | "ask" }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <ul className={`mt-1 space-y-1 text-sm ${tone === "ask" ? "text-indigo-900" : "text-slate-700"}`}>
        {items.map((i) => <li key={i} className="flex gap-2">{tone === "ask" ? <HelpCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-indigo-500" /> : <span className="text-slate-400">•</span>}<span>{i}</span></li>)}
      </ul>
    </div>
  );
}

function AnswerCard({ answer, onFollowUp }: { answer: AdvisorAnswer; onFollowUp: (q: string) => void }) {
  return (
    <Card data-testid="advisor-answer">
      <CardContent className="p-4 space-y-4">
        <p className="text-slate-900 whitespace-pre-line">{answer.answer}</p>
        {answer.facts.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">From your data</div>
            <ul className="mt-1 space-y-1 text-sm">
              {answer.facts.map((f) => (
                <li key={f.text} className="flex gap-2">
                  {f.verified
                    ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-emerald-600" aria-label="Matches your calculated data" />
                    : <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" aria-label="Not verified" />}
                  <span className={f.verified ? "text-slate-800" : "text-amber-900"}>{f.text}{!f.verified && <span className="text-xs"> (not verified)</span>}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Section title="Assumptions" items={answer.assumptions} />
        <Section title="Estimates (not guarantees)" items={answer.estimates} />
        <Section title="To answer fully, I need" items={answer.needsInfo} tone="ask" />
        {answer.notices.map((n) => <p key={n} className="flex gap-2 text-xs text-amber-800 bg-amber-50 rounded px-2 py-1"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />{n}</p>)}
        {answer.sources.length > 0 && <p className="text-xs text-slate-500">Based on: {answer.sources.join(" · ")}</p>}
        {answer.followUps.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {answer.followUps.map((q) => <Button key={q} size="sm" variant="outline" className="h-auto py-1 text-xs whitespace-normal text-left" onClick={() => onFollowUp(q)}>{q}</Button>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdvisorPage() {
  const search = useSearch();
  const { data: prefs } = useQuery<AdvisorPrefs>({ queryKey: ["/api/advisor/prefs"], staleTime: Infinity });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(search).get("q");
    if (q) setDraft(q.slice(0, 1000));
  }, [search]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns, busy]);

  const setPref = async (key: keyof AdvisorPrefs, value: boolean) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: value };
    queryClient.setQueryData(["/api/advisor/prefs"], next);
    try {
      await apiRequest("PUT", "/api/advisor/prefs", next);
    } catch (e) {
      queryClient.setQueryData(["/api/advisor/prefs"], prefs);
      toast({ title: "Couldn't save setting", description: errorMessage(e), variant: "destructive" });
    }
  };

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    // Earlier turns as plain text, so follow-ups have context. Kept only in this page.
    const history = turns.flatMap((t): { role: "user" | "assistant"; content: string }[] =>
      t.role === "user" ? [{ role: "user", content: t.text }]
        : t.role === "assistant" ? [{ role: "assistant", content: t.answer.answer }] : []
    ).slice(-10);
    setTurns((prev) => [...prev, { role: "user", text: q }]);
    setDraft("");
    setBusy(true);
    try {
      const answer = await (await apiRequest("POST", "/api/advisor/ask", { question: q, history })).json() as AdvisorAnswer;
      setTurns((prev) => [...prev, { role: "assistant", answer }]);
    } catch (e) {
      setTurns((prev) => [...prev, { role: "error", text: errorMessage(e, "The AI Advisor couldn't answer that. Try again.") }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2"><MessageSquareText className="h-6 w-6 text-indigo-600" /> AI Advisor</h1>
        <p className="text-sm text-slate-500">Ask planning questions about your own finances. Answers come from the same calculations as your pages, and figures are checked against them.</p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="note">
        <ShieldAlert className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <span>For education and planning only. InvestSmart is not a registered investment adviser and doesn't recommend buying or selling specific investments. AI answers can be wrong; check important decisions with a qualified professional.</span>
      </div>

      {prefs && (
        <fieldset className="rounded-lg border border-slate-200 bg-white p-3">
          <legend className="px-1 text-xs font-medium text-slate-600">What the AI Advisor may use</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {([["useAccounts", "Account balances"], ["useSpending", "Spending and income"], ["usePoolsAndGoals", "Savings pools and goals"]] as const).map(([key, label]) => (
              <div key={key} className="flex items-center gap-2">
                <Switch id={`pref-${key}`} checked={prefs[key]} onCheckedChange={(v) => setPref(key, v)} />
                <Label htmlFor={`pref-${key}`} className="text-sm">{label}</Label>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Never shared with the AI: account numbers, bank logins or Plaid credentials, institution and merchant names, or individual transactions. Conversations aren't saved.</p>
        </fieldset>
      )}

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Example questions">
          {EXAMPLES.map((q) => <Button key={q} size="sm" variant="outline" className="h-auto py-1.5 whitespace-normal text-left" onClick={() => ask(q)} disabled={busy}>{q}</Button>)}
        </div>
      )}

      <div className="space-y-4" aria-live="polite">
        {turns.map((t, i) => t.role === "user" ? (
          <div key={i} className="flex justify-end"><div className="max-w-[85%] rounded-2xl bg-indigo-600 px-4 py-2 text-sm text-white">{t.text}</div></div>
        ) : t.role === "assistant" ? (
          <AnswerCard key={i} answer={t.answer} onFollowUp={ask} />
        ) : (
          <div key={i} className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="h-4 w-4 mt-0.5" />{t.text}</div>
        ))}
        {busy && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking your numbers…</div>}
        <div ref={endRef} />
      </div>

      <form className="sticky bottom-0 bg-slate-50 pt-2" style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom, 0px))" }} onSubmit={(e) => { e.preventDefault(); void ask(draft); }}>
        <div className="flex gap-2">
          <Textarea
            value={draft}
            maxLength={1000}
            rows={2}
            placeholder="Ask about your budget, goals, savings pools, rent, or retirement…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(draft); } }}
            aria-label="Your question"
          />
          <Button type="submit" disabled={busy || !draft.trim()} aria-label="Ask"><Send className="h-4 w-4" /></Button>
        </div>
      </form>
    </main>
  );
}
