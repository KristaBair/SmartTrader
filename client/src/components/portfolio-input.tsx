// Portfolio holdings manager.
// Shows each position as a row the user can edit in-place.
// Every change saves immediately to localStorage so nothing is lost.
// The "Analyze" button sends the current state to the AI.

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Plus, Trash2, Check, X, Pencil, DollarSign, TrendingUp, Camera, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { savePortfolio, type LocalPortfolio } from "@/lib/localStore";

interface Holding {
  symbol: string;
  name: string;
  shares: number;
  averagePrice: number;
}

interface PortfolioInputProps {
  userId?: string;
  portfolio: LocalPortfolio | null;
  onPortfolioChange: (portfolio: LocalPortfolio) => void;
  onAnalyze: (portfolio: LocalPortfolio) => void;
  isAnalyzing: boolean;
}

// Build an empty portfolio shell so we always have a valid object to work from
function emptyPortfolio(): LocalPortfolio {
  return {
    cash: 0,
    investments: [],
    riskTolerance: "moderate",
    timeline: "long_term",
    lastUpdated: new Date().toISOString(),
  };
}

export default function PortfolioInput({
  userId,
  portfolio,
  onPortfolioChange,
  onAnalyze,
  isAnalyzing,
}: PortfolioInputProps) {
  const { toast } = useToast();

  // Local working copy — changes here flow out via onPortfolioChange
  const [cash, setCash] = useState<string>(String(portfolio?.cash ?? ""));
  const [holdings, setHoldings] = useState<Holding[]>(portfolio?.investments ?? []);
  const [riskTolerance, setRiskTolerance] = useState(portfolio?.riskTolerance ?? "moderate");
  const [timeline, setTimeline] = useState(portfolio?.timeline ?? "long_term");

  // Keep local state in sync if the parent reloads the portfolio (e.g. after sign-in)
  useEffect(() => {
    if (portfolio) {
      setCash(String(portfolio.cash));
      setHoldings(portfolio.investments ?? []);
      setRiskTolerance(portfolio.riskTolerance);
      setTimeline(portfolio.timeline);
    }
  }, [portfolio?.lastUpdated]);

  // ── Photo scan state ─────────────────────────────────────────────────────
  const [isScanningPhoto, setIsScanningPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // ── Add position form state ──────────────────────────────────────────────
  const [addSymbol, setAddSymbol] = useState("");
  const [addShares, setAddShares] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  // ── Inline edit state ────────────────────────────────────────────────────
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editShares, setEditShares] = useState("");
  const [editPrice, setEditPrice] = useState("");

  // ── Core save helper ─────────────────────────────────────────────────────
  // Builds the LocalPortfolio object and persists it, then tells the parent
  function persist(updatedHoldings: Holding[], updatedCash?: string) {
    const newPortfolio: LocalPortfolio = {
      cash: parseFloat(updatedCash ?? cash) || 0,
      investments: updatedHoldings,
      riskTolerance,
      timeline,
      lastUpdated: new Date().toISOString(),
    };
    savePortfolio(newPortfolio, userId);
    onPortfolioChange(newPortfolio);
    return newPortfolio;
  }

  // ── Cash update ──────────────────────────────────────────────────────────
  function handleCashBlur() {
    persist(holdings, cash);
  }

  // ── Settings update ──────────────────────────────────────────────────────
  function handleSettingsChange(field: "riskTolerance" | "timeline", value: string) {
    if (field === "riskTolerance") setRiskTolerance(value);
    if (field === "timeline") setTimeline(value);

    // Persist with updated setting immediately
    const newPortfolio: LocalPortfolio = {
      cash: parseFloat(cash) || 0,
      investments: holdings,
      riskTolerance: field === "riskTolerance" ? value : riskTolerance,
      timeline: field === "timeline" ? value : timeline,
      lastUpdated: new Date().toISOString(),
    };
    savePortfolio(newPortfolio, userId);
    onPortfolioChange(newPortfolio);
  }

  // ── Add a new position ───────────────────────────────────────────────────
  function handleAdd() {
    const sym = addSymbol.trim().toUpperCase();
    const shares = parseFloat(addShares);
    const price = parseFloat(addPrice);

    if (!sym) { toast({ title: "Enter a ticker symbol", variant: "destructive" }); return; }
    if (isNaN(shares) || shares <= 0) { toast({ title: "Enter a valid number of shares", variant: "destructive" }); return; }
    if (isNaN(price) || price <= 0) { toast({ title: "Enter a valid price per share", variant: "destructive" }); return; }

    // If the same symbol exists, average it in rather than creating a duplicate row
    const existing = holdings.findIndex(h => h.symbol === sym);
    let updated: Holding[];
    if (existing >= 0) {
      const prev = holdings[existing];
      const totalShares = prev.shares + shares;
      const avgPrice = (prev.shares * prev.averagePrice + shares * price) / totalShares;
      updated = holdings.map((h, i) =>
        i === existing ? { ...h, shares: totalShares, averagePrice: avgPrice } : h
      );
    } else {
      updated = [...holdings, { symbol: sym, name: sym, shares, averagePrice: price }];
    }

    setHoldings(updated);
    persist(updated);
    setAddSymbol("");
    setAddShares("");
    setAddPrice("");
    setShowAddForm(false);
    toast({ title: `${sym} added to your portfolio` });
  }

  // ── Start editing a row ──────────────────────────────────────────────────
  function startEdit(idx: number) {
    setEditIdx(idx);
    setEditShares(String(holdings[idx].shares));
    setEditPrice(String(holdings[idx].averagePrice));
  }

  // ── Commit an edit ───────────────────────────────────────────────────────
  function commitEdit(idx: number) {
    const shares = parseFloat(editShares);
    const price = parseFloat(editPrice);
    if (isNaN(shares) || shares <= 0 || isNaN(price) || price <= 0) {
      toast({ title: "Enter valid shares and price", variant: "destructive" });
      return;
    }
    const updated = holdings.map((h, i) =>
      i === idx ? { ...h, shares, averagePrice: price } : h
    );
    setHoldings(updated);
    persist(updated);
    setEditIdx(null);
  }

  // ── Remove a position ────────────────────────────────────────────────────
  function removeHolding(idx: number) {
    const sym = holdings[idx].symbol;
    const updated = holdings.filter((_, i) => i !== idx);
    setHoldings(updated);
    persist(updated);
    toast({ title: `${sym} removed from your portfolio` });
  }

  // ── Scan a photo of a brokerage account ─────────────────────────────────
  // Uploads the image to GPT-4o vision, gets back structured holdings,
  // then merges them into the current portfolio (averaging in duplicates).
  async function handlePhotoFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    setIsScanningPhoto(true);
    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/portfolio/extract-from-image", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Scan failed");
      }

      const data = await res.json();
      const extracted: Array<{ symbol: string; shares: number; averagePrice: number }> = data.holdings || [];

      if (extracted.length === 0) {
        toast({
          title: "No positions found",
          description: "The image may be too blurry or not show a portfolio. Try a clearer screenshot.",
          variant: "destructive",
        });
        return;
      }

      // Merge extracted holdings into the current list, averaging duplicates
      let merged = [...holdings];
      for (const ext of extracted) {
        const existing = merged.findIndex(h => h.symbol === ext.symbol);
        if (existing >= 0) {
          const prev = merged[existing];
          const totalShares = prev.shares + ext.shares;
          const avgPrice = (prev.shares * prev.averagePrice + ext.shares * ext.averagePrice) / totalShares;
          merged = merged.map((h, i) =>
            i === existing ? { ...h, shares: totalShares, averagePrice: avgPrice } : h
          );
        } else {
          merged.push({ symbol: ext.symbol, name: ext.symbol, shares: ext.shares, averagePrice: ext.averagePrice });
        }
      }

      // If the photo also had a cash balance, use it (only if our cash field is currently 0)
      const photoCash = parseFloat(data.cash) || 0;
      const newCash = (parseFloat(cash) || 0) === 0 && photoCash > 0 ? String(photoCash) : cash;
      if (newCash !== cash) setCash(newCash);

      setHoldings(merged);
      persist(merged, newCash);

      toast({
        title: `Imported ${extracted.length} position${extracted.length !== 1 ? "s" : ""} from photo`,
        description: "Review the numbers and adjust anything that looks off.",
      });
    } catch (err: any) {
      toast({
        title: "Could not read the photo",
        description: err.message || "Try a clearer screenshot with visible ticker symbols.",
        variant: "destructive",
      });
    } finally {
      setIsScanningPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  // ── Send current state to AI ─────────────────────────────────────────────
  function handleAnalyze() {
    if (holdings.length === 0 && (parseFloat(cash) || 0) === 0) {
      toast({ title: "Add at least one holding or some cash first", variant: "destructive" });
      return;
    }
    const current: LocalPortfolio = {
      cash: parseFloat(cash) || 0,
      investments: holdings,
      riskTolerance,
      timeline,
      lastUpdated: new Date().toISOString(),
    };
    onAnalyze(current);
  }

  const totalValue = holdings.reduce((sum, h) => sum + h.shares * h.averagePrice, 0) + (parseFloat(cash) || 0);

  return (
    <Card>
      {/* Hidden file input — triggered by the "Scan from photo" button */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handlePhotoFile(file);
        }}
      />

      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-primary" />
            My Portfolio
          </CardTitle>
          {/* Scan from photo — opens file picker, sends image to GPT-4o vision */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => photoInputRef.current?.click()}
            disabled={isScanningPhoto}
            title="Take a screenshot of your brokerage account and import holdings automatically"
          >
            {isScanningPhoto ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
            {isScanningPhoto ? "Scanning..." : "Scan from photo"}
          </Button>
        </div>
        {totalValue > 0 && (
          <p className="text-sm text-gray-500">
            Total value: <span className="font-semibold text-gray-800">${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">

        {/* ── Cash balance ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">Cash available</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
              <Input
                type="number"
                min={0}
                value={cash}
                onChange={e => setCash(e.target.value)}
                onBlur={handleCashBlur}
                placeholder="0"
                className="pl-7 h-9 text-sm"
              />
            </div>
          </div>
        </div>

        {/* ── Holdings list ──────────────────────────────────────────────── */}
        <div>
          <p className="text-xs text-gray-500 mb-2">Holdings</p>

          {holdings.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-3 border border-dashed rounded-lg">
              No positions yet. Add one below.
            </p>
          )}

          <div className="space-y-2">
            {holdings.map((h, idx) => {
              const posValue = h.shares * h.averagePrice;
              const isEditing = editIdx === idx;

              return (
                <div
                  key={h.symbol}
                  className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2"
                >
                  {isEditing ? (
                    // ── Edit mode ────────────────────────────────────────
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono font-bold text-xs flex-shrink-0">
                        {h.symbol}
                      </Badge>
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-gray-400">Shares</label>
                          <Input
                            type="number"
                            min={0}
                            value={editShares}
                            onChange={e => setEditShares(e.target.value)}
                            className="h-7 text-xs px-2"
                            autoFocus
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400">Avg price ($)</label>
                          <Input
                            type="number"
                            min={0}
                            value={editPrice}
                            onChange={e => setEditPrice(e.target.value)}
                            className="h-7 text-xs px-2"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => commitEdit(idx)}
                        className="text-green-600 hover:text-green-700 flex-shrink-0"
                        title="Save"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setEditIdx(null)}
                        className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                        title="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    // ── View mode ────────────────────────────────────────
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono font-bold text-xs flex-shrink-0">
                        {h.symbol}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-gray-700">
                          {h.shares} shares @ ${h.averagePrice.toFixed(2)}
                        </span>
                        <span className="text-xs text-gray-400 ml-2">
                          = ${posValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      <button
                        onClick={() => startEdit(idx)}
                        className="text-gray-400 hover:text-blue-600 flex-shrink-0"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => removeHolding(idx)}
                        className="text-gray-400 hover:text-red-500 flex-shrink-0"
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Add position form ──────────────────────────────────────────── */}
        {showAddForm ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2">
            <p className="text-xs font-medium text-blue-700">Add position</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-gray-500">Ticker</label>
                <Input
                  value={addSymbol}
                  onChange={e => setAddSymbol(e.target.value.toUpperCase())}
                  placeholder="AAPL"
                  className="h-8 text-sm font-mono"
                  autoFocus
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">Shares</label>
                <Input
                  type="number"
                  min={0}
                  value={addShares}
                  onChange={e => setAddShares(e.target.value)}
                  placeholder="10"
                  className="h-8 text-sm"
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-500">Price paid ($)</label>
                <Input
                  type="number"
                  min={0}
                  value={addPrice}
                  onChange={e => setAddPrice(e.target.value)}
                  placeholder="150.00"
                  className="h-8 text-sm"
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} className="h-7 text-xs">
                <Check className="h-3 w-3 mr-1" /> Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowAddForm(false); setAddSymbol(""); setAddShares(""); setAddPrice(""); }}
                className="h-7 text-xs text-gray-500"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs border-dashed"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add position
          </Button>
        )}

        {/* ── Settings ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Risk tolerance</label>
            <Select value={riskTolerance} onValueChange={v => handleSettingsChange("riskTolerance", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conservative">Conservative</SelectItem>
                <SelectItem value="moderate">Moderate</SelectItem>
                <SelectItem value="aggressive">Aggressive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Timeline</label>
            <Select value={timeline} onValueChange={v => handleSettingsChange("timeline", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="short_term">Short term (under 1 yr)</SelectItem>
                <SelectItem value="medium_term">Medium term (1 to 5 yrs)</SelectItem>
                <SelectItem value="long_term">Long term (5+ yrs)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Analyze button ─────────────────────────────────────────────── */}
        <Button
          onClick={handleAnalyze}
          className="w-full"
          disabled={isAnalyzing}
        >
          <Brain className="mr-2 h-4 w-4" />
          {isAnalyzing ? "Analyzing..." : "Analyze with AI"}
        </Button>

      </CardContent>
    </Card>
  );
}
