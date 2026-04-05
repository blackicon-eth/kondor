"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { useUser } from "@/context/user-context";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth, useAuthContext } from "@monerium/sdk-react-provider";
import { useClearMoneriumSession } from "@/components/monerium-wrapper";
import ky from "ky";
import { useRouter } from "next/navigation";
import {
  Shield,
  Landmark,
  RotateCcw,
  ExternalLink,
  Lock,
  Loader2,
  ArrowDownToLine,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";

const RECOVERY_ENTRIES = [
  { address: "st_0x4f...92E1", amount: "0.047", token: "ETH" },
  { address: "st_0x91...C2A4", amount: "0.012", token: "USDC" },
  { address: "st_0xA4...00F2", amount: "0.001", token: "ETH" },
];

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export default function Profile() {
  const { user, userZkAddress, userPolicies, refetch } = useUser();
  const { user: privyUser, getAccessToken } = usePrivy();
  const { isAuthorized, isLoading: moneriumLoading, authorize } = useAuth();
  const { data: authCtx } = useAuthContext({});
  const router = useRouter();
  const [zkAddress, setZkAddress] = useState(userZkAddress ?? "");
  const [moneriumInfoVisible, setMoneriumInfoVisible] = useState(false);
  const [updatingZkAddress, setUpdatingZkAddress] = useState(false);
  const [savingOfframp, setSavingOfframp] = useState(false);

  const seedAddress = privyUser?.linkedAccounts.find(
    (a) =>
      a.type === "wallet" && (a.walletClientType === "privy" || a.walletClientType === "privy-v2")
  );

  const offrampMode = userPolicies?.isOfframp ?? false;
  const hasPolicy = Boolean(userPolicies);

  async function handleUpdateZkAddress() {
    const trimmed = zkAddress.trim();
    if (!trimmed) {
      toast.error("Please enter a valid zkAddress");
      return;
    }
    if (!trimmed.startsWith("0zk")) {
      toast.error("Invalid zkAddress format — must start with 0zk");
      return;
    }
    if (!seedAddress || !("address" in seedAddress)) {
      toast.error("Wallet not available");
      return;
    }
    setUpdatingZkAddress(true);
    try {
      const token = await getAccessToken();
      await ky.put("/api/user/text-records", {
        json: { textRecords: { railgunAddress: trimmed } },
        headers: {
          Authorization: `Bearer ${token}`,
          "x-seed-address": seedAddress.address,
        },
      });
      await refetch();
      toast.success("zkAddress updated successfully");
    } catch (e) {
      console.error("[Profile] Failed to update zkAddress:", e);
      toast.error("Failed to update zkAddress");
    } finally {
      setUpdatingZkAddress(false);
    }
  }

  async function handleToggleOfframpMode(next: boolean) {
    if (!user || !seedAddress || !("address" in seedAddress)) return;

    const existingRecords = JSON.parse(user.textRecords || "{}");
    const policyStr = existingRecords["kondor-policy"];
    if (!policyStr) {
      toast.error("No policy to update — create a token policy first");
      return;
    }

    // Flags live in plaintext on the policy wrapper; flip them without re-encrypting.
    const encrypted = JSON.parse(policyStr);
    encrypted.isOfframp = next;
    encrypted.isRailgun = !next;

    setSavingOfframp(true);
    try {
      const token = await getAccessToken();
      await ky.put("/api/user/text-records", {
        json: { textRecords: { "kondor-policy": JSON.stringify(encrypted) } },
        headers: {
          Authorization: `Bearer ${token}`,
          "x-seed-address": seedAddress.address,
        },
      });
      await refetch();
      toast.success(next ? "Offramp mode enabled" : "Offramp mode disabled");
    } catch (e) {
      console.error("[Profile] Failed to toggle offramp mode:", e);
      toast.error("Failed to update offramp mode");
    } finally {
      setSavingOfframp(false);
    }
  }

  return (
    <div className="flex justify-center items-start w-full h-full">
      <motion.div
        className="w-full max-w-[1650px] mx-auto px-8 py-12"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {/* Header */}
        <motion.div
          variants={fadeUp}
          className="mb-10 flex items-start justify-between gap-10 w-full"
        >
          <div>
            <h1 className="text-6xl md:text-8xl font-headline font-black text-on-surface leading-[0.9] tracking-tighter mb-5">
              PROFILE<span className="text-primary-container">_</span>
            </h1>
            <p className="text-secondary-ds text-base font-body max-w-2xl leading-relaxed">
              Manage your Railgun zkAddress, link Monerium account for offramping, and initiate
              stealth asset recovery through the Kondor decentralized interface.
            </p>
          </div>

          {/* Offramp Mode toggle */}
          <div
            className={`relative shrink-0 inline-flex items-center gap-4 bg-surface-container px-5 py-3.5 border transition-all duration-300 ${
              offrampMode
                ? "border-[#D4AF37]/40 shadow-[0_0_30px_rgba(212,175,55,0.08)]"
                : "border-outline-variant/15"
            }`}
          >
            {/* Active accent stripe */}
            <div
              className={`absolute top-0 left-0 h-full w-1 bg-[#D4AF37] transition-opacity duration-300 ${
                offrampMode ? "opacity-100" : "opacity-0"
              }`}
            />

            <div className="flex items-center gap-3 pl-2 w-[260px]">
              <Landmark
                className={`size-5 shrink-0 transition-colors duration-300 ${
                  offrampMode ? "text-[#D4AF37]" : "text-secondary-ds"
                }`}
              />
              <div>
                <div className="flex items-center gap-2">
                  <div
                    className={`size-1.5 rounded-full transition-all duration-300 ${
                      offrampMode
                        ? "bg-[#D4AF37] shadow-[0_0_6px_rgba(212,175,55,0.9)]"
                        : "bg-secondary-container/50"
                    }`}
                  />
                  <span className="font-headline font-bold text-sm tracking-tight text-on-surface">
                    Offramp Mode
                  </span>
                </div>
                <div className="font-label text-[10px] uppercase tracking-widest text-secondary-ds mt-0.5">
                  {offrampMode ? "Routing 100% to Monerium" : "Railgun delivery (private mode)"}
                </div>
              </div>
            </div>

            <div className="relative">
              {savingOfframp && (
                <Loader2 className="absolute inset-0 m-auto size-3.5 animate-spin text-primary-container pointer-events-none" />
              )}
              <Switch
                checked={offrampMode}
                onCheckedChange={handleToggleOfframpMode}
                disabled={savingOfframp || !hasPolicy}
                className={savingOfframp ? "opacity-50" : ""}
              />
            </div>
          </div>
        </motion.div>

        {/* Protocol Cards Row */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
          {/* Railgun Address — wider card */}
          <div
            className={`lg:col-span-7 bg-surface-container border border-outline-variant/10 relative overflow-hidden transition-opacity duration-300 ${
              offrampMode ? "opacity-40 pointer-events-none" : "opacity-100"
            }`}
          >
            {/* Red left accent bar */}
            <div className="absolute top-0 left-0 w-1 h-full bg-primary-container" />

            {/* Decorative shield icon */}
            <div className="absolute top-6 right-6 opacity-[0.06]">
              <Shield className="size-28 text-primary-container" />
            </div>

            <div className="flex justify-between items-center w-full p-8 gap-10">
              {/* Railgun zkAddress section */}
              <div className="relative z-10 w-full">
                <h3 className="font-headline font-bold text-on-surface uppercase tracking-wider text-base mb-1">
                  Railgun zkAddress
                </h3>
                <p className="font-label text-[10px] uppercase tracking-widest text-secondary-container mb-6">
                  Your Privacy Layer
                </p>

                {/* zkAddress input + Update button */}
                <div className="flex flex-row justify-start gap-3 items-center">
                  <div className="flex items-center gap-3 bg-surface-container-lowest px-5 py-3.5 flex-1 border border-outline-variant/10 group">
                    <Lock className="size-4 text-secondary-container shrink-0" />
                    <input
                      type="text"
                      value={zkAddress}
                      onChange={(e) => setZkAddress(e.target.value)}
                      placeholder="0zk1a2b3c4d..."
                      disabled={offrampMode}
                      className="w-full bg-transparent font-label text-sm text-on-surface tracking-wider placeholder:text-secondary-container focus:outline-none disabled:cursor-not-allowed"
                    />
                  </div>
                  <button
                    onClick={handleUpdateZkAddress}
                    disabled={updatingZkAddress || !zkAddress.trim() || offrampMode}
                    className="flex items-center justify-center gap-2 bg-primary-container text-on-primary-container px-6 py-3.5 font-headline font-bold uppercase text-[11px] tracking-widest hover:bg-white hover:text-surface transition-all cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary-container disabled:hover:text-on-primary-container"
                  >
                    Update
                    {updatingZkAddress ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Monerium — narrower card */}
          <div className="lg:col-span-5 bg-surface-container border border-outline-variant/10 relative overflow-hidden">
            {/* Red corner accent */}
            <div
              className="absolute top-0 right-0 w-20 h-20 bg-primary-container"
              style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }}
            />
            <div className="absolute top-2.5 right-2.5 z-10">
              <ArrowDownToLine className="size-5 text-on-primary-container" />
            </div>

            <div className="relative z-10 p-8 h-full flex flex-col">
              <h3 className="font-headline font-bold text-on-surface uppercase tracking-wider text-base mb-3">
                Monerium
              </h3>

              {isAuthorized && authCtx ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="size-3.5 text-green-400 shrink-0" />
                      <span className="font-label text-[10px] uppercase tracking-widest text-green-400">
                        Connected
                      </span>
                    </div>
                    <button
                      onClick={() => setMoneriumInfoVisible((v) => !v)}
                      className="text-secondary-ds hover:text-on-surface transition-colors cursor-pointer"
                    >
                      {moneriumInfoVisible ? (
                        <EyeOff className="size-3.5" />
                      ) : (
                        <Eye className="size-3.5" />
                      )}
                    </button>
                  </div>
                  <p className="text-secondary-ds text-sm font-body leading-relaxed mb-1 truncate">
                    {moneriumInfoVisible
                      ? authCtx.email
                      : "•".repeat(Math.min((authCtx.email ?? "").length, 20))}
                  </p>
                  <p className="font-label text-[10px] text-secondary-container tracking-wide mb-6 truncate">
                    {moneriumInfoVisible
                      ? authCtx.defaultProfile
                      : "•".repeat(Math.min((authCtx.defaultProfile ?? "").length, 24))}
                  </p>
                  <button
                    onClick={() => router.push("/monerium")}
                    className="flex items-center gap-2 w-full justify-center bg-primary-container text-on-primary-container px-5 py-3 font-headline font-bold uppercase text-[11px] tracking-widest hover:bg-white hover:text-surface transition-all cursor-pointer mt-auto"
                  >
                    Go to Monerium Profile
                    <ArrowRight className="size-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <p className="text-secondary-ds text-sm font-body leading-relaxed mb-6">
                    Bridge your on-chain assets with the European e-money ecosystem through secure
                    IBAN integration.
                  </p>
                  <button
                    onClick={() => authorize()}
                    disabled={moneriumLoading}
                    className="flex items-center gap-2 w-full justify-center bg-surface-container-highest text-on-surface px-5 py-3 font-headline font-bold uppercase text-[11px] tracking-widest hover:bg-primary-container hover:text-on-primary-container transition-all cursor-pointer border border-outline-variant/10 disabled:opacity-50 disabled:cursor-not-allowed mt-auto"
                  >
                    {moneriumLoading ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Landmark className="size-3.5" />
                    )}
                    {moneriumLoading ? "Connecting..." : "Connect Monerium"}
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>

        {/* Funds Recovery */}
        <motion.div variants={fadeUp} className="mb-8 relative">
          <div className="bg-surface-container border border-outline-variant/10 overflow-hidden opacity-20 blur-[1px] pointer-events-none select-none">
            {/* Section header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-8 pt-8 pb-6 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-1 h-10 bg-primary-container" />
                <div>
                  <h3 className="font-headline font-bold text-on-surface uppercase tracking-wider text-base">
                    Funds Recovery
                  </h3>
                  <p className="font-label text-[10px] uppercase tracking-widest text-secondary-container">
                    Stealth Asset Management Terminal
                  </p>
                </div>
              </div>
              <button className="flex items-center gap-2 bg-primary-container text-on-primary-container px-5 py-2.5 font-headline font-bold uppercase text-[11px] tracking-widest hover:bg-white hover:text-surface transition-all cursor-pointer">
                <Sparkles className="size-3.5" />
                Recover All
              </button>
            </div>

            {/* Table */}
            <div className="px-8 pb-8">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-outline-variant/10">
                <div className="col-span-5 font-label text-[10px] uppercase tracking-widest text-secondary-container">
                  Stealth Addresses
                </div>
                <div className="col-span-4 font-label text-[10px] uppercase tracking-widest text-secondary-container">
                  Blocked Amounts
                </div>
                <div className="col-span-3 font-label text-[10px] uppercase tracking-widest text-secondary-container text-right">
                  Action
                </div>
              </div>

              {/* Table Rows */}
              {RECOVERY_ENTRIES.map((entry, i) => (
                <div
                  key={entry.address}
                  className={`grid grid-cols-12 gap-4 px-6 py-5 items-center group/row hover:bg-surface-container-low transition-colors ${
                    i < RECOVERY_ENTRIES.length - 1 ? "border-b border-outline-variant/10" : ""
                  }`}
                >
                  <div className="col-span-5 flex items-center gap-3">
                    <div className="size-2 bg-primary-container rounded-full shrink-0" />
                    <code className="font-label text-sm text-on-surface tracking-wider">
                      {entry.address}
                    </code>
                  </div>
                  <div className="col-span-4">
                    <span className="font-headline font-bold text-on-surface text-sm">
                      {entry.amount}
                    </span>
                    <span className="font-label text-xs text-secondary-ds ml-2 uppercase tracking-wider">
                      {entry.token}
                    </span>
                  </div>
                  <div className="col-span-3 flex justify-end">
                    <button className="flex items-center gap-1.5 text-primary-container font-label text-[11px] uppercase tracking-widest hover:text-white transition-colors cursor-pointer opacity-70 group-hover/row:opacity-100">
                      Recover
                      <ExternalLink className="size-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Coming soon overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-60">
            <div
              className="relative bg-surface-container-high/90 border border-outline-variant/15 px-10 py-6"
              style={{
                clipPath:
                  "polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%)",
              }}
            >
              {/* Faint diagonal texture */}
              <div
                className="absolute inset-0 opacity-[0.025] pointer-events-none"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,1) 8px, rgba(255,255,255,1) 16px)",
                }}
              />
              {/* Top-left status ribbon */}
              <div
                className="absolute top-0 left-0 bg-surface-container-highest border-r border-b border-outline-variant/20 px-3 py-1"
                style={{
                  clipPath: "polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0% 100%)",
                }}
              >
                <span className="font-label text-[9px] uppercase tracking-[0.3em] text-secondary-ds">
                  Phase_02
                </span>
              </div>

              <div className="relative flex flex-col items-center gap-2 pt-3">
                <Lock className="size-5 text-secondary-ds" strokeWidth={2} />
                <h3 className="font-headline font-bold text-2xl uppercase tracking-tight text-on-surface leading-none">
                  Coming Soon
                </h3>
                <div className="h-px w-12 bg-outline-variant/30 my-0.5" />
                <p className="font-label text-[10px] uppercase tracking-[0.2em] text-secondary-container text-center max-w-[260px] leading-relaxed">
                  Stealth asset recovery module under construction
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
