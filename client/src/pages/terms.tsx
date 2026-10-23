// Terms and Conditions. Public at /terms (linked from account creation), and
// shown as a blocking acceptance screen to signed-in users who have not yet
// agreed to the current version.

import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import TermsContent from "@/components/terms-content";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import { acceptTerms } from "@/lib/userData";
import { ArrowLeft, Loader2, LogOut } from "lucide-react";

export default function TermsPage() {
  const { isSignedIn } = useUser();
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-xl bg-white p-6 shadow-sm sm:p-10">
        <Link href={isSignedIn ? "/dashboard" : "/"} className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <TermsContent />
      </div>
    </div>
  );
}

// Shown in place of the app until the signed-in user accepts the current Terms.
export function TermsAcceptanceGate({ onAccepted }: { onAccepted: () => void }) {
  const { signOut } = useUser();
  const { toast } = useToast();
  const [agreed, setAgreed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function handleAccept() {
    setIsSaving(true);
    try {
      await acceptTerms();
      onAccepted();
    } catch {
      toast({
        title: "Couldn't record your acceptance",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-xl bg-white shadow-sm">
        <div className="border-b border-gray-200 p-6">
          <p className="text-sm font-medium text-blue-700">Please review before continuing</p>
          <p className="mt-1 text-sm text-gray-600">
            You need to accept the current Terms and Conditions to use your account. They explain what
            financial information is collected and how it is used in AI analysis.
          </p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-6">
          <TermsContent />
        </div>
        <div className="space-y-4 border-t border-gray-200 p-6">
          <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-blue-600"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            <span>
              I am at least 18 years old, and I have read and agree to the Terms and Conditions,
              including the use of my connected-account information in AI analysis.
            </span>
          </label>
          <div className="flex flex-wrap justify-between gap-3">
            <Button variant="ghost" onClick={() => void signOut()} className="text-gray-600">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
            <Button onClick={() => void handleAccept()} disabled={!agreed || isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Agree and continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
