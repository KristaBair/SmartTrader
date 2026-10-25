// Finds positions the user entered by hand that also appear in a linked account,
// so the same holding isn't counted twice. Matching is by normalized ticker,
// which is all a manual entry has; linked holdings are treated as authoritative.

export function findOverlappingSymbols(manualSymbols: string[], linkedSymbols: string[]): string[] {
  const normalize = (symbol: string) => symbol.trim().toUpperCase();
  const linked = new Set(linkedSymbols.map(normalize));
  return Array.from(new Set(manualSymbols.map(normalize)))
    .filter((symbol) => symbol !== "" && linked.has(symbol))
    .sort();
}
