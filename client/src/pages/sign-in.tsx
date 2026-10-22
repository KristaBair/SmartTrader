// The sign-in screen, backed by Amazon Cognito.
// Four views: sign in, create account, confirm email (6-digit code from Cognito),
// and reset password.

import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import {
  signIn,
  signUp,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  confirmResetPassword,
} from "aws-amplify/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/context/UserContext";
import { configureAuth } from "@/lib/auth";
import { getOnboarding } from "@/lib/userData";
import { TrendingUp, UserPlus, LogIn, MailCheck, KeyRound, ArrowLeft } from "lucide-react";

type View = "sign-in" | "create-account" | "confirm" | "reset";

const inputClass =
  "bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500";

// Cognito error messages are already user-friendly, so we show them as-is.
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function SignIn() {
  const [, navigate] = useLocation();
  const { refreshUser } = useUser();
  const { toast } = useToast();

  const [view, setView] = useState<View>("sign-in");
  const [isBusy, setIsBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  // Reset flow: false = ask for email, true = enter code + new password
  const [resetCodeSent, setResetCodeSent] = useState(false);

  function goTo(next: View) {
    setView(next);
    setPassword("");
    setConfirmPassword("");
    setCode("");
    setResetCodeSent(false);
  }

  // Wraps each Cognito call with a busy state and an error toast.
  async function run(title: string, action: () => Promise<void>) {
    setIsBusy(true);
    try {
      await configureAuth();
      await action();
    } catch (error) {
      toast({ title, description: errorMessage(error), variant: "destructive" });
    } finally {
      setIsBusy(false);
    }
  }

  // Loads the user and their saved data, then picks the right landing page.
  async function finishSignIn() {
    await refreshUser();
    navigate(getOnboarding()?.completed ? "/dashboard" : "/onboarding");
  }

  // ── Sign in ──────────────────────────────────────────────────────────────

  function handleSignIn(e: FormEvent) {
    e.preventDefault();
    run("Sign in failed", async () => {
      const result = await signIn({ username: email.trim(), password });
      if (result.nextStep.signInStep === "CONFIRM_SIGN_UP") {
        await resendSignUpCode({ username: email.trim() });
        setView("confirm");
        return;
      }
      if (!result.isSignedIn) {
        throw new Error("Additional sign-in steps are required but not supported here.");
      }
      await finishSignIn();
    });
  }

  // ── Create account ───────────────────────────────────────────────────────

  function handleCreateAccount(e: FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please re-enter the same password.", variant: "destructive" });
      return;
    }
    run("Couldn't create account", async () => {
      await signUp({
        username: email.trim(),
        password,
        options: {
          userAttributes: {
            email: email.trim(),
            given_name: firstName.trim(),
            family_name: lastName.trim(),
          },
        },
      });
      setView("confirm");
    });
  }

  // ── Confirm email ────────────────────────────────────────────────────────

  function handleConfirm(e: FormEvent) {
    e.preventDefault();
    run("Verification failed", async () => {
      await confirmSignUp({ username: email.trim(), confirmationCode: code.trim() });
      if (password) {
        // We still have the password from this visit, so sign straight in.
        await signIn({ username: email.trim(), password });
        await finishSignIn();
      } else {
        toast({ title: "Email verified", description: "You can sign in now." });
        goTo("sign-in");
      }
    });
  }

  function handleResendCode() {
    run("Couldn't resend code", async () => {
      await resendSignUpCode({ username: email.trim() });
      toast({ title: "Code sent", description: `Check ${email.trim()} for a new code.` });
    });
  }

  // ── Reset password ───────────────────────────────────────────────────────

  function handleReset(e: FormEvent) {
    e.preventDefault();
    if (!resetCodeSent) {
      run("Couldn't send reset code", async () => {
        await resetPassword({ username: email.trim() });
        setResetCodeSent(true);
      });
      return;
    }
    run("Couldn't reset password", async () => {
      await confirmResetPassword({
        username: email.trim(),
        confirmationCode: code.trim(),
        newPassword: password,
      });
      toast({ title: "Password updated", description: "Sign in with your new password." });
      goTo("sign-in");
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const backButton = (
    <button
      type="button"
      onClick={() => goTo("sign-in")}
      className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-2"
    >
      <ArrowLeft className="h-4 w-4" /> Back
    </button>
  );

  const emailField = (
    <div className="space-y-1">
      <Label className="text-slate-300 text-sm">Email</Label>
      <Input
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="jane@example.com"
        className={inputClass}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6">

      {/* Logo, same on every view for continuity */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
          <TrendingUp className="text-white h-7 w-7" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">InvestSmart</h1>
          <p className="text-blue-300 text-xs">AI-powered investing</p>
        </div>
      </div>

      {/* ── SIGN IN ──────────────────────────────────────────────────────── */}
      {view === "sign-in" && (
        <Card className="w-full max-w-sm bg-slate-800 border-slate-700 shadow-2xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-white text-lg">Sign in</CardTitle>
            <p className="text-slate-400 text-sm">Welcome back. Your portfolio is waiting.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignIn} className="space-y-4">
              {emailField}
              <div className="space-y-1">
                <Label className="text-slate-300 text-sm">Password</Label>
                <Input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
              <Button
                type="submit"
                disabled={isBusy}
                className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl"
              >
                <LogIn className="h-4 w-4 mr-2" />
                {isBusy ? "Signing in..." : "Sign In"}
              </Button>
              <div className="flex justify-between text-sm">
                <button type="button" onClick={() => goTo("reset")} className="text-slate-400 hover:text-white">
                  Forgot password?
                </button>
                <button type="button" onClick={() => goTo("create-account")} className="text-blue-400 hover:text-blue-300 flex items-center gap-1">
                  <UserPlus className="h-4 w-4" /> Create account
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── CREATE ACCOUNT ───────────────────────────────────────────────── */}
      {view === "create-account" && (
        <Card className="w-full max-w-sm bg-slate-800 border-slate-700 shadow-2xl">
          <CardHeader className="pb-4">
            {backButton}
            <CardTitle className="text-white text-lg">Create Your Account</CardTitle>
            <p className="text-slate-400 text-sm">We'll email you a code to verify your address.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-slate-300 text-sm">First Name</Label>
                  <Input required value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Jane" className={inputClass} />
                </div>
                <div className="space-y-1">
                  <Label className="text-slate-300 text-sm">Last Name</Label>
                  <Input required value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Smith" className={inputClass} />
                </div>
              </div>
              {emailField}
              <div className="space-y-1">
                <Label className="text-slate-300 text-sm">Password</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={inputClass}
                />
                <p className="text-slate-500 text-xs">At least 8 characters, with upper and lower case letters and a number.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-slate-300 text-sm">Confirm Password</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
              <Button
                type="submit"
                disabled={isBusy}
                className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl mt-2"
              >
                {isBusy ? "Creating account..." : "Create Account"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── CONFIRM EMAIL ────────────────────────────────────────────────── */}
      {view === "confirm" && (
        <Card className="w-full max-w-sm bg-slate-800 border-slate-700 shadow-2xl">
          <CardHeader className="pb-4">
            {backButton}
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <MailCheck className="h-5 w-5" /> Check your email
            </CardTitle>
            <p className="text-slate-400 text-sm">Enter the 6-digit code we sent to {email.trim()}.</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleConfirm} className="space-y-4">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="• • • • • •"
                className={`${inputClass} text-center tracking-[0.5em] text-lg`}
              />
              <Button
                type="submit"
                disabled={isBusy || code.length !== 6}
                className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl"
              >
                {isBusy ? "Verifying..." : "Verify and Continue"}
              </Button>
              <button type="button" onClick={handleResendCode} disabled={isBusy} className="w-full text-sm text-slate-400 hover:text-white">
                Didn't get it? Send a new code
              </button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── RESET PASSWORD ───────────────────────────────────────────────── */}
      {view === "reset" && (
        <Card className="w-full max-w-sm bg-slate-800 border-slate-700 shadow-2xl">
          <CardHeader className="pb-4">
            {backButton}
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <KeyRound className="h-5 w-5" /> Reset password
            </CardTitle>
            <p className="text-slate-400 text-sm">
              {resetCodeSent
                ? `Enter the code we sent to ${email.trim()} and choose a new password.`
                : "We'll email you a code to reset your password."}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleReset} className="space-y-4">
              {!resetCodeSent && emailField}
              {resetCodeSent && (
                <>
                  <Input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="• • • • • •"
                    className={`${inputClass} text-center tracking-[0.5em] text-lg`}
                  />
                  <div className="space-y-1">
                    <Label className="text-slate-300 text-sm">New Password</Label>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </>
              )}
              <Button
                type="submit"
                disabled={isBusy}
                className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl"
              >
                {resetCodeSent ? "Set New Password" : "Send Reset Code"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
