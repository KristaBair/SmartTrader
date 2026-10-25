// Top navigation shared by every signed-in page. The five sections are the
// app's main areas; older tool pages (Analytics, Patterns, ...) live under Investments.

import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Landmark, PiggyBank, Target, MessageSquareText, LineChart, LogOut, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/context/UserContext";

const SECTIONS = [
  { href: "/finances", label: "My Finances", icon: Landmark, match: ["/finances", "/"] },
  { href: "/pools", label: "Savings Pools", icon: PiggyBank, match: ["/pools"] },
  { href: "/goals", label: "Financial Goals", icon: Target, match: ["/goals", "/planners"] },
  { href: "/advisor", label: "AI Advisor", icon: MessageSquareText, match: ["/advisor"] },
  {
    href: "/investments",
    label: "Investments",
    icon: LineChart,
    match: ["/investments", "/dashboard", "/analytics", "/invest", "/patterns", "/market-intelligence"],
  },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, signOut } = useUser();

  const isActive = (match: string[]) =>
    match.some((path) => (path === "/" ? location === "/" : location === path || location.startsWith(`${path}/`)));

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-slate-200" style={{ top: "env(safe-area-inset-top, 0px)" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 gap-4">
            <Link href="/finances" className="flex items-center gap-2 flex-shrink-0">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
                <TrendingUp className="text-white h-4 w-4" />
              </div>
              <span className="text-lg font-semibold text-slate-900 hidden sm:inline">InvestSmart</span>
            </Link>

            <nav className="hidden md:flex items-center gap-1" aria-label="Main">
              {SECTIONS.map(({ href, label, icon: Icon, match }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive(match) ? "page" : undefined}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive(match) ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
            </nav>

            {user && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <div
                  className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-semibold"
                  title={`${user.firstName} ${user.lastName}`}
                >
                  {user.firstName[0]}{user.lastName[0]}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => signOut().finally(() => navigate("/"))}
                  className="text-slate-500 hover:text-slate-800"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Phones: the same sections as a scrollable row. */}
          <nav className="md:hidden flex gap-1 overflow-x-auto pb-2 -mx-1 px-1" aria-label="Main">
            {SECTIONS.map(({ href, label, icon: Icon, match }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(match) ? "page" : undefined}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                  isActive(match) ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
