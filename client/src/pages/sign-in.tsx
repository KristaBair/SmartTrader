// The sign-in screen. Shows existing profiles as tappable cards right away.
// no extra "Sign In" button to click through. If no profiles exist, prompts to create one.

import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/context/UserContext";
import {
  getAllUsers,
  createUser,
  findUser,
  getOnboarding,
  UserProfile,
} from "@/lib/localStore";
import { TrendingUp, UserPlus, KeyRound, ArrowLeft } from "lucide-react";

// Three screens: the profile list, the passcode numpad, and the create-account form
type View = "home" | "enter-passcode" | "create-account";

export default function SignIn() {
  const [, navigate] = useLocation();
  const { signIn } = useUser();
  const { toast } = useToast();

  const [view, setView] = useState<View>("home");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  // Passcode entry state
  const [passcode, setPasscode] = useState("");
  const [passcodeError, setPasscodeError] = useState(false);

  // New account form state
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newPasscode, setNewPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");

  // Read all profiles off the device every render (fast, always fresh)
  const users = getAllUsers();

  // ── Sign in with existing profile ────────────────────────────────────────

  function handleSelectUser(user: UserProfile) {
    setSelectedUser(user);
    setPasscode("");         // clear any leftover digits from a previous attempt
    setPasscodeError(false);
    setView("enter-passcode");
  }

  function handlePasscodeKey(digit: string) {
    if (passcode.length < 4) {
      const next = passcode + digit;
      setPasscode(next);
      setPasscodeError(false);
      // Auto-submit as soon as 4 digits are in. No confirm button needed.
      if (next.length === 4) {
        setTimeout(() => verifyPasscode(next), 120); // tiny delay so the last dot animates
      }
    }
  }

  function handlePasscodeDelete() {
    setPasscode(p => p.slice(0, -1));
    setPasscodeError(false);
  }

  function verifyPasscode(code: string) {
    if (!selectedUser) return;
    const match = findUser(selectedUser.firstName, selectedUser.lastName, code);
    if (match) {
      signIn(match);
      // Skip onboarding if they've already done it
      const onboarding = getOnboarding(match.id);
      if (onboarding?.completed) {
        navigate("/dashboard");
      } else {
        navigate("/onboarding");
      }
    } else {
      setPasscodeError(true);
      setPasscode(""); // clear so they can try again
    }
  }

  // ── Create new profile ───────────────────────────────────────────────────

  function handleCreateAccount() {
    if (!newFirst.trim() || !newLast.trim()) {
      toast({ title: "Name required", description: "Please enter your first and last name.", variant: "destructive" });
      return;
    }
    if (newPasscode.length !== 4 || !/^\d{4}$/.test(newPasscode)) {
      toast({ title: "Invalid passcode", description: "Passcode must be exactly 4 digits.", variant: "destructive" });
      return;
    }
    if (newPasscode !== confirmPasscode) {
      toast({ title: "Passcodes don't match", description: "Please re-enter the same passcode.", variant: "destructive" });
      return;
    }

    // Prevent two people sharing a name on the same device
    const existing = getAllUsers().find(
      u =>
        u.firstName.toLowerCase() === newFirst.trim().toLowerCase() &&
        u.lastName.toLowerCase() === newLast.trim().toLowerCase()
    );
    if (existing) {
      toast({ title: "Name already taken", description: "A profile with that name already exists.", variant: "destructive" });
      return;
    }

    const user = createUser(newFirst, newLast, newPasscode);
    signIn(user);
    navigate("/onboarding"); // new users always go through setup first
  }

  // Layout for the number pad: 1-9, blank space, 0, delete
  const numpadKeys = ["1","2","3","4","5","6","7","8","9","","0","del"];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6">

      {/* Logo — same on every view for continuity */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center shadow-lg">
          <TrendingUp className="text-white h-7 w-7" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">SmartTrader</h1>
          <p className="text-blue-300 text-xs">AI-powered investing</p>
        </div>
      </div>

      {/* ── HOME: profile picker ─────────────────────────────────────────── */}
      {view === "home" && (
        <div className="w-full max-w-sm">
          {users.length > 0 ? (
            <>
              <p className="text-center text-slate-300 text-sm mb-5">Who's investing today?</p>

              {/* Each card is a profile — tap to go straight to the passcode screen */}
              <div className="space-y-3 mb-5">
                {users.map(u => (
                  <button
                    key={u.id}
                    onClick={() => handleSelectUser(u)}
                    className="w-full flex items-center gap-4 p-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500 rounded-2xl transition-all text-left"
                  >
                    {/* Initials avatar */}
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                      {u.firstName[0]}{u.lastName[0]}
                    </div>
                    <div>
                      <p className="text-white font-semibold">{u.firstName} {u.lastName}</p>
                      <p className="text-slate-400 text-xs">
                        Last login: {new Date(u.lastLogin).toLocaleDateString()}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              <Button
                onClick={() => setView("create-account")}
                variant="outline"
                className="w-full h-12 border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-white rounded-2xl"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Add New Profile
              </Button>
            </>
          ) : (
            // Fresh device with no profiles yet.
            <>
              <p className="text-center text-slate-300 text-sm mb-6">
                No profiles yet. Create yours to get started.
              </p>
              <Button
                onClick={() => setView("create-account")}
                className="w-full h-14 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-2xl text-base shadow-lg"
              >
                <UserPlus className="h-5 w-5 mr-2" />
                Create Your Profile
              </Button>
            </>
          )}
        </div>
      )}

      {/* ── PASSCODE: numpad entry ───────────────────────────────────────── */}
      {view === "enter-passcode" && selectedUser && (
        <div className="w-full max-w-xs flex flex-col items-center">
          <button
            onClick={() => setView("home")}
            className="self-start flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-6"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          {/* Show whose passcode we're asking for */}
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-2xl mb-3">
            {selectedUser.firstName[0]}{selectedUser.lastName[0]}
          </div>
          <p className="text-white font-semibold text-lg mb-1">
            {selectedUser.firstName} {selectedUser.lastName}
          </p>
          <p className="text-slate-400 text-sm mb-8 flex items-center gap-1">
            <KeyRound className="h-3 w-3" /> Enter your 4-digit passcode
          </p>

          {/* Four dots that fill in as digits are typed */}
          <div className="flex gap-4 mb-4">
            {[0,1,2,3].map(i => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 transition-all ${
                  passcode.length > i
                    ? passcodeError
                      ? "bg-red-500 border-red-500"   // flash red on wrong passcode
                      : "bg-blue-400 border-blue-400"
                    : "border-slate-500"
                }`}
              />
            ))}
          </div>
          {passcodeError && (
            <p className="text-red-400 text-sm mb-4">Incorrect passcode. Try again.</p>
          )}

          {/* Number pad */}
          <div className="grid grid-cols-3 gap-3 w-full max-w-[240px] mt-2">
            {numpadKeys.map((key, idx) => {
              if (key === "") return <div key={idx} />; // empty cell under 7,8,9
              if (key === "del") {
                return (
                  <button
                    key={idx}
                    onClick={handlePasscodeDelete}
                    className="h-14 rounded-2xl bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium text-sm flex items-center justify-center transition-colors"
                  >
                    ←
                  </button>
                );
              }
              return (
                <button
                  key={idx}
                  onClick={() => handlePasscodeKey(key)}
                  className="h-14 rounded-2xl bg-slate-700 hover:bg-blue-600 active:bg-blue-500 text-white font-bold text-xl transition-colors"
                >
                  {key}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── CREATE ACCOUNT: name + passcode form ────────────────────────── */}
      {view === "create-account" && (
        <Card className="w-full max-w-sm bg-slate-800 border-slate-700 shadow-2xl">
          <CardHeader className="pb-4">
            <button
              onClick={() => setView("home")}
              className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-2"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <CardTitle className="text-white text-lg">Create Your Profile</CardTitle>
            <p className="text-slate-400 text-sm">Your data stays private on this device.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-slate-300 text-sm">First Name</Label>
                <Input
                  value={newFirst}
                  onChange={e => setNewFirst(e.target.value)}
                  placeholder="Jane"
                  className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-slate-300 text-sm">Last Name</Label>
                <Input
                  value={newLast}
                  onChange={e => setNewLast(e.target.value)}
                  placeholder="Smith"
                  className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-slate-300 text-sm">4-Digit Passcode</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={newPasscode}
                onChange={e => setNewPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="• • • •"
                className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 text-center tracking-[0.5em] text-lg"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-slate-300 text-sm">Confirm Passcode</Label>
              <Input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={confirmPasscode}
                onChange={e => setConfirmPasscode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="• • • •"
                className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 text-center tracking-[0.5em] text-lg"
              />
            </div>

            {/* Button stays disabled until both passcode fields are full */}
            <Button
              onClick={handleCreateAccount}
              className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl mt-2"
              disabled={!newFirst || !newLast || newPasscode.length !== 4 || confirmPasscode.length !== 4}
            >
              Create Profile and Get Started
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
