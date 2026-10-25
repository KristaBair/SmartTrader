// Client helpers for savings pools: icons, category presets, and a write helper
// that refreshes pool data afterwards and explains conflicts.

import {
  Baby, Briefcase, Car, Gem, Gift, GraduationCap, Heart, Home, PawPrint, PiggyBank, Plane, Shield, Star, Sunset, Wrench,
  type LucideIcon,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { errorMessage } from "@/lib/format";
import type { PoolCategory, PoolIcon } from "@shared/pools";

export const POOL_ICON_COMPONENTS: Record<PoolIcon, LucideIcon> = {
  shield: Shield, home: Home, gem: Gem, "graduation-cap": GraduationCap, sunset: Sunset, plane: Plane, car: Car,
  "piggy-bank": PiggyBank, heart: Heart, gift: Gift, briefcase: Briefcase, baby: Baby, "paw-print": PawPrint, wrench: Wrench, star: Star,
};

export const CATEGORY_PRESETS: Record<PoolCategory, { label: string; name: string; icon: PoolIcon }> = {
  emergency: { label: "Emergency fund", name: "Emergency Fund", icon: "shield" },
  house: { label: "House", name: "House Fund", icon: "home" },
  ring: { label: "Ring", name: "Ring Fund", icon: "gem" },
  college: { label: "College", name: "College Fund", icon: "graduation-cap" },
  retirement: { label: "Retirement", name: "Retirement Fund", icon: "sunset" },
  vacation: { label: "Vacation", name: "Vacation Fund", icon: "plane" },
  car: { label: "Car", name: "Car Fund", icon: "car" },
  custom: { label: "Custom", name: "", icon: "piggy-bank" },
};

export const POOLS_QUERY_KEY = ["/api/pools"] as const;

// Sends a pool write; on success refreshes pools (and the goals that read them).
// Returns true on success. Conflicts reload the latest data so the user can retry.
export async function poolWrite(method: string, url: string, body?: unknown, successMessage?: string): Promise<boolean> {
  try {
    await apiRequest(method, url, body);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: POOLS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] }),
    ]);
    if (successMessage) toast({ title: successMessage });
    return true;
  } catch (error) {
    const conflict = error instanceof Error && error.message.startsWith("409") && error.message.includes("LEDGER_CONFLICT");
    if (conflict) await queryClient.invalidateQueries({ queryKey: POOLS_QUERY_KEY });
    toast({
      title: conflict ? "Your pools changed elsewhere" : "Couldn't save",
      description: conflict ? "We loaded the latest version. Check it and try again." : errorMessage(error),
      variant: "destructive",
    });
    return false;
  }
}
